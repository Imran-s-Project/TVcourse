// ==========================================================================
// profile.js — Profile, my courses, purchase history, results, settings, account security
// Exported as initProfilePage() for the SPA router (app.js). Previously ran
// automatically as this page's own top-level script when profile.html was a
// standalone file; now the router calls it once, after js/page-profile.js's
// markup has been mounted into index.html.
// ==========================================================================
import { auth, db, storage } from "./firebase-config.js";
import {
  updateProfile,
  EmailAuthProvider,
  reauthenticateWithCredential,
  reauthenticateWithPopup,
  GoogleAuthProvider,
  FacebookAuthProvider,
  GithubAuthProvider,
  OAuthProvider,
  linkWithPopup,
  unlink,
  updatePassword,
  deleteUser,
} from "https://www.gstatic.com/firebasejs/10.13.0/firebase-auth.js";
import {
  doc,
  getDoc,
  updateDoc,
  deleteDoc,
  collection,
  getDocs,
  query,
  where,
} from "https://www.gstatic.com/firebasejs/10.13.0/firebase-firestore.js";
import { ref, uploadBytes, getDownloadURL, deleteObject } from "https://www.gstatic.com/firebasejs/10.13.0/firebase-storage.js";
import { requireAuth, getUserProfile, toast, escapeHtml, toBnDigits, formatDate, confirmAction, openModal, closeModal } from "./utils.js";

let currentUser = null;
let profile = null;
let allCourses = [];
let allResults = [];
let myPurchases = [];

// ── Public entry point — called once by app.js on the first #/profile visit ────
export async function initProfilePage() {
  await init();
}

async function init() {
  currentUser = await requireAuth();
  if (!currentUser) return;
  profile = await getUserProfile(currentUser.uid);
  renderHeader();
  bindTabs();
  loadMyCourses();
  loadPurchases();
  loadResults();
  bindSettingsForm();
  bindPasswordForm();
  bindLinkedAccounts();
  bindDeleteAccount();
  if (profile?.isAdmin) {
    document.getElementById("admin-shortcut-btn")?.classList.remove("hidden");
  }
}

function renderHeader() {
  document.getElementById("profile-name").textContent = profile?.displayName || currentUser.email.split("@")[0];
  document.getElementById("profile-email").textContent = currentUser.email;
  const avatarBox = document.getElementById("profile-avatar");
  avatarBox.innerHTML = profile?.photoURL
    ? `<img src="${profile.photoURL}" alt="Profile picture">`
    : `<span>${(profile?.displayName || currentUser.email).charAt(0).toUpperCase()}</span>`;
  document.getElementById("settings-name").value = profile?.displayName || "";

  const metaBox = document.getElementById("profile-meta");
  const joined = profile?.createdAt ? formatDate(profile.createdAt) : "";
  const provider = currentUser.providerData?.[0]?.providerId === "google.com" ? "Google Account" : "Email Account";
  metaBox.innerHTML = `
    ${joined ? `<span><i class="fa-regular fa-calendar"></i> Joined ${joined}</span>` : ""}
    <span><i class="fa-solid fa-user-shield"></i> ${provider}</span>
    ${profile?.isAdmin ? `<span class="badge badge-amber">Admin</span>` : ""}
  `;
}

/* ---------- Quick stats strip ---------- */
function renderStats() {
  const box = document.getElementById("profile-stats");
  const enrolledCount = (profile?.enrolledCourses || []).length;
  const examCount = allResults.length;
  const avgScore = examCount
    ? Math.round((allResults.reduce((sum, r) => sum + (r.total ? r.score / r.total : 0), 0) / examCount) * 100)
    : 0;
  box.innerHTML = `
    <div class="stat-card card">
      <i class="fa-solid fa-book-open"></i>
      <div><b>${enrolledCount}</b><span>Enrolled Courses</span></div>
    </div>
    <div class="stat-card card">
      <i class="fa-solid fa-file-pen"></i>
      <div><b>${examCount}</b><span>Exams Taken</span></div>
    </div>
    <div class="stat-card card">
      <i class="fa-solid fa-chart-line"></i>
      <div><b>${avgScore}%</b><span>Average Score</span></div>
    </div>
  `;
}

