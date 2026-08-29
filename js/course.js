// ==========================================================================
// course.js — Course page: lesson list, video player, slide viewer, progress
// Exported as initCoursePage(courseId, params) for the SPA router (app.js).
// URL scheme: mydomain.com/#/course?id=xxx
// ==========================================================================
import { db } from "./firebase-config.js";
import {
  doc,
  getDoc,
  collection,
  getDocs,
  addDoc,
  updateDoc,
  arrayUnion,
  increment,
  setDoc,
  query,
  orderBy,
  where,
  serverTimestamp,
} from "https://www.gstatic.com/firebasejs/10.13.0/firebase-firestore.js";
import { initNav, requireAuth, toast, escapeHtml, toBnDigits, getUserProfile, drivePreviewUrl, isDriveLink, openModal, closeModal, youTubeId, getExamAvailability, formatDateTime, getCoursePricing, getExamQuestionCount, generateCertificatePdf, formatTime } from "./utils.js";
import { courseUrl, navigate } from "./router.js";
import { createVideoPlayer } from "./video-player.js";

// ── Per-session state (reset on every initCoursePage call) ────────────────
let courseId = null;
let currentUser = null;
let userProfile = null;
let lessons = [];
let activeLesson = null;
let activeSlideIndex = 0;
let slideSubView = "images"; // "images" | "pdf"
let currentCourse = null;
let unlocked = true;
let courseExams = [];
let marqueeRAF = null;

// ── Video resume state ─────────────────────────────────────────────────────
// activeVideoCleanup: torn down (flushing one last progress save) every time
// renderVideo() is about to swap in a new lesson's player, and again from
// initCoursePage()'s returned cleanup() when the user leaves the course page
// entirely — mirrors the marqueeRAF / navToken teardown pattern already used
// on this page for the same reason (don't leak timers/listeners across visits).
let activeVideoCleanup = null;
let videoToken = 0;
let activePlayerCtl = null; // controller returned by createVideoPlayer() for the current lesson's video
let activeBuyPlayerCtl = null; // controller for the locked-course "how to buy" preview video

// Bumped on every initCoursePage() call. Any async work (Firestore awaits)
// started for an older navigation checks this before touching shared state
// or the DOM — if the token has moved on, that work is stale (the user has
// since navigated to a different course) and must be discarded instead of
// overwriting what's currently on screen. This is what fixes course A's
// data flashing onto course C when C is opened before A's requests finish.
let navToken = 0;

// The ORIGINAL untouched markup of <main class="course-layout"> (video/lesson
// UI), captured once from the static HTML the very first time this page
// runs. renderLockedView() below replaces that entire element's innerHTML
// with the buy/access-code panel — and nothing ever put the lesson UI back.
// So once a single locked course had been viewed, every course opened after
// it (locked or not) was missing #video-frame/#lesson-list/#tab-video/etc.
// entirely: buildEls() picked up null for them, so the new course's video
// and lesson list silently never rendered, and the PREVIOUS course's buy
// panel (or whatever was last drawn) just stayed on screen looking like the
// old course's info "leaking" into the new one. Restoring the pristine
// markup before every navigation is what actually fixes that.
let pristineLayoutHtml = null;

// els is rebuilt on every initCoursePage() call
let els = {};

function buildEls() {
  els = {
    crumb: document.getElementById("course-crumb"),
    title: document.getElementById("course-title"),
    desc: document.getElementById("course-desc"),
    lessonList: document.getElementById("lesson-list"),
    lessonMarquee: document.getElementById("lesson-marquee"),
    nowPlaying: document.getElementById("lesson-now-playing"),
    sidebarSub: document.getElementById("sidebar-sub"),
    videoFrame: document.getElementById("video-frame"),
    lessonDesc: document.getElementById("lesson-desc"),
    slidePanel: document.getElementById("slide-panel"),
    videoPanel: document.getElementById("video-panel"),
    examPanel: document.getElementById("exam-panel"),
    examBanner: document.getElementById("lesson-exam-banner"),
    tabVideo: document.getElementById("tab-video"),
    tabSlides: document.getElementById("tab-slides"),
    tabExam: document.getElementById("tab-exam"),
    completeBtn: document.getElementById("complete-btn"),
  };
}

// Reset <main class="course-layout"> back to its original, untouched markup
// before every navigation, so a previous course's locked/not-found/whatever
// view can never leave stale DOM behind for the next course to inherit.
function resetLayoutDom() {
  const layoutRoot = document.querySelector(".course-layout");
  if (!layoutRoot) return;
  if (pristineLayoutHtml === null) {
    pristineLayoutHtml = layoutRoot.innerHTML; // first-ever call: DOM is still clean, just remember it
  } else {
    layoutRoot.innerHTML = pristineLayoutHtml;
  }
}

// ── Public entry point — called by app.js on every #/course navigation ────
export async function initCoursePage(id, params) {
  const myToken = ++navToken;

  // Reset state
  courseId = id;
  currentUser = null;
  userProfile = null;
  lessons = [];
  activeLesson = null;
  activeSlideIndex = 0;
  slideSubView = "images";
  currentCourse = null;
  unlocked = true;
  courseExams = [];

  // Stop any running marquee animation from a previous visit
  if (marqueeRAF !== null) { cancelAnimationFrame(marqueeRAF); marqueeRAF = null; }

  resetLayoutDom();
  buildEls();
  bindTabButtons();
  bindCompleteButton();

  initNav("home");
  await init(params, myToken);

  // Return a cleanup function for app.js to call before the next navigation
  return function cleanup() {
    if (marqueeRAF !== null) { cancelAnimationFrame(marqueeRAF); marqueeRAF = null; }
    if (activeVideoCleanup) { activeVideoCleanup(); activeVideoCleanup = null; }
    if (activePlayerCtl) { activePlayerCtl.destroy(); activePlayerCtl = null; }
    if (activeBuyPlayerCtl) { activeBuyPlayerCtl.destroy(); activeBuyPlayerCtl = null; }
    // Stop the lesson-strip carousel and any pending resume timer so it
    // doesn't keep ticking (and scrolling a now-gone element) on other pages
    lhStopAutoplay();
    if (lhResumeTimer) { clearTimeout(lhResumeTimer); lhResumeTimer = null; }
  };
}