/* ---------- Tab switching ---------- */
function bindTabs() {
  document.querySelectorAll(".tab-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      document.querySelectorAll(".tab-btn").forEach((b) => b.classList.remove("active"));
      document.querySelectorAll(".tab-panel").forEach((p) => p.classList.add("hidden"));
      btn.classList.add("active");
      document.getElementById(btn.dataset.tab).classList.remove("hidden");
    });
  });
}

// Lets the router (app.js) force a specific tab open — used by the navbar's
// "My Courses" link (index.html#/profile?tab=courses) so it always lands on
// that tab even if the user was previously viewing a different one.
export function activateTab(tabKey) {
  if (!tabKey) return;
  const btn = document.querySelector(`.tab-btn[data-tab="tab-${tabKey}"]`);
  if (!btn) return;
  document.querySelectorAll(".tab-btn").forEach((b) => b.classList.remove("active"));
  document.querySelectorAll(".tab-panel").forEach((p) => p.classList.add("hidden"));
  btn.classList.add("active");
  document.getElementById(btn.dataset.tab)?.classList.remove("hidden");
}

/* ---------- My courses ---------- */
async function loadMyCourses() {
  const wrap = document.getElementById("my-courses-list");
  const enrolled = profile?.enrolledCourses || [];
  if (!enrolled.length) {
    wrap.innerHTML = `<div class="empty-state"><div class="icon"><i class="fa-solid fa-book-open"></i></div><p>Not enrolled in any courses yet</p></div>`;
    return;
  }
  const snap = await getDocs(collection(db, "courses"));
  allCourses = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
  const mine = allCourses.filter((c) => enrolled.includes(c.id));
  wrap.innerHTML = mine
    .map((c) => {
      const doneMap = profile?.progress?.[c.id] || {};
      const doneCount = Object.values(doneMap).filter(Boolean).length;
      const pct = c.lessonCount ? Math.round((doneCount / c.lessonCount) * 100) : 0;
      return `
      <a href="index.html#/course?id=${c.id}" class="my-course-row card">
        <img src="${c.coverImage || ""}" alt="">
        <div class="info">
          <h4>${escapeHtml(c.title)}</h4>
          <div class="progress-track" style="background:var(--bg-elevated-2)"><div class="progress-fill" style="width:${pct}%"></div></div>
        </div>
        <span class="badge badge-amber">${pct}%</span>
      </a>`;
    })
    .join("");
}

/* ---------- Exam results ---------- */
async function loadResults() {
  const wrap = document.getElementById("results-list");
  wrap.innerHTML = `<div class="loading-screen"><span class="spinner"></span></div>`;
  try {
    const snap = await getDocs(query(collection(db, "results"), where("uid", "==", currentUser.uid)));
    allResults = snap.docs.map((d) => d.data()).sort((a, b) => (b.submittedAt?.seconds || 0) - (a.submittedAt?.seconds || 0));
    renderStats();
    if (!allResults.length) {
      wrap.innerHTML = `<div class="empty-state"><div class="icon"><i class="fa-solid fa-file-pen"></i></div><p>No exams taken yet</p></div>`;
      return;
    }
    wrap.innerHTML = allResults
      .map(
        (r) => `
      <div class="result-row card">
        <div>
          <h4>${escapeHtml(r.examTitle || "Exam")}</h4>
          <span class="muted" style="font-size:0.82rem">${formatDate(r.submittedAt)}</span>
        </div>
        <div class="score">${r.score}/${r.total}</div>
      </div>`
      )
      .join("");
  } catch {
    wrap.innerHTML = `<div class="empty-state"><p>Could not load results</p></div>`;
    renderStats();
  }
}