async function init(params, myToken) {
  currentUser = await requireAuth();
  if (myToken !== navToken) return; // navigated away while awaiting — abandon
  if (!currentUser) return;
  userProfile = await getUserProfile(currentUser.uid);
  if (myToken !== navToken) return;

  const courseSnap = await getDoc(doc(db, "courses", courseId));
  if (myToken !== navToken) return;
  if (!courseSnap.exists()) {
    document.getElementById("course-layout").innerHTML = `<div class="empty-state"><div class="icon"><i class="fa-solid fa-file-pdf"></i></div><p>This course could not be found</p></div>`;
    return;
  }
  const course = courseSnap.data();
  currentCourse = course;
  document.title = `${course.title} — Tech Verse Course`;
  els.crumb.innerHTML = `<a href="#/home"><i class="fa-solid fa-house"></i> Home</a><i class="fa-solid fa-chevron-right crumb-sep"></i><span class="crumb-current">${escapeHtml(course.title)}</span>`;
  els.title.textContent = course.title;
  els.desc.textContent = course.description || "";
  const enrollPill = document.getElementById("course-enroll-pill");
  const enrollCountEl = document.getElementById("course-enroll-count");
  if (enrollPill && enrollCountEl && course.enrollCount > 0) {
    enrollCountEl.textContent = course.enrollCount;
    enrollPill.style.display = "inline-flex";
  }

  const { isPaid } = getCoursePricing(course);

  if (!isPaid) {
    unlocked = true;
    if (!userProfile?.enrolledCourses?.includes(courseId)) {
      await updateDoc(doc(db, "users", currentUser.uid), { enrolledCourses: arrayUnion(courseId) }).catch(() => {});
      await updateDoc(doc(db, "courses", courseId), { enrollCount: increment(1) }).catch(() => {});
    }
  } else {
    unlocked = await checkUnlocked();
  }
  if (myToken !== navToken) return;

  if (!unlocked) {
    renderLockedView(course, myToken);
    // Hash params: #/course?id=xxx&action=buy
    const action = params?.get("action");
    if (action === "buy") {
      document.getElementById("buy-course-btn")?.click();
    } else if (action === "access") {
      openAccessCodeModal(course);
    }
    return;
  }

  // Lessons and this course's exams are fetched together — exam data is needed
  // right away for the lesson-list flags and the per-lesson banner, not just
  // when the "Exam" tab is opened.
  const [lessonsSnap, examsSnap] = await Promise.all([
    getDocs(query(collection(db, "courses", courseId, "lessons"), orderBy("order", "asc"))),
    getDocs(query(collection(db, "exams"), where("courseId", "==", courseId))).catch(() => ({ docs: [] })),
  ]);
  if (myToken !== navToken) return;
  lessons = lessonsSnap.docs.map((d) => ({ id: d.id, ...d.data() }));
  courseExams = examsSnap.docs
    .map((d) => ({ id: d.id, ...d.data() }))
    .sort((a, b) => (b.createdAt?.seconds || 0) - (a.createdAt?.seconds || 0));
  updateExamTabBadge();

  if (!lessons.length) {
    renderComingSoonView(course);
    return;
  }

  els.sidebarSub.textContent = `${lessons.length} lessons`;
  initLessonMarquee();
  renderCertificateBanner();

  // Start from where they left off, otherwise the first lesson
  const progress = userProfile?.progress?.[courseId] || {};
  const firstUnfinished = lessons.find((l) => !progress[l.id]) || lessons[0];
  selectLesson(firstUnfinished.id);
}

/* ==========================================================================
   Paid courses — access code lock system
   ========================================================================== */

// Check whether this user has a used access code for this course
async function checkUnlocked() {
  // Single source of truth: users/{uid}.enrolledCourses. This is exactly the
  // field the admin panel's "Revoke" button edits (arrayRemove) and the only
  // field that access-code redemption and free-course auto-enroll both write
  // (arrayUnion) — see applyAccessCode() and the free-course branch in init().
  //
  // This used to instead query accessCodes for a doc with used==true, which
  // is a record of "a code was redeemed once" and is never touched by revoke,
  // so a revoked user's old accessCodes doc still said used:true forever and
  // this always returned unlocked. Checking enrolledCourses makes revoke take
  // effect immediately, since revoke and this check now read the same field.
  return !!userProfile?.enrolledCourses?.includes(courseId);
}

function money(n) {
  return `৳${n}`;
}

function renderLockedView(course, myToken) {
  latestPurchaseStatus = null;
  const layout = document.querySelector(".course-layout");
  const { price, discountPrice: discount, hasDiscount } = getCoursePricing(course);

  layout.innerHTML = `
    <div class="media-panel">
      <div class="video-frame" id="buy-video-frame"></div>
      <div class="media-body">
        <p class="lesson-desc">${escapeHtml(course.description || "")}</p>
      </div>
    </div>
    <aside class="lesson-sidebar buy-panel">
      <div class="buy-lock-icon"><i class="fa-solid fa-lock"></i></div>
      <h3>This Course is Locked</h3>
      <p class="muted" style="font-size:0.9rem; margin:6px 0 16px;">Purchase the course and unlock it with an access code</p>
      <div class="buy-price-row">
        ${hasDiscount ? `<span class="buy-price-old">${money(price)}</span><span class="buy-price-new">${money(discount)}</span>` : `<span class="buy-price-new">${money(price)}</span>`}
      </div>
      <button class="btn btn-primary btn-block mt-16" id="buy-course-btn">I Want to Buy This Course</button>
      <div id="purchase-status-box"></div>
      <button class="btn btn-outline btn-block mt-16" id="have-code-btn"><i class="fa-solid fa-key"></i> I Already Have an Access Code</button>
    </aside>
  `;

  document.getElementById("buy-course-btn").addEventListener("click", () => handleBuyClick(course));
  document.getElementById("have-code-btn").addEventListener("click", () => openAccessCodeModal(course));
  loadPurchaseStatus(myToken);

  if (activeBuyPlayerCtl) { activeBuyPlayerCtl.destroy(); activeBuyPlayerCtl = null; }
  renderBuyVideo(course.buyVideoUrl || "");
}

/* ---------- "Coming Soon" view — shown when a course is unlocked but its
   admin hasn't uploaded any lessons/videos yet. One of a few looping CSS
   animation variants is picked at random on every page load (every call to
   initCoursePage → init → here), so a refresh can show a different scene;
   whichever one shows, it keeps animating continuously (infinite keyframes),
   never a single static frame. Deliberately restrained/monochrome — a single
   accent color used only for the active motion element, everything else is
   border/text-muted — instead of decorative multi-color glow blobs. Pure
   CSS — no images, nothing to preload. ---------- */
const COMING_SOON_VARIANTS = ["cs-scan", "cs-sweep", "cs-skeleton", "cs-typing"];

function renderComingSoonView(course) {
  const variant = COMING_SOON_VARIANTS[Math.floor(Math.random() * COMING_SOON_VARIANTS.length)];
  const layout = document.querySelector(".course-layout");

  layout.innerHTML = `
    <div class="coming-soon-view ${variant}">
      <div class="cs-frame" aria-hidden="true">
        <div class="cs-sweep"></div>
        <div class="cs-ring"></div>
        <div class="cs-core"><i class="fa-solid fa-clapperboard"></i></div>
      </div>
      <div class="cs-skeleton" aria-hidden="true">
        <div class="cs-skel-row"></div>
        <div class="cs-skel-row"></div>
        <div class="cs-skel-row short"></div>
      </div>
      <h2 class="cs-title">Coming Soon</h2>
      <p class="cs-sub">"${escapeHtml(course.title || "This course")}" — lessons are being prepared and will be uploaded here soon</p>
      <div class="cs-status"><span class="cs-status-dot"></span><span class="cs-status-text">Preparing lessons</span></div>
      <a href="#/home" class="btn btn-outline mt-16"><i class="fa-solid fa-house"></i> Back to Home</a>
    </div>
  `;
}

// Tracks the status of this user's most recent purchase request for the
// course currently being viewed, so the Buy button can warn instead of
// letting them submit a duplicate request once they've already purchased.
let latestPurchaseStatus = null;

function handleBuyClick(course) {
  if (latestPurchaseStatus === "approved") {
    openAlreadyPurchasedModal();
    return;
  }
  openBuyModal(course);
}

function openAlreadyPurchasedModal() {
  const overlay = openModal(`
    <div class="modal-head"><h3>Already Purchased</h3><button class="modal-close-btn" data-modal-close><i class="fa-solid fa-xmark"></i></button></div>
    <div class="already-purchased-box">
      <div class="buy-lock-icon" style="color:var(--teal, #16a37a);"><i class="fa-solid fa-circle-check"></i></div>
      <p style="margin-top:10px;">You have already purchased this course. An access code was sent to your email — use it to unlock the course.</p>
    </div>
    <div class="flex gap-12 mt-16">
      <button type="button" class="btn btn-outline btn-block" data-modal-close>Close</button>
      <button type="button" class="btn btn-primary btn-block" id="already-purchased-enter-code-btn"><i class="fa-solid fa-key"></i> Enter Access Code</button>
    </div>
  `);
  overlay.querySelector("#already-purchased-enter-code-btn")?.addEventListener("click", () => {
    closeModal();
    openAccessCodeModal(currentCourse);
  });
}

// Renders the locked-course "how to buy" preview through the same modern
// custom player as lesson videos — just without any progress-resume wiring
// (no signed-in-user lesson to track position against here).
function renderBuyVideo(url) {
  const frame = document.getElementById("buy-video-frame");
  if (!frame) return;
  const yid = youTubeId(url);
  if (!yid && url && isDriveLink(url)) {
    const preview = drivePreviewUrl(url);
    if (preview) { frame.innerHTML = `<iframe src="${preview}" allow="autoplay" loading="lazy"></iframe>`; return; }
  }
  const source = yid ? { type: "youtube", yid } : url ? { type: "file", url } : { type: "empty", message: "No video has been added yet showing how to buy this course" };
  activeBuyPlayerCtl = createVideoPlayer(frame, source);
}

// Show the status of this user's most recent purchase request for this course
async function loadPurchaseStatus(myToken) {
  const box = document.getElementById("purchase-status-box");
  if (!box) return;
  try {
    const q = query(
      collection(db, "purchaseRequests"),
      where("uid", "==", currentUser.uid),
      where("courseId", "==", courseId)
    );
    const snap = await getDocs(q);
    if (myToken !== undefined && myToken !== navToken) return; // stale — user has since navigated elsewhere
    if (snap.empty) return;
    const requests = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
    requests.sort((a, b) => (b.createdAt?.seconds || 0) - (a.createdAt?.seconds || 0));
    const latest = requests[0];
    latestPurchaseStatus = latest.status;
    if (latest.status === "pending") {
      box.innerHTML = `<div class="purchase-status-pill pending"><i class="fa-solid fa-clock"></i> Your purchase request is under review — you'll get an access code by email once approved</div>`;
      document.getElementById("buy-course-btn").textContent = "Send Another Request";
    } else if (latest.status === "rejected") {
      box.innerHTML = `<div class="purchase-status-pill rejected"><i class="fa-solid fa-circle-xmark"></i> Your previous request wasn't accepted. Please correct the details and try again</div>`;
    } else if (latest.status === "approved") {
      box.innerHTML = `<div class="purchase-status-pill approved"><i class="fa-solid fa-envelope-circle-check"></i> Your request has been approved — an access code has been sent to your email</div>`;
      document.getElementById("buy-course-btn").textContent = "Already Purchased";
    }
  } catch {
    // Silently ignored — normal when there's no request
  }
}

function openBuyModal(course) {
  const { price, discountPrice: discount, hasDiscount } = getCoursePricing(course);
  const payText = hasDiscount ? money(discount) : money(price);
  // The amount is never read from the DOM on submit — it's taken straight
  // from this fixed value, computed the same way the price badge itself is
  // computed. That's what makes it un-editable no matter what happens to
  // the input on screen (devtools included).
  const fixedAmount = hasDiscount ? discount : price;
  // A phone number already saved on the profile (via the mandatory
  // first-login gate in utils.js) is locked here too — same number every
  // time, every course, no retyping and no editing.
  const lockedPhone = (userProfile?.phone || "").trim();

  const overlay = openModal(`
    <div class="modal-head"><h3>Buy Course</h3><button class="modal-close-btn" data-modal-close><i class="fa-solid fa-xmark"></i></button></div>
    <p class="muted" style="font-size:0.9rem; margin-bottom:14px;">Choose a payment method below, send <b>${payText}</b> to the number shown, then fill out the form. An access code will be sent to your email once approved.</p>
    <form id="purchase-form" class="mt-16">
      <div class="admin-grid">
        <div class="field"><label>Your Name</label><input type="text" id="pf-name" required value="${escapeHtml(userProfile?.displayName || "")}"></div>
        <div class="field locked-field">
          <label>Phone Number</label>
          <input type="tel" id="pf-phone" required placeholder="01XXXXXXXXX" value="${escapeHtml(lockedPhone)}" ${lockedPhone ? "readonly" : ""}>
          <span class="field-lock-note">${
            lockedPhone
              ? `<i class="fa-solid fa-lock"></i> Saved on your profile — this cannot be changed`
              : `<i class="fa-solid fa-triangle-exclamation"></i> Enter the correct number — it will be permanently locked after submitting`
          }</span>
        </div>
      </div>
      <div class="field">
        <label>Payment Method</label>
        <select id="pf-method" required>
          <option value="bKash">bKash</option>
          <option value="Nagad">Nagad</option>
          <option value="Rocket">Rocket</option>
        </select>
      </div>
      <div id="pay-numbers-box" class="pay-numbers-box mb-16"><div class="loading-screen" style="min-height:40px;"><span class="spinner"></span></div></div>
      <div class="admin-grid">
        <div class="field"><label>Sender Number</label><input type="tel" id="pf-sender" required placeholder="01XXXXXXXXX"></div>
        <div class="field locked-field">
          <label>Amount Sent</label>
          <input type="number" id="pf-amount" required min="1" value="${fixedAmount}" readonly tabindex="-1">
          <span class="field-lock-note"><i class="fa-solid fa-lock"></i> Fixed price — cannot be changed</span>
        </div>
      </div>
      <div class="field"><label>Transaction ID (if any)</label><input type="text" id="pf-txn" placeholder="Optional"></div>
      <button type="submit" class="btn btn-primary btn-block" id="purchase-submit-btn">Send Request</button>
    </form>
  `);

  let paymentNumbers = {};
  loadPaymentNumbers(overlay).then((numbersMap) => {
    paymentNumbers = numbersMap;
    renderSelectedPayNumber(overlay, paymentNumbers);
  });

  overlay.querySelector("#pf-method").addEventListener("change", () => {
    renderSelectedPayNumber(overlay, paymentNumbers);
  });

  overlay.querySelector("#purchase-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    const btn = overlay.querySelector("#purchase-submit-btn");
    const phoneInput = (overlay.querySelector("#pf-phone").value || "").trim();
    if (!/^01\d{9}$/.test(phoneInput)) {
      toast("Please enter a valid Bangladeshi mobile number (e.g. 01XXXXXXXXX)", "error");
      return;
    }
    btn.disabled = true;
    btn.innerHTML = `<span class="spinner"></span>`;
    try {
      // If this profile somehow reached checkout without a saved phone
      // (pre-existing account from before this lock existed), save it to
      // the profile now so every purchase after this one is locked too.
      if (!lockedPhone) {
        await updateDoc(doc(db, "users", currentUser.uid), { phone: phoneInput }).catch(() => {});
        if (userProfile) userProfile.phone = phoneInput;
      }
      await addDoc(collection(db, "purchaseRequests"), {
        uid: currentUser.uid,
        userEmail: currentUser.email || "",
        userName: overlay.querySelector("#pf-name").value.trim(),
        phone: lockedPhone || phoneInput,
        courseId,
        courseTitle: course.title,
        paymentMethod: overlay.querySelector("#pf-method").value,
        senderNumber: overlay.querySelector("#pf-sender").value.trim(),
        amount: fixedAmount,
        transactionId: overlay.querySelector("#pf-txn").value.trim(),
        status: "pending",
        accessCode: "",
        createdAt: serverTimestamp(),
      });
      toast("Request sent! Please wait for approval", "success");
      closeModal();
      loadPurchaseStatus();
    } catch (err) {
      toast("Could not send the request, please try again", "error");
      btn.disabled = false;
      btn.textContent = "Send Request";
    }
  });
}