/* ---------- Purchase history (all purchaseRequests together) ---------- */
async function loadPurchases() {
  const wrap = document.getElementById("purchases-list");
  wrap.innerHTML = `<div class="loading-screen"><span class="spinner"></span></div>`;
  try {
    const snap = await getDocs(query(collection(db, "purchaseRequests"), where("uid", "==", currentUser.uid)));
    const purchases = snap.docs.map((d) => ({ id: d.id, ...d.data() })).sort((a, b) => (b.createdAt?.seconds || 0) - (a.createdAt?.seconds || 0));
    myPurchases = purchases;
    if (!purchases.length) {
      wrap.innerHTML = `<div class="empty-state"><div class="icon"><i class="fa-solid fa-receipt"></i></div><p>No course purchase requests made yet</p></div>`;
      return;
    }
    const statusInfo = (s) =>
      s === "approved" ? { label: "Approved", cls: "badge-teal", icon: "fa-circle-check" } :
      s === "rejected" ? { label: "Rejected", cls: "badge-coral", icon: "fa-circle-xmark" } :
      { label: "Under Review", cls: "badge-amber", icon: "fa-clock" };
    wrap.innerHTML = purchases
      .map((p) => {
        const s = statusInfo(p.status);
        return `
      <div class="purchase-row card">
        <div class="info">
          <h4>${escapeHtml(p.courseTitle || "")}</h4>
          <span class="muted" style="font-size:0.82rem">${escapeHtml(p.paymentMethod || "")} · ৳${p.amount || 0} ${p.createdAt ? "· " + formatDate(p.createdAt) : ""}</span>
        </div>
        <div class="purchase-row-actions">
          <span class="badge ${s.cls}"><i class="fa-solid ${s.icon}"></i> ${s.label}</span>
          <button type="button" class="btn btn-outline btn-sm" data-purchase-pdf="${p.id}" title="Download as PDF"><i class="fa-solid fa-file-pdf"></i> PDF</button>
        </div>
      </div>`;
      })
      .join("");
    wrap.querySelectorAll("[data-purchase-pdf]").forEach((btn) =>
      btn.addEventListener("click", () => downloadMyPurchasePdf(btn.dataset.purchasePdf, btn))
    );
  } catch {
    wrap.innerHTML = `<div class="empty-state"><p>Could not load purchase information</p></div>`;
  }
}

/* ---------- Download a purchase as a PDF — student-facing "Enrollment
   Invoice". Deliberately styled differently from the admin panel's internal
   receipt (which uses an indigo card + "Purchase Receipt" wording): this one
   uses the site's own navy/amber brand colours, a full-width invoice header,
   a coloured status ribbon instead of a small badge, and softer "for your
   personal records" language aimed at the student rather than staff. ---------- */
let myPdfLogoCache = null;
function loadMyPdfLogo() {
  if (myPdfLogoCache !== null) return Promise.resolve(myPdfLogoCache);
  return new Promise((resolve) => {
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = () => { myPdfLogoCache = img; resolve(img); };
    img.onerror = () => { myPdfLogoCache = false; resolve(false); };
    img.src = "assets/logo.png";
  });
}

async function downloadMyPurchasePdf(id, triggerBtn) {
  const p = myPurchases.find((x) => x.id === id);
  if (!p) return;
  const { jsPDF } = window.jspdf || {};
  if (!jsPDF) { toast("Couldn't load the PDF engine. Check your connection and try again.", "error"); return; }

  const originalHtml = triggerBtn?.innerHTML;
  if (triggerBtn) {
    triggerBtn.disabled = true;
    triggerBtn.innerHTML = '<span class="spinner"></span>';
  }

  try {
    const logoImg = await loadMyPdfLogo();

    const W = 440, H = 660;
    const doc = new jsPDF({ unit: "pt", format: [W, H], orientation: "portrait" });

    const hex = (h) => {
      h = h.replace("#", "");
      return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];
    };
    const setFill = (c) => { const [r, g, b] = hex(c); doc.setFillColor(r, g, b); };
    const setDraw = (c) => { const [r, g, b] = hex(c); doc.setDrawColor(r, g, b); };
    const setTxt  = (c) => { const [r, g, b] = hex(c); doc.setTextColor(r, g, b); };

    /* Palette — pulled from the site's own theme (manifest theme_color +
       amber accent), not the admin panel's indigo scheme. */
    const NAVY    = "#14182B";
    const AMBER   = "#E8A33D";
    const BG      = "#FAF7F1";
    const CARD    = "#ffffff";
    const LABEL_C = "#6b7280";
    const VAL_C   = "#111827";
    const DIV_C   = "#e8e2d6";
    const RIBBON_COLORS = {
      approved: { bg: "#16a34a", text: "#ffffff", label: "Approved — Access Granted", icon: "check" },
      rejected: { bg: "#dc2626", text: "#ffffff", label: "Rejected", icon: "cross" },
      pending:  { bg: "#d97706", text: "#ffffff", label: "Under Review", icon: "clock" },
    };

    setFill(BG);
    doc.rect(0, 0, W, H, "F");

    const pad = 22, cardX = pad, cardY = 16, cardW = W - pad * 2, cardH = H - 32;
    setFill(CARD);
    setDraw(DIV_C);
    doc.setLineWidth(0.5);
    doc.roundedRect(cardX, cardY, cardW, cardH, 10, 10, "FD");

    /* ── Header: full navy band, amber subtitle, "STUDENT COPY" tag ── */
    setFill(NAVY);
    doc.roundedRect(cardX, cardY, cardW, 80, 10, 10, "F");
    setFill(NAVY);
    doc.rect(cardX, cardY + 60, cardW, 20, "F");

    if (logoImg) doc.addImage(logoImg, "PNG", cardX + 18, cardY + 16, 36, 36);
    doc.setFont(undefined, "bold");
    doc.setFontSize(15);
    setTxt("#ffffff");
    doc.text("Tech Verse Course", cardX + (logoImg ? 62 : 18), cardY + 34);
    doc.setFont(undefined, "normal");
    doc.setFontSize(8.5);
    setTxt(AMBER);
    doc.text("Course Enrollment Invoice", cardX + (logoImg ? 62 : 18), cardY + 48);

    doc.setFont(undefined, "bold");
    doc.setFontSize(6.5);
    setTxt("#c9cddc");
    doc.text("STUDENT COPY", cardX + cardW - 16, cardY + 20, { align: "right" });

    /* ── Course title ── */
    let y = cardY + 100;
    setTxt(NAVY);
    doc.setFont(undefined, "bold");
    doc.setFontSize(13);
    const courseLines = doc.splitTextToSize(p.courseTitle || "Course", cardW - 32);
    doc.text(courseLines, cardX + 16, y);
    y += courseLines.length * 17 + 8;

    /* Invoice no. pill */
    setFill("#fdf3e2");
    doc.roundedRect(cardX + 16, y, cardW - 32, 18, 4, 4, "F");
    setTxt("#92610f");
    doc.setFont(undefined, "normal");
    doc.setFontSize(7.5);
    doc.text(`INVOICE NO: ${p.id}`, cardX + 22, y + 12);
    y += 30;

    /* ── Status ribbon (full width, not a small badge) ── */
    const statusKey = (p.status === "approved" || p.status === "rejected") ? p.status : "pending";
    const rc = RIBBON_COLORS[statusKey];
    setFill(rc.bg);
    doc.roundedRect(cardX + 16, y, cardW - 32, 26, 6, 6, "F");
    setTxt(rc.text);
    doc.setFont(undefined, "bold");
    doc.setFontSize(9.5);
    doc.text(rc.label, cardX + cardW / 2, y + 17, { align: "center" });
    y += 40;

    setDraw(DIV_C);
    doc.setLineWidth(0.5);
    doc.line(cardX + 16, y, cardX + cardW - 16, y);
    y += 16;

    /* ── Info rows ── */
    const col1X = cardX + 16;
    const col2X = cardX + cardW / 2 + 4;
    const colW  = cardW / 2 - 24;
    const infoCell = (label, value, x, cy) => {
      doc.setFont(undefined, "normal");
      doc.setFontSize(7.5);
      setTxt(LABEL_C);
      doc.text(label.toUpperCase(), x, cy);
      cy += 12;
      doc.setFont(undefined, "bold");
      doc.setFontSize(9.5);
      setTxt(VAL_C);
      const vLines = doc.splitTextToSize(String(value || "—"), colW);
      doc.text(vLines, x, cy);
      return cy + vLines.length * 12 + 10;
    };

    const r1L = infoCell("Student Name", p.userName, col1X, y);
    const r1R = infoCell("Email", p.userEmail, col2X, y);
    y = Math.max(r1L, r1R);

    const payVal = `${p.paymentMethod || "—"}${p.senderNumber ? ` (${p.senderNumber})` : ""}`;
    const r2L = infoCell("Phone", p.phone, col1X, y);
    const r2R = infoCell("Payment Method", payVal, col2X, y);
    y = Math.max(r2L, r2R);

    if (p.transactionId) {
      const r3L = infoCell("Transaction ID", p.transactionId, col1X, y);
      const r3R = infoCell("Amount Paid", `৳${p.amount || 0}`, col2X, y);
      y = Math.max(r3L, r3R);
    } else {
      y = infoCell("Amount Paid", `৳${p.amount || 0}`, col1X, y);
    }

    const r4L = infoCell("Requested On", formatDate(p.createdAt), col1X, y);
    const r4R = p.reviewedAt ? infoCell("Reviewed On", formatDate(p.reviewedAt), col2X, y) : y;
    y = Math.max(r4L, typeof r4R === "number" ? r4R : y);

    /* ── Access code — dashed border to read distinctly from the admin card ── */
    if (p.status === "approved" && p.accessCode) {
      y += 4;
      setDraw(DIV_C);
      doc.line(cardX + 16, y, cardX + cardW - 16, y);
      y += 14;

      setFill("#fdf3e2");
      setDraw(AMBER);
      doc.setLineWidth(1.1);
      doc.setLineDashPattern([3, 2], 0);
      doc.roundedRect(cardX + 16, y, cardW - 32, 48, 6, 6, "FD");
      doc.setLineDashPattern([], 0);

      doc.setFont(undefined, "normal");
      doc.setFontSize(7.5);
      setTxt("#92610f");
      doc.text("YOUR ACCESS CODE", cardX + 26, y + 15);

      doc.setFont(undefined, "bold");
      doc.setFontSize(14);
      setTxt(NAVY);
      doc.text((p.accessCode.replace(/(.{5})(?=.)/g, "$1-")), cardX + 26, y + 35);
      y += 60;
    }

    /* ── Footer — student-facing note ── */
    y = cardY + cardH - 40;
    setDraw(DIV_C);
    doc.line(cardX + 16, y, cardX + cardW - 16, y);
    y += 14;
    setTxt(LABEL_C);
    doc.setFont(undefined, "normal");
    doc.setFontSize(7);
    const noteLines = doc.splitTextToSize("This is a system-generated document for your personal records. It is not required to access your course.", cardW - 32);
    doc.text(noteLines, cardX + 16, y);
    y += noteLines.length * 9 + 4;
    doc.text(`Generated ${new Date().toLocaleDateString("en-GB")}`, cardX + 16, y);

    /* ── Watermark ── */
    if (logoImg) {
      doc.saveGraphicsState();
      doc.setGState(new doc.GState({ opacity: 0.045 }));
      const wmS = 210;
      doc.addImage(logoImg, "PNG", (W - wmS) / 2, (H - wmS) / 2, wmS, wmS, undefined, undefined, -25);
      doc.restoreGraphicsState();
    }

    const safeCourse = (p.courseTitle || "course").replace(/[^a-z0-9\u0980-\u09FF]+/gi, "_").slice(0, 40);
    doc.save(`TechVerseCourse_${safeCourse}_invoice.pdf`);
  } catch (err) {
    console.error(err);
    toast("Failed to generate the PDF. Please try again.", "error");
  } finally {
    if (triggerBtn) {
      triggerBtn.disabled = false;
      triggerBtn.innerHTML = originalHtml;
    }
  }
}