// Fetches the admin-configured payment numbers once and returns them as a
// { bKash, Nagad, Rocket } map — it no longer renders every number at once.
async function loadPaymentNumbers(overlay) {
  const box = overlay.querySelector("#pay-numbers-box");
  try {
    const snap = await getDoc(doc(db, "settings", "payment"));
    const s = snap.exists() ? snap.data() : {};
    box.dataset.paymentType = s.paymentType || "Send Money";
    return {
      bKash: s.bkashNumber || "",
      Nagad: s.nagadNumber || "",
      Rocket: s.rocketNumber || "",
    };
  } catch {
    box.innerHTML = "";
    return {};
  }
}

// Shows ONLY the number for the currently-selected payment method — never
// the full list — so there's no chance of sending money to the wrong one.
function renderSelectedPayNumber(overlay, numbersMap) {
  const box = overlay.querySelector("#pay-numbers-box");
  const method = overlay.querySelector("#pf-method")?.value || "bKash";
  const number = numbersMap?.[method];
  const paymentType = box.dataset.paymentType || "Send Money";
  if (!number) {
    box.innerHTML = `<div class="empty-state" style="padding:16px;"><p style="font-size:0.85rem;">${escapeHtml(method)} number hasn't been added yet, please contact the admin</p></div>`;
    return;
  }
  box.innerHTML = `
    <div class="pay-number-selected">
      <i class="fa-solid fa-mobile-screen"></i>
      <div>
        <div class="pn-number">${escapeHtml(number)}</div>
        <div class="muted" style="font-size:0.78rem;">${escapeHtml(method)} · ${escapeHtml(paymentType)}</div>
      </div>
    </div>`;
}

// Popup used everywhere a course needs an access code — the only way to
// unlock a course by code now (replaces the old inline sidebar form).
function openAccessCodeModal(course) {
  const overlay = openModal(`
    <button type="button" class="modal-close-btn access-modal-close" data-modal-close><i class="fa-solid fa-xmark"></i></button>
    <div class="access-modal-surface paper">
      <h3 class="access-modal-title">Enter Course Access Code</h3>
      <p class="access-modal-sub">Submit your access code to unlock the course</p>
      <input type="text" id="access-code-modal-input" class="access-modal-input" placeholder="Enter your access code (e.g. XXXXX-XXXXX-XXXXX-XXXXX-XXXXX)" style="text-transform:uppercase;letter-spacing:1px;">
      <button type="button" class="btn btn-primary btn-block access-modal-submit" id="access-code-modal-submit">Submit Code <i class="fa-solid fa-shield-halved"></i></button>
    </div>
  `);
  overlay.classList.add("access-modal-overlay");
  const input = overlay.querySelector("#access-code-modal-input");
  const btn = overlay.querySelector("#access-code-modal-submit");
  setTimeout(() => input?.focus(), 60);
  const submit = () => applyAccessCode(input, btn);
  btn.addEventListener("click", submit);
  input.addEventListener("keydown", (e) => {
    if (e.key === "Enter") submit();
  });
}

async function applyAccessCode(input, btn) {
  const code = input.value.trim().toUpperCase().replace(/[\s-]/g, "");
  if (!code) {
    toast("Please enter an access code", "error");
    return;
  }
  const originalLabel = btn.innerHTML;
  btn.disabled = true;
  btn.innerHTML = `<span class="spinner"></span>`;
  try {
    const codeRef = doc(db, "accessCodes", code);
    const codeSnap = await getDoc(codeRef);
    if (!codeSnap.exists()) {
      toast("This access code is not valid", "error");
      return;
    }
    const data = codeSnap.data();
    if (data.uid !== currentUser.uid) {
      toast("This code isn't for your account", "error");
      return;
    }
    if (data.courseId !== courseId) {
      toast("This code was issued for a different course", "error");
      return;
    }
    if (data.used) {
      toast("This code has already been used", "error");
      return;
    }
    await updateDoc(codeRef, { used: true, usedAt: serverTimestamp() });
    if (!userProfile?.enrolledCourses?.includes(courseId)) {
      await updateDoc(doc(db, "courses", courseId), { enrollCount: increment(1) }).catch(() => {});
    }
    await updateDoc(doc(db, "users", currentUser.uid), { enrolledCourses: arrayUnion(courseId) }).catch(() => {});
    toast("Course unlocked! Enjoy", "success");
    closeModal();
    setTimeout(() => initCoursePage(courseId, new URLSearchParams()), 500);
  } catch (err) {
    toast("Could not verify the code, please try again", "error");
  } finally {
    btn.disabled = false;
    btn.innerHTML = originalLabel;
  }
}

function isDone(lessonId) {
  return !!userProfile?.progress?.[courseId]?.[lessonId];
}

/* ==========================================================================
   HORIZONTAL LESSON STRIP — replaces vertical sidebar + marquee
   Renders cards right-to-left (newest at right, scroll left for older)

   Now a proper auto-playing carousel:
     • Auto-advances one card at a time every few seconds (smooth scroll),
       looping back to the start when it reaches the end.
     • Fully drag/swipe-able by hand — mouse AND touch — not just native
       scroll, with a small "did we actually drag" guard so a drag doesn't
       accidentally fire a lesson-select click.
     • Auto-play pauses the moment the user touches/drags/hovers the strip,
       and quietly resumes a few seconds after they let go.
   ========================================================================== */

const LH_AUTOPLAY_DELAY = 3200;  // ms a card "stays" before advancing
const LH_RESUME_DELAY = 4500;    // ms of no interaction before autoplay resumes

let lhAutoplayTimer = null;
let lhResumeTimer = null;
let lhDragging = false;
let lhDragMoved = false; // true once a pointer move exceeds the click threshold

function lhCardStep(wrap) {
  const card = wrap.querySelector(".lesson-h-card");
  if (!card) return 0;
  const gap = parseFloat(getComputedStyle(wrap.querySelector(".lesson-h-track")).gap) || 10;
  return card.getBoundingClientRect().width + gap;
}