/* ---------- Settings: name and profile picture ---------- */
function bindSettingsForm() {
  document.getElementById("settings-form")?.addEventListener("submit", async (e) => {
    e.preventDefault();
    const name = document.getElementById("settings-name").value.trim();
    const fileInput = document.getElementById("settings-avatar");
    const btn = document.getElementById("settings-save-btn");
    btn.disabled = true;
    btn.innerHTML = `<span class="spinner"></span>`;
    try {
      let photoURL = profile?.photoURL || "";
      if (fileInput.files[0]) {
        const fileRef = ref(storage, `avatars/${currentUser.uid}`);
        await uploadBytes(fileRef, fileInput.files[0]);
        photoURL = await getDownloadURL(fileRef);
      }
      await updateDoc(doc(db, "users", currentUser.uid), { displayName: name, photoURL });
      await updateProfile(currentUser, { displayName: name, photoURL });
      profile.displayName = name;
      profile.photoURL = photoURL;
      renderHeader();
      toast("Profile updated", "success");
    } catch (err) {
      toast("Could not update", "error");
    } finally {
      btn.disabled = false;
      btn.textContent = "Save";
    }
  });
}

/* ---------- Re-authenticate before sensitive actions (Firebase security requirement) ----------
   For a password account, re-verify with the current password; for a Google account, via a Google popup */