function lhStopAutoplay() {
  if (lhAutoplayTimer) { clearInterval(lhAutoplayTimer); lhAutoplayTimer = null; }
}

function lhStartAutoplay() {
  lhStopAutoplay();
  const wrap = document.getElementById("lh-track-wrap");
  if (!wrap || wrap.querySelectorAll(".lesson-h-card").length < 2) return; // nothing to carousel
  lhAutoplayTimer = setInterval(() => {
    if (lhDragging) return;
    const atEnd = wrap.scrollLeft + wrap.clientWidth >= wrap.scrollWidth - 4;
    if (atEnd) {
      wrap.scrollTo({ left: 0, behavior: "smooth" });
    } else {
      wrap.scrollBy({ left: lhCardStep(wrap), behavior: "smooth" });
    }
  }, LH_AUTOPLAY_DELAY);
}

// Any user interaction pauses autoplay immediately and schedules a quiet
// resume a few seconds after the interaction ends — feels alive, but never
// fights the user while they're actively browsing lessons by hand.
function lhPauseThenResume() {
  lhStopAutoplay();
  if (lhResumeTimer) clearTimeout(lhResumeTimer);
  lhResumeTimer = setTimeout(lhStartAutoplay, LH_RESUME_DELAY);
}

// DOM reference: we inject a .lesson-h-strip AFTER .media-panel if not present yet
function ensureHStrip() {
  let strip = document.getElementById("lesson-h-strip");
  if (strip) return strip;
  strip = document.createElement("div");
  strip.className = "lesson-h-strip";
  strip.id = "lesson-h-strip";
  strip.innerHTML = `
    <div class="lesson-h-strip-header">
      <div class="lesson-h-strip-title">
        <i class="fa-solid fa-list-ul"></i> All Lessons
      </div>
      <span class="lesson-h-strip-count" id="lh-count"></span>
    </div>
    <div class="lesson-h-track-wrap" id="lh-track-wrap">
      <div class="lesson-h-track" id="lh-track"></div>
    </div>`;
  // Insert after .media-panel inside .course-layout
  const layout = document.querySelector(".course-layout");
  if (layout) layout.appendChild(strip);

  const wrap = strip.querySelector(".lesson-h-track-wrap");
  let startX = 0, scrollStart = 0;
  const DRAG_THRESHOLD = 6; // px of movement before we call it a "drag" (vs. a tap)

  function dragStart(x) {
    lhDragging = true;
    lhDragMoved = false;
    startX = x;
    scrollStart = wrap.scrollLeft;
    lhStopAutoplay();
    if (lhResumeTimer) clearTimeout(lhResumeTimer);
    wrap.classList.add("dragging");
  }
  function dragMove(x) {
    if (!lhDragging) return;
    const dx = x - startX;
    if (Math.abs(dx) > DRAG_THRESHOLD) lhDragMoved = true;
    wrap.scrollLeft = scrollStart - dx;
  }
  function dragEnd() {
    if (!lhDragging) return;
    lhDragging = false;
    wrap.classList.remove("dragging");
    lhPauseThenResume();
  }

  // Mouse drag
  wrap.addEventListener("mousedown", (e) => dragStart(e.pageX));
  window.addEventListener("mousemove", (e) => { if (lhDragging) { e.preventDefault(); dragMove(e.pageX); } });
  window.addEventListener("mouseup", dragEnd);

  // Touch drag (phones/tablets) — passive:false on move so we can prevent
  // the page from vertically scrolling while a horizontal swipe is in progress
  wrap.addEventListener("touchstart", (e) => dragStart(e.touches[0].pageX), { passive: true });
  wrap.addEventListener("touchmove", (e) => { dragMove(e.touches[0].pageX); if (lhDragMoved) e.preventDefault(); }, { passive: false });
  wrap.addEventListener("touchend", dragEnd);
  wrap.addEventListener("touchcancel", dragEnd);

  // Hovering (desktop) also pauses the carousel so a user reading a card
  // isn't yanked away mid-read; leaving resumes it after the quiet delay.
  wrap.addEventListener("mouseenter", lhStopAutoplay);
  wrap.addEventListener("mouseleave", () => { if (!lhDragging) lhPauseThenResume(); });

  return strip;
}

function renderNowPlaying() {
  // no-op: now-playing is shown inline in the horizontal strip (active card)
}

function lessonHCardHtml(l, idx, isActive) {
  const isDoneLesson = isDone(l.id);
  const hasExam = examsForLesson(l.id).length > 0;
  const activeClass = isActive ? " active" : "";
  const doneClass = isDoneLesson ? " done" : "";
  return `
    <div class="lesson-h-card${activeClass}${doneClass}" data-id="${l.id}" style="animation-delay:${Math.min(idx, 10) * 55}ms">
      <div class="lh-top">
        <div class="lh-num">${isDoneLesson ? '<i class="fa-solid fa-check"></i>' : idx + 1}</div>
        <span class="lh-now"><span class="lh-now-dot"></span>Now Playing</span>
      </div>
      <div class="lh-title">${escapeHtml(l.title)}</div>
      <div class="lh-meta">
        <i class="fa-solid fa-clock"></i>
        ${l.duration ? l.duration + " min" : "Video"}
        ${hasExam ? '<i class="fa-solid fa-file-pen lesson-exam-flag" style="margin-left:6px"></i> Exam' : ""}
      </div>
      <div class="lh-play"><i class="fa-solid fa-play"></i></div>
    </div>`;
}

function renderLessonList() {
  const strip = ensureHStrip();
  const track = document.getElementById("lh-track");
  const countEl = document.getElementById("lh-count");
  if (!track) return;

  if (!lessons || !lessons.length) {
    lhStopAutoplay();
    track.innerHTML = `<div class="lesson-marquee-empty" style="padding:20px 8px;color:var(--text-muted);font-size:.85rem">No lessons yet</div>`;
    return;
  }

  if (countEl) countEl.textContent = lessons.length + (lessons.length === 1 ? " Lesson" : " Lessons");

  // Render all cards; active card gets active class
  track.innerHTML = lessons.map((l, i) => lessonHCardHtml(l, i, l.id === activeLesson?.id)).join("");

  track.querySelectorAll(".lesson-h-card").forEach((card) => {
    card.addEventListener("click", () => {
      if (lhDragMoved) return; // a drag just ended on this card — not a real tap
      selectLesson(card.dataset.id);
    });
  });

  // Scroll the active card into view (centered)
  requestAnimationFrame(() => {
    const activeCard = track.querySelector(".lesson-h-card.active");
    const wrap = document.getElementById("lh-track-wrap");
    if (activeCard && wrap) {
      // Strip uses row-reverse so active card might be anywhere
      const cardLeft = activeCard.offsetLeft;
      const cardWidth = activeCard.offsetWidth;
      const wrapWidth = wrap.offsetWidth;
      wrap.scrollLeft = cardLeft - wrapWidth / 2 + cardWidth / 2;
    }
  });

  lhPauseThenResume(); // fresh render (new lesson picked, etc.) — settle, then resume the carousel
}

function resetLessonMarqueeScroll() { /* no-op for horizontal strip */ }
function pauseMarquee() { lhStopAutoplay(); }
function scheduleMarqueeResume() { lhPauseThenResume(); }

function initLessonMarquee() {
  // No vertical marquee — horizontal strip is built lazily in renderLessonList
}


function selectLesson(id) {
  activeLesson = lessons.find((l) => l.id === id);
  activeSlideIndex = 0;
  slideSubView = activeLesson.pdfURL ? "pdf" : "images";
  renderLessonList();
  renderVideo();
  renderSlides();
  els.lessonDesc.textContent = activeLesson.description || "";
  updateCompleteBtn();
  renderLessonExamBanner();
  updateExamTabBadge();
  showTab("video");
}

function renderVideo() {
  const myVToken = ++videoToken;
  // Tear down whatever the previous lesson's player was doing before this
  // lesson's markup replaces it — otherwise its listeners/polling would keep
  // firing against a player that's no longer in the DOM, and one last save
  // is flushed so a lesson closed mid-watch still remembers where it left off.
  if (activeVideoCleanup) { activeVideoCleanup(); activeVideoCleanup = null; }
  if (activePlayerCtl) { activePlayerCtl.destroy(); activePlayerCtl = null; }

  const url = activeLesson.videoURL || "";
  const lessonId = activeLesson.id;
  const yid = youTubeId(url);

  // Google Drive previews stay a plain embedded iframe (Drive's own preview
  // player, not something we can attach the custom skin to) — everything
  // else (YouTube + direct video files) goes through the shared, modern
  // custom player skin in js/video-player.js, unified behind one adapter.
  if (!yid && url && isDriveLink(url)) {
    const preview = drivePreviewUrl(url);
    if (preview) {
      els.videoFrame.innerHTML = `<iframe src="${preview}" allow="autoplay" loading="lazy"></iframe>`;
      return;
    }
  }

  const source = yid ? { type: "youtube", yid } : url ? { type: "file", url } : { type: "empty", message: "No video has been added to this lesson yet" };
  const saved = getSavedVideoProgress(lessonId);
  let lastSavedAt = 0;

  activePlayerCtl = createVideoPlayer(els.videoFrame, source, {
    onReady(duration) {
      if (myVToken !== videoToken) return;
      if (saved?.seconds > 5 && (!duration || saved.seconds < duration - 10)) {
        activePlayerCtl.seek(saved.seconds);
        toast(`ভিডিওটি আগের জায়গা থেকে চালু হলো (${formatTime(Math.floor(saved.seconds))})`, "info");
      }
    },
    onTimeUpdate(t, d) {
      if (myVToken !== videoToken) return;
      if (t - lastSavedAt >= 5) { lastSavedAt = t; saveVideoProgress(lessonId, t, d); }
      if (d && t / d >= 0.9) autoMarkLessonComplete(lessonId);
    },
    onPause(t, d) {
      if (myVToken === videoToken) saveVideoProgress(lessonId, t, d);
    },
  });

  activeVideoCleanup = () => {
    if (myVToken !== videoToken || !activePlayerCtl) return;
    const t = activePlayerCtl.getCurrentTime();
    const d = activePlayerCtl.getDuration();
    if (t > 0) saveVideoProgress(lessonId, t, d);
  };
}

/* ---------- Video resume: read/write saved position ----------
   Stored on the user doc as users/{uid}.videoProgress[courseId][lessonId] =
   { seconds, duration, updatedAt } — same shallow-merge shape as the existing
   `progress` (lesson-done) map, so a single setDoc(..., {merge:true}) never
   clobbers other lessons/courses. Writes are throttled (see the ~5s interval/
   timeupdate-delta checks in the two init*Resume() functions below) rather
   than firing on every frame — video position doesn't need sub-5-second
   precision, and this keeps Firestore writes cheap even on a long lecture. ---------- */
function getSavedVideoProgress(lessonId) {
  return userProfile?.videoProgress?.[courseId]?.[lessonId] || null;
}

async function saveVideoProgress(lessonId, seconds, duration) {
  if (!currentUser || !lessonId || !Number.isFinite(seconds) || seconds < 1) return;
  try {
    const ref = doc(db, "users", currentUser.uid);
    await setDoc(ref, { videoProgress: { [courseId]: { [lessonId]: { seconds: Math.floor(seconds), duration: Math.floor(duration || 0), updatedAt: serverTimestamp() } } } }, { merge: true });
    userProfile.videoProgress = userProfile.videoProgress || {};
    userProfile.videoProgress[courseId] = { ...(userProfile.videoProgress[courseId] || {}), [lessonId]: { seconds: Math.floor(seconds), duration: Math.floor(duration || 0) } };
  } catch {
    // Non-critical — losing one progress tick just means resume falls back a little further next time
  }
}

/* ---------- Auto-complete once a lesson's been watched through ----------
   Quietly (no toast, no auto-advance to the next lesson — that's reserved for
   the deliberate "Mark Lesson as Complete" button click) flips the same
   `progress` flag once watch time crosses 90%, so lessons finished just by
   watching still count toward course completion / the certificate below. ---------- */
async function autoMarkLessonComplete(lessonId) {
  if (isDone(lessonId) || !currentUser) return;
  try {
    const ref = doc(db, "users", currentUser.uid);
    await setDoc(ref, { progress: { [courseId]: { [lessonId]: true } } }, { merge: true });
    userProfile.progress = userProfile.progress || {};
    userProfile.progress[courseId] = { ...(userProfile.progress[courseId] || {}), [lessonId]: true };
    renderLessonList();
    if (activeLesson?.id === lessonId) updateCompleteBtn();
    renderCertificateBanner();
  } catch {
    // Non-critical — the manual "Mark as Complete" button still works as a fallback
  }
}

function renderSlides() {
  const slides = activeLesson.slides || [];
  const pdfUrl = activeLesson.pdfURL || "";

  if (!slides.length && !pdfUrl) {
    els.slidePanel.innerHTML = `<div class="slide-empty">No slides have been added to this lesson</div>`;
    return;
  }

  const subTabsHtml =
    slides.length && pdfUrl
      ? `<div class="slide-subtabs">
          <button class="slide-subtab ${slideSubView === "pdf" ? "active" : ""}" data-view="pdf"><i class="fa-solid fa-file-pdf"></i> PDF Slides</button>
          <button class="slide-subtab ${slideSubView === "images" ? "active" : ""}" data-view="images"><i class="fa-solid fa-image"></i> Image Slides</button>
        </div>`
      : "";

  let bodyHtml = "";
  if (pdfUrl && (slideSubView === "pdf" || !slides.length)) {
    bodyHtml = renderPdfViewerHtml(pdfUrl);
  } else {
    bodyHtml = `
      <div class="slide-viewer">
        <div class="slide-frame"><img id="slide-img" src="${slides[activeSlideIndex]}" alt="Slide ${activeSlideIndex + 1}"></div>
        <div class="slide-controls">
          <button class="btn btn-outline btn-sm" id="slide-prev"><i class="fa-solid fa-arrow-left"></i> Previous</button>
          <div class="slide-dots" id="slide-dots"></div>
          <button class="btn btn-outline btn-sm" id="slide-next">Next <i class="fa-solid fa-arrow-right"></i></button>
        </div>
      </div>`;
  }

  els.slidePanel.innerHTML = subTabsHtml + bodyHtml;

  els.slidePanel.querySelectorAll(".slide-subtab").forEach((btn) =>
    btn.addEventListener("click", () => {
      slideSubView = btn.dataset.view;
      renderSlides();
    })
  );

  const dots = document.getElementById("slide-dots");
  if (dots) {
    dots.innerHTML = slides.map((_, i) => `<span class="${i === activeSlideIndex ? "active" : ""}"></span>`).join("");
    document.getElementById("slide-prev").addEventListener("click", () => changeSlide(-1));
    document.getElementById("slide-next").addEventListener("click", () => changeSlide(1));
  }
}