async function reauthenticate({ passwordFromForm } = {}) {
  const isGoogle = currentUser.providerData?.[0]?.providerId === "google.com";
  if (isGoogle) {
    await reauthenticateWithPopup(currentUser, new GoogleAuthProvider());
    return;
  }
  const password = passwordFromForm || (await askPasswordModal());
  if (!password) throw new Error("password-cancelled");
  const cred = EmailAuthProvider.credential(currentUser.email, password);
  await reauthenticateWithCredential(currentUser, cred);
}

/* ---------- Custom password-request box before delete (not the native prompt()) ---------- */
function askPasswordModal() {
  return new Promise((resolve) => {
    const overlay = openModal(`
      <div class="modal-head"><h3>Confirmation Required</h3><button class="modal-close-btn" data-modal-close><i class="fa-solid fa-xmark"></i></button></div>
      <p class="muted" style="font-size:0.9rem;margin-bottom:14px;">For security, please enter your current password</p>
      <form id="reauth-form">
        <div class="field"><label>Password</label><input type="password" id="reauth-password" required autocomplete="current-password"></div>
        <button type="submit" class="btn btn-primary btn-block">Confirm</button>
      </form>
    `, { onClose: () => resolve(null) });
    overlay.querySelector("#reauth-form").addEventListener("submit", (e) => {
      e.preventDefault();
      const val = overlay.querySelector("#reauth-password").value;
      overlay._onClose = null;
      closeModal();
      resolve(val);
    });
  });
}

/* ---------- Change password ---------- */
function bindPasswordForm() {
  const form = document.getElementById("password-form");
  const isGoogle = currentUser.providerData?.[0]?.providerId === "google.com";
  if (isGoogle) {
    form.innerHTML = `
      <h3 class="panel-title"><i class="fa-solid fa-key"></i> Change Password</h3>
      <p class="muted panel-desc">You signed in with Google — there's no need to change this account's password from Tech Verse Course, it's controlled by your Google account.</p>`;
    return;
  }
  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    const errorEl = document.getElementById("password-error");
    const btn = document.getElementById("password-save-btn");
    errorEl.textContent = "";
    const current = document.getElementById("current-password").value;
    const next = document.getElementById("new-password").value;
    const confirm = document.getElementById("confirm-password").value;
    if (next !== confirm) {
      errorEl.textContent = "The new passwords don't match";
      return;
    }
    btn.disabled = true;
    btn.innerHTML = `<span class="spinner"></span>`;
    try {
      await reauthenticate({ passwordFromForm: current });
      await updatePassword(currentUser, next);
      toast("Password changed", "success");
      form.reset();
    } catch (err) {
      errorEl.textContent = err.code === "auth/wrong-password" || err.code === "auth/invalid-credential"
        ? "Current password is incorrect"
        : "Could not change password, please try again";
    } finally {
      btn.disabled = false;
      btn.textContent = "Update Password";
    }
  });
}

/* ---------- Linked accounts (Google / Facebook / GitHub / Yahoo / Apple) ----------
   Uses Firebase's account-linking API (linkWithPopup/unlink) so a user can attach
   several sign-in methods to the SAME account instead of creating separate ones.
   Note: Google Play isn't a Firebase/OAuth identity provider — there's no
   "Sign in with Google Play" credential to link, so it's intentionally not
   listed here (see chat reply for details). */
const LINKABLE_PROVIDERS = [
  { id: "google.com", label: "Google", icon: "fa-brands fa-google", make: () => new GoogleAuthProvider() },
  { id: "facebook.com", label: "Facebook", icon: "fa-brands fa-facebook", make: () => new FacebookAuthProvider() },
  { id: "github.com", label: "GitHub", icon: "fa-brands fa-github", make: () => new GithubAuthProvider() },
  { id: "yahoo.com", label: "Yahoo", icon: "fa-brands fa-yahoo", make: () => new OAuthProvider("yahoo.com") },
  { id: "apple.com", label: "Apple", icon: "fa-brands fa-apple", note: "iPhone/iPad", make: () => new OAuthProvider("apple.com") },
];

function renderLinkedAccounts() {
  const wrap = document.getElementById("linked-accounts-list");
  if (!wrap) return;
  wrap.innerHTML = LINKABLE_PROVIDERS.map((p) => {
    const linkedInfo = currentUser.providerData.find((pd) => pd.providerId === p.id);
    const isLinked = !!linkedInfo;
    return `
    <div class="linked-account-row" data-provider="${p.id}">
      <div class="linked-account-info">
        <span class="linked-provider-icon"><i class="${p.icon}"></i></span>
        <div>
          <h4>${p.label}${p.note ? ` <span class="note-tag">(${p.note})</span>` : ""}</h4>
          <span class="muted linked-status ${isLinked ? "is-connected" : ""}">
            ${isLinked ? `<i class="fa-solid fa-circle-check"></i> Connected${linkedInfo.email ? " · " + escapeHtml(linkedInfo.email) : ""}` : "Not connected"}
          </span>
        </div>
      </div>
      <button type="button" class="btn ${isLinked ? "btn-outline" : "btn-primary"} btn-sm" data-provider="${p.id}" data-action="${isLinked ? "disconnect" : "connect"}">
        ${isLinked ? "Disconnect" : "Connect"}
      </button>
    </div>`;
  }).join("");
}