function renderPdfViewerHtml(pdfUrl) {
  if (isDriveLink(pdfUrl)) {
    const preview = drivePreviewUrl(pdfUrl);
    if (!preview) {
      return `<div class="slide-empty">This PDF link isn't in the right format. <a href="${pdfUrl}" target="_blank" rel="noopener">View the direct link</a></div>`;
    }
    return `
      <div class="pdf-viewer">
        <iframe src="${preview}" allow="autoplay" loading="lazy"></iframe>
      </div>
      <div class="flex justify-between items-center mt-16">
        <span class="muted" style="font-size:0.82rem;">Showing from Drive — check the link if it doesn't load</span>
        <a href="${pdfUrl}" target="_blank" rel="noopener" class="btn btn-outline btn-sm">Open in Drive <i class="fa-solid fa-up-right-from-square"></i></a>
      </div>`;
  }
  return `
    <div class="pdf-viewer">
      <iframe src="${pdfUrl}" loading="lazy"></iframe>
    </div>
    <div class="flex justify-between items-center mt-16">
      <span class="muted" style="font-size:0.82rem;"></span>
      <a href="${pdfUrl}" target="_blank" rel="noopener" class="btn btn-outline btn-sm">Open in New Tab <i class="fa-solid fa-up-right-from-square"></i></a>
    </div>`;
}

function changeSlide(delta) {
  const slides = activeLesson.slides || [];
  activeSlideIndex = (activeSlideIndex + delta + slides.length) % slides.length;
  renderSlides();
}

function showTab(tab) {
  els.videoPanel.classList.toggle("hidden", tab !== "video");
  els.slidePanel.classList.toggle("hidden", tab !== "slides");
  els.examPanel?.classList.toggle("hidden", tab !== "exam");
  els.tabVideo.classList.toggle("active", tab === "video");
  els.tabSlides.classList.toggle("active", tab === "slides");
  els.tabExam?.classList.toggle("active", tab === "exam");
  // Re-rendered every time (not cached) since it depends on activeLesson —
  // switching lessons changes which exam(s) belong in this tab.
  if (tab === "exam") renderCourseExamsTab();
}
function bindTabButtons() {
  // Re-bind every time initCoursePage is called (fresh DOM refs in els)
  els.tabVideo?.addEventListener("click", () => showTab("video"));
  els.tabSlides?.addEventListener("click", () => showTab("slides"));
  els.tabExam?.addEventListener("click", () => showTab("exam"));
}

/* ---------- Small helpers around courseExams — an exam with no lessonIds covers
   the whole course; one with lessonIds only applies to those specific lesson(s) ---------- */
function examsForLesson(lessonId) {
  return courseExams.filter((ex) => ex.lessonIds?.includes(lessonId));
}
function updateExamTabBadge() {
  if (!els.tabExam) return;
  const wholeCourseCount = courseExams.filter((ex) => !ex.lessonIds?.length).length;
  const lessonCount = activeLesson ? examsForLesson(activeLesson.id).length : 0;
  const count = wholeCourseCount + lessonCount;
  els.tabExam.innerHTML = `Exam${count ? ` <span class="tab-count-badge">${count}</span>` : ""}`;
}

/* ---------- Exam banner shown under the video/slides of the currently active lesson,
   if that specific lesson has its own exam(s) attached ---------- */
function renderLessonExamBanner() {
  if (!els.examBanner || !activeLesson) return;
  const matches = examsForLesson(activeLesson.id);
  if (!matches.length) {
    els.examBanner.innerHTML = "";
    return;
  }
  els.examBanner.innerHTML = `
    <div class="lesson-exam-banner">
      <div class="lb-text"><i class="fa-solid fa-file-pen"></i> ${matches.length === 1 ? "This lesson has an exam" : `This lesson has ${toBnDigits(matches.length)} exams`}</div>
      <button type="button" class="btn btn-teal btn-sm" id="lesson-exam-banner-btn">Go to Exam <i class="fa-solid fa-arrow-right"></i></button>
    </div>`;
  // A single lesson-scoped exam transports straight into the exam section
  // (verification → rules → attempt) instead of making the student open the
  // Exam tab first and click again; with more than one, the tab is still
  // needed to choose which one.
  els.examBanner.querySelector("#lesson-exam-banner-btn")?.addEventListener("click", () => {
    if (matches.length === 1) navigate(`#/exam?id=${matches[0].id}`);
    else showTab("exam");
  });
}

/* ---------- Exams shown in the "Exam" tab for the CURRENT context only —
   whole-course exams always apply, plus any exam scoped specifically to the
   lesson that's currently playing. An exam scoped to a different lesson never
   shows up here — it only appears while that other lesson is the active one.
   The course is already known to be unlocked at this point (locked courses return
   early from init() and never reach the lesson/tab UI), so there's no need to
   re-check access here — only each exam's own publish/close schedule and the
   user's attempt count matter. ---------- */
async function renderCourseExamsTab() {
  if (!els.examPanel) return;
  const wholeCourse = courseExams.filter((ex) => !ex.lessonIds?.length);
  const lessonScoped = activeLesson ? examsForLesson(activeLesson.id) : [];
  const relevant = [...wholeCourse, ...lessonScoped];

  if (!relevant.length) {
    els.examPanel.innerHTML = `<div class="empty-state"><div class="icon"><i class="fa-solid fa-file-pen"></i></div><p>${lessonScoped.length === 0 && courseExams.some((ex) => ex.lessonIds?.length) ? "No exam has been added for this lesson yet" : "No exams have been added to this course yet"}</p></div>`;
    return;
  }
  els.examPanel.innerHTML = `<div class="loading-screen"><span class="spinner"></span> Loading...</div>`;
  try {
    let html = "";
    if (lessonScoped.length) {
      const cards = await Promise.all(lessonScoped.map((ex) => buildExamCardHtml(ex, false)));
      html += `<div class="exam-section-title"><i class="fa-solid fa-list-check"></i> This Lesson's Exam</div><div class="exam-grid">${cards.join("")}</div>`;
    }
    if (wholeCourse.length) {
      const cards = await Promise.all(wholeCourse.map((ex) => buildExamCardHtml(ex, false)));
      html += `<div class="exam-section-title"><i class="fa-solid fa-graduation-cap"></i> Course Exams</div><div class="exam-grid">${cards.join("")}</div>`;
    }
    els.examPanel.innerHTML = html;
  } catch {
    els.examPanel.innerHTML = `<div class="empty-state"><p>Couldn't load the exams — please try again</p></div>`;
  }
}

/* ---------- Builds one exam card's HTML — shared by both sections above ---------- */
async function buildExamCardHtml(ex, showLessonTag) {
  const { state, publishAt, closesAt } = getExamAvailability(ex);
  const lessonTag = showLessonTag && ex.lessonNames?.length
    ? `<span class="badge badge-teal exam-lesson-tag"><i class="fa-solid fa-list-check"></i> ${escapeHtml(ex.lessonNames.join(", "))}</span>`
    : "";

  if (state === "upcoming") {
    return `
    <div class="exam-card card exam-card-locked">
      ${lessonTag}
      <h3>${escapeHtml(ex.title)}</h3>
      <p class="muted" style="font-size:0.9rem">${escapeHtml(ex.description || "")}</p>
      <div class="meta-row">
        <span><i class="fa-solid fa-stopwatch"></i> ${ex.duration || 10} min</span>
        <span><i class="fa-solid fa-circle-question"></i> ${getExamQuestionCount(ex)} questions</span>
      </div>
      <span class="badge badge-amber"><i class="fa-solid fa-lock"></i> To be published: ${formatDateTime(publishAt)}</span>
    </div>`;
  }

  let result = null;
  try {
    const resultSnap = await getDoc(doc(db, "results", `${currentUser.uid}_${ex.id}`));
    result = resultSnap.exists() ? resultSnap.data() : null;
  } catch {
    result = null;
  }

  const maxAttempts = Number(ex.maxAttempts || 0);
  const attemptsUsed = maxAttempts > 0 ? Number(result?.attemptNumber || 0) : 0;
  const attemptsExhausted = maxAttempts > 0 && attemptsUsed >= maxAttempts;
  const attemptsMeta = maxAttempts > 0
    ? `<span><i class="fa-solid fa-rotate"></i> Attempts: ${attemptsUsed}/${maxAttempts}</span>`
    : `<span><i class="fa-solid fa-infinity"></i> Unlimited attempts</span>`;

  if (state === "closed") {
    return `
    <div class="exam-card card exam-card-locked">
      ${lessonTag}
      <h3>${escapeHtml(ex.title)}</h3>
      <p class="muted" style="font-size:0.9rem">${escapeHtml(ex.description || "")}</p>
      <div class="meta-row">
        <span><i class="fa-solid fa-stopwatch"></i> ${ex.duration || 10} min</span>
        <span><i class="fa-solid fa-circle-question"></i> ${getExamQuestionCount(ex)} questions</span>
      </div>
      ${result ? `<span class="badge badge-amber result-pill">Previous score: ${result.score}/${result.total}</span>` : ""}
      <span class="badge badge-coral"><i class="fa-solid fa-stopwatch"></i> Time's up (was open until ${formatDateTime(closesAt)})</span>
    </div>`;
  }

  if (attemptsExhausted) {
    return `
    <div class="exam-card card exam-card-locked">
      ${lessonTag}
      <h3>${escapeHtml(ex.title)}</h3>
      <p class="muted" style="font-size:0.9rem">${escapeHtml(ex.description || "")}</p>
      <div class="meta-row">
        <span><i class="fa-solid fa-stopwatch"></i> ${ex.duration || 10} min</span>
        <span><i class="fa-solid fa-circle-question"></i> ${getExamQuestionCount(ex)} questions</span>
      </div>
      ${result ? `<span class="badge badge-amber result-pill">Last score: ${result.score}/${result.total}</span>` : ""}
      <span class="badge badge-coral"><i class="fa-solid fa-ban"></i> You have already taken the exam</span>
    </div>`;
  }

  return `
  <div class="exam-card card">
    ${lessonTag}
    <h3>${escapeHtml(ex.title)}</h3>
    <p class="muted" style="font-size:0.9rem">${escapeHtml(ex.description || "")}</p>
    <div class="meta-row">
      <span><i class="fa-solid fa-stopwatch"></i> ${ex.duration || 10} min</span>
      <span><i class="fa-solid fa-circle-question"></i> ${getExamQuestionCount(ex)} questions</span>
      ${attemptsMeta}
    </div>
    ${result ? `<span class="badge badge-amber result-pill">Last score: ${result.score}/${result.total}</span>` : ""}
    <a href="#/exam?id=${ex.id}" class="btn btn-primary btn-block">${result ? "Retake Exam" : "Start Exam"}</a>
  </div>`;
}

function updateCompleteBtn() {
  const done = isDone(activeLesson.id);
  els.completeBtn.innerHTML = done ? '<i class="fa-solid fa-check"></i> Completed' : "Mark Lesson as Complete";
  els.completeBtn.classList.toggle("btn-teal", done);
  els.completeBtn.classList.toggle("btn-primary", !done);
}

/* ---------- Course completion certificate banner ----------
   Shown in the course header once every lesson in this course is marked done
   (manually via the button, or automatically by watching a video through —
   see autoMarkLessonComplete()). Re-checked after every completion event, not
   just once on page load, so the banner appears the instant the last lesson
   is finished without needing a page refresh. ---------- */
function isCourseFullyComplete() {
  if (!lessons.length) return false;
  const doneMap = userProfile?.progress?.[courseId] || {};
  return lessons.every((l) => !!doneMap[l.id]);
}

function certificateIdFor() {
  const a = (courseId || "").replace(/[^a-zA-Z0-9]/g, "").slice(0, 4).toUpperCase();
  const b = (currentUser?.uid || "").replace(/[^a-zA-Z0-9]/g, "").slice(0, 6).toUpperCase();
  return `TVC-${a}-${b}`;
}

function renderCertificateBanner() {
  const box = document.getElementById("course-certificate-box");
  if (!box) return;
  if (!isCourseFullyComplete()) {
    box.innerHTML = "";
    return;
  }
  box.innerHTML = `
    <div class="course-enroll-pill certificate-pill" id="course-certificate-btn" style="display:inline-flex;cursor:pointer;">
      <i class="fa-solid fa-award"></i> কোর্সটি সম্পূর্ণ হয়েছে — সার্টিফিকেট ডাউনলোড করুন
    </div>`;
  document.getElementById("course-certificate-btn")?.addEventListener("click", async (e) => {
    const btn = e.currentTarget;
    const original = btn.innerHTML;
    btn.innerHTML = '<span class="spinner"></span> তৈরি হচ্ছে...';
    try {
      await generateCertificatePdf({
        studentName: userProfile?.displayName || currentUser?.email?.split("@")[0] || "Student",
        courseTitle: currentCourse?.title || "",
        certificateId: certificateIdFor(),
      });
    } finally {
      btn.innerHTML = original;
    }
  });
}

function bindCompleteButton() {
  els.completeBtn?.addEventListener("click", async () => {
    if (!activeLesson || isDone(activeLesson.id)) return;
    const ref = doc(db, "users", currentUser.uid);
    await setDoc(ref, { progress: { [courseId]: { [activeLesson.id]: true } } }, { merge: true });
    userProfile.progress = userProfile.progress || {};
    userProfile.progress[courseId] = { ...(userProfile.progress[courseId] || {}), [activeLesson.id]: true };
    renderLessonList();
    updateCompleteBtn();
    renderCertificateBanner();
    toast("Lesson complete! Moving on to the next lesson", "success");

    const idx = lessons.findIndex((l) => l.id === activeLesson.id);
    if (idx < lessons.length - 1) {
      setTimeout(() => selectLesson(lessons[idx + 1].id), 700);
    }
  });
}