function mapLinkError(code, label) {
  const map = {
    "auth/credential-already-in-use": `এই ${label} অ্যাকাউন্টটি ইতিমধ্যে অন্য একটি ইউজারের সাথে যুক্ত আছে`,
    "auth/email-already-in-use": `এই ${label} অ্যাকাউন্টের ইমেইল দিয়ে ইতিমধ্যে অন্য একটি অ্যাকাউন্ট আছে`,
    "auth/provider-already-linked": `${label} ইতিমধ্যে যুক্ত করা আছে`,
    "auth/popup-closed-by-user": `${label} কানেক্ট করা বাতিল হয়েছে`,
    "auth/cancelled-popup-request": `${label} কানেক্ট করা বাতিল হয়েছে`,
    "auth/account-exists-with-different-credential": `এই ${label} ইমেইল দিয়ে অন্য একটি লগইন পদ্ধতিতে ইতিমধ্যে অ্যাকাউন্ট আছে`,
    "auth/requires-recent-login": `নিরাপত্তার জন্য আবার লগইন করে তারপর ${label} কানেক্ট করুন`,
    "auth/popup-blocked": "ব্রাউজার পপ-আপ ব্লক করেছে — পপ-আপ অনুমতি দিয়ে আবার চেষ্টা করুন",
    "auth/unauthorized-domain": "এই ডোমেইনের জন্য এই সাইন-ইন পদ্ধতিটি এখনো Firebase-এ অনুমোদিত না",
    "auth/operation-not-supported-in-this-environment": `এই ব্রাউজারে ${label} সাইন-ইন সাপোর্ট করে না`,
  };
  return map[code] || `${label} কানেক্ট করা যায়নি, আবার চেষ্টা করুন`;
}

function bindLinkedAccounts() {
  renderLinkedAccounts();
  document.getElementById("linked-accounts-list")?.addEventListener("click", async (e) => {
    const btn = e.target.closest("button[data-action]");
    if (!btn) return;
    const providerDef = LINKABLE_PROVIDERS.find((p) => p.id === btn.dataset.provider);
    if (!providerDef) return;
    const action = btn.dataset.action;

    if (action === "disconnect") {
      if (currentUser.providerData.length <= 1) {
        toast("লগইনের শেষ পদ্ধতি ডিসকানেক্ট করা যাবে না — আগে অন্য একটি অ্যাকাউন্ট যুক্ত করুন", "error");
        return;
      }
      const ok = await confirmAction(
        `আপনার ${providerDef.label} অ্যাকাউন্ট ডিসকানেক্ট করবেন? এটি দিয়ে আর লগইন করতে পারবেন না।`,
        { title: `${providerDef.label} ডিসকানেক্ট করবেন?`, confirmLabel: "হ্যাঁ, ডিসকানেক্ট করুন", danger: true }
      );
      if (!ok) return;
    }

    btn.disabled = true;
    btn.innerHTML = `<span class="spinner"></span>`;
    try {
      if (action === "connect") {
        await linkWithPopup(currentUser, providerDef.make());
        toast(`${providerDef.label} অ্যাকাউন্ট যুক্ত হয়েছে`, "success");
      } else {
        await unlink(currentUser, providerDef.id);
        toast(`${providerDef.label} অ্যাকাউন্ট ডিসকানেক্ট হয়েছে`, "success");
      }
      await currentUser.reload();
      renderHeader();
    } catch (err) {
      toast(mapLinkError(err.code, providerDef.label), "error");
    } finally {
      renderLinkedAccounts();
    }
  });
}

/* ---------- Permanently delete account ---------- */
function bindDeleteAccount() {
  document.getElementById("delete-account-btn")?.addEventListener("click", async () => {
    const ok = await confirmAction(
      "Your account, profile picture, and login information will be permanently deleted. This action cannot be undone. Are you sure?",
      { title: "Delete Account?", confirmLabel: "Yes, Delete", danger: true }
    );
    if (!ok) return;
    try {
      await reauthenticate();
      await deleteObject(ref(storage, `avatars/${currentUser.uid}`)).catch(() => {});
      await deleteDoc(doc(db, "users", currentUser.uid)).catch(() => {});
      await deleteUser(currentUser);
      toast("Your account has been deleted", "success");
      setTimeout(() => (window.location.href = "index.html"), 800);
    } catch (err) {
      if (err.message === "password-cancelled") return;
      toast("Could not delete account, please try again", "error");
    }
  });
}

