// ==========================================================================
// utils.js — Shared helper functions
// ==========================================================================
import { auth, db } from "./firebase-config.js";
import { onAuthStateChanged, signOut } from "https://www.gstatic.com/firebasejs/10.13.0/firebase-auth.js";
import { doc, getDoc, updateDoc, serverTimestamp } from "https://www.gstatic.com/firebasejs/10.13.0/firebase-firestore.js";

/* ---------- Toast notifications ---------- */
export function toast(message, type = "info") {
  let root = document.getElementById("toast-root");
  if (!root) {
    root = document.createElement("div");
    root.id = "toast-root";
    document.body.appendChild(root);
  }
  const el = document.createElement("div");
  el.className = `toast ${type}`;
  el.innerHTML = message;
  root.appendChild(el);
  setTimeout(() => {
    el.style.transition = "opacity .3s, transform .3s";
    el.style.opacity = "0";
    el.style.transform = "translateY(10px)";
    setTimeout(() => el.remove(), 300);
  }, 3000);
}

/* ---------- Fetch the current user's profile document ---------- */
export async function getUserProfile(uid) {
  const snap = await getDoc(doc(db, "users", uid));
  return snap.exists() ? { id: snap.id, ...snap.data() } : null;
}

/* ---------- Course price / Free-Paid helpers ----------
   Single source of truth for "is this course free or paid" and what price
   to show. Every place that renders a course card/row must call this
   instead of reading course.price directly, so a course's badge can only
   ever be built from that same course's own fields — never mixed up with
   another course, and never broken by a Firestore value being blank/text. */
function normalizePrice(val) {
  const n = Number(val);
  return Number.isFinite(n) && n > 0 ? n : 0;
}

export function getCoursePricing(course = {}) {
  const price = normalizePrice(course.price);
  const discountPrice = normalizePrice(course.discountPrice);
  const isPaid = price > 0;
  const hasDiscount = isPaid && discountPrice > 0 && discountPrice < price;
  return { isPaid, price, discountPrice, hasDiscount, payable: hasDiscount ? discountPrice : price };
}

// Returns ready-to-insert HTML for the Free/Paid status pill.
// Pass owned=true (course is paid AND the user already has access to it) to
// show an "Enrolled" pill instead of the price — once bought, the amount
// paid shouldn't keep showing on the course card.
export function priceBadgeHtml(course, extraClass = "", owned = false) {
  const { isPaid, payable } = getCoursePricing(course);
  if (isPaid && owned) {
    return `<span class="status-pill status-pill-free ${extraClass}"><i class="fa-solid fa-circle-check"></i> Enrolled</span>`;
  }
  return isPaid
    ? `<span class="status-pill status-pill-paid ${extraClass}"><i class="fa-solid fa-lock"></i> ৳${payable}</span>`
    : `<span class="status-pill status-pill-free ${extraClass}"><i class="fa-solid fa-circle-check"></i> Free</span>`;
}

/* ---------- Mandatory phone number gate ----------
   Every logged-in, non-admin account must have a saved phone number before
   it can do anything else on the site — that same number is what later
   gets locked into the course purchase form (see course.js), so it has to
   exist and be correct from the very first login. This overlay is mounted
   directly on <body> (outside any page's own markup) so it survives page
   navigation and SPA route changes untouched, has no close button, and
   nothing behind it is reachable — it can only be dismissed by successfully
   saving a valid number. initNav()'s onAuthStateChanged handler below is
   the single call site, so this fires at most once per real login. */
function showPhoneRequiredGate(uid) {
  if (document.getElementById("phone-gate-overlay")) return;

  const overlay = document.createElement("div");
  overlay.id = "phone-gate-overlay";
  overlay.className = "phone-gate-overlay";
  overlay.innerHTML = `
    <div class="phone-gate-box">
      <div class="phone-gate-icon"><i class="fa-solid fa-mobile-screen-button"></i></div>
      <h3>Phone Number Required</h3>
      <p class="phone-gate-warning">
        <i class="fa-solid fa-triangle-exclamation"></i>
        <span>This number will be used later when purchasing a course, and cannot be changed once submitted — so please enter a correct, active number.Then stay with us. Thank you.</span>
      </p>
      <form id="phone-gate-form">
        <div class="field">
          <label>Your Phone Number</label>
          <input type="tel" id="phone-gate-input" required placeholder="01XXXXXXXXX" autocomplete="tel" inputmode="numeric">
        </div>
        <button type="submit" class="btn btn-primary btn-block" id="phone-gate-submit-btn">Save &amp; Continue</button>
      </form>
    </div>
  `;
  document.body.appendChild(overlay);
  document.body.style.overflow = "hidden";

  const input = overlay.querySelector("#phone-gate-input");
  setTimeout(() => input?.focus(), 50);

  overlay.querySelector("#phone-gate-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    const btn = overlay.querySelector("#phone-gate-submit-btn");
    const val = input.value.trim();
    if (!/^01\d{9}$/.test(val)) {
      toast("Please enter a valid Bangladeshi mobile number (01XXXXXXXXX)", "error");
      return;
    }
    btn.disabled = true;
    btn.innerHTML = `<span class="spinner"></span>`;
    try {
      await updateDoc(doc(db, "users", uid), { phone: val, phoneLockedAt: serverTimestamp() });
      overlay.remove();
      document.body.style.overflow = "";
      toast("Phone number saved", "success");
    } catch (err) {
      toast("Could not save, please try again", "error");
      btn.disabled = false;
      btn.textContent = "Save & Continue";
    }
  });
}

/* ---------- Reactively wait for auth state ---------- */
export function waitForAuth() {
  return new Promise((resolve) => {
    const unsub = onAuthStateChanged(auth, (user) => {
      unsub();
      resolve(user);
    });
  });
}

/* ---------- Page guard: block access without login ---------- */
export async function requireAuth() {
  const user = await waitForAuth();
  if (!user) {
    // Login is a hash route inside index.html now (js/page-login.js +
    // js/auth.js), not a standalone login.html — from index.html itself
    // (course/profile pages) a bare hash change is enough; from a separate
    // page shell (admin.html) we still need a real navigation
    // to index.html first, same reasoning as initNav's homeHref below.
    const onIndexPage = /(^|\/)(index\.html)?$/.test(window.location.pathname);
    window.location.href = onIndexPage ? "#/login" : "index.html#/login";
    return null;
  }
  return user;
}

/* ---------- Admin guard ---------- */
export async function requireAdmin() {
  const user = await requireAuth();
  if (!user) return null;
  const profile = await getUserProfile(user.uid);
  if (!profile || !profile.isAdmin) {
    toast("You don't have permission to access this page", "error");
    window.location.href = "index.html#/home";
    return null;
  }
  return { user, profile };
}

/* ---------- Render navbar + bind auth state ----------
   initNav() runs on every page's own boot (once) AND, inside the index.html
   SPA, once more for every course visited (course.js calls initNav("home")
   each time). The one-time listeners below (hamburger, backdrop, resize,
   document click/keydown, the Firebase auth subscription) must only ever be
   bound ONCE per page load — binding them again on every course visit used
   to stack duplicate handlers, so a single hamburger tap fired the open/close
   toggle twice in the same click and visibly did nothing. navBound guards
   that one-time setup; everything else (the nav links/active-state markup)
   still safely re-renders on every call. */
let navBound = false;
let navIsAdmin = false;
let navUserInfo = null;
let navIsLoggedIn = false;

export function initNav(activePage = "") {
  // Home must resolve to index.html's hash route from EVERY page. A bare "#/home"
  // only works while already on index.html (its router listens for hashchange there);
  // on admin.html / 404.html a bare hash just rewrites that page's
  // own URL and nothing happens, since neither of those pages have a router. On
  // index.html itself (served either as ".../index.html" or bare ".../")
  // keep the bare hash so the click stays an instant same-document nav instead of a reload.
  const onIndexPage = /(^|\/)(index\.html)?$/.test(window.location.pathname);
  const homeHref = onIndexPage ? "#/home" : "index.html#/home";
  // Profile is also a router-driven SPA page living inside index.html (see
  // js/page-profile.js + js/app.js) — same bare-hash-only-works-on-index
  // rule as Home above.
  const profileHref = onIndexPage ? "#/profile" : "index.html#/profile";
  // Login and Signup are likewise hash routes inside index.html now (see
  // js/page-login.js / js/page-signup.js + js/auth.js) — there is no more
  // login.html or signup.html file to link to.
  const loginHref = onIndexPage ? "#/login" : "index.html#/login";
  const signupHref = onIndexPage ? "#/signup" : "index.html#/signup";
  // "My Courses" reuses the profile page's own courses tab (it's the default
  // tab there already) — jumping straight to it via ?tab=courses so users
  // can find their enrolled courses and open them without digging through
  // the full profile page first.
  const myCoursesHref = onIndexPage ? "#/profile?tab=courses" : "index.html#/profile?tab=courses";
  // Exam is likewise a hash route inside index.html now (see js/exam.js +
  // the #page-exam shell) — there is no more exam.html file to link to.
  const examHref = onIndexPage ? "#/exam" : "index.html#/exam";
  const baseLinks = [
    { href: homeHref, label: '<i class="fa-solid fa-house"></i> Home', key: "home" },
    { href: myCoursesHref, label: '<i class="fa-solid fa-book-open"></i> My Courses', key: "mycourses" },
    { href: examHref, label: '<i class="fa-solid fa-file-pen"></i> Exam', key: "exam" },
    { href: profileHref, label: '<i class="fa-solid fa-user"></i> Profile', key: "profile" },
  ];
  const navLinksDesktop = document.getElementById("nav-links");
  const navUser = document.getElementById("nav-user");

  // Mobile menu panel (side drawer) + backdrop — intentionally mounted directly as a
  // child of <body> (see the comment in css/base.css) so .topnav's backdrop-filter can't break it.
  let mobileBackdrop = document.getElementById("mobile-nav-backdrop");
  if (!mobileBackdrop) {
    mobileBackdrop = document.createElement("div");
    mobileBackdrop.id = "mobile-nav-backdrop";
    mobileBackdrop.className = "mobile-nav-backdrop";
    document.body.appendChild(mobileBackdrop);
  }
  let mobilePanel = document.getElementById("mobile-nav-panel");
  if (!mobilePanel) {
    mobilePanel = document.createElement("div");
    mobilePanel.id = "mobile-nav-panel";
    mobilePanel.className = "mobile-nav-panel";
    document.body.appendChild(mobilePanel);
  }

  let isLoggedIn = navIsLoggedIn;

  function linksFor(isAdmin) {
    // On the admin console itself, the normal site nav (Home/Exam/Profile) is just
    // clutter — swap it for a single clear "Back to Website" action plus a static
    // "Admin Panel" badge instead of a self-referential Admin link.
    if (activePage === "admin") {
      const links = [{ href: "index.html", label: '<i class="fa-solid fa-arrow-left"></i> Back to Website', key: "back" }];
      if (isAdmin) links.push({ href: "admin.html", label: '<i class="fa-solid fa-gear"></i> Admin Panel', key: "admin" });
      return links;
    }
    return isAdmin ? [...baseLinks, { href: "admin.html", label: '<i class="fa-solid fa-gear"></i> Admin', key: "admin" }] : baseLinks;
  }

  function closeMobilePanel() {
    mobilePanel.classList.remove("open");
    mobileBackdrop.classList.remove("open");
    document.getElementById("hamburger")?.classList.remove("active");
    document.body.style.overflow = "";
  }

  function openMobilePanel() {
    mobilePanel.classList.add("open");
    mobileBackdrop.classList.add("open");
    document.getElementById("hamburger")?.classList.add("active");
    document.body.style.overflow = "hidden";
    closeUserDropdown();
  }

  function closeUserDropdown() {
    const dd = document.getElementById("user-dropdown");
    const toggleBtn = document.getElementById("avatar-toggle-btn");
    if (dd) dd.hidden = true;
    toggleBtn?.classList.remove("active");
  }

  function render(isAdmin, userInfo) {
    const links = linksFor(isAdmin);
    const linkHtml = links
      .map((l) => `<a href="${l.href}" class="${l.key === activePage ? "active" : ""} ${l.key === "admin" ? "nav-link-admin" : ""}">${l.label}</a>`)
      .join("");

    if (navLinksDesktop) {
      navLinksDesktop.innerHTML = linkHtml;
    }

    // If logged in, show a brief profile card (no logout button here — that's in the avatar dropdown)
    const userCardHtml = userInfo
      ? `<div class="mobile-nav-user-card">
          <div class="mobile-nav-user-avatar">${userInfo.avatarHtml}</div>
          <div class="mobile-nav-user-info">
            <div class="mobile-nav-user-name">${escapeHtml(userInfo.name)}</div>
            ${userInfo.email ? `<div class="mobile-nav-user-email">${escapeHtml(userInfo.email)}</div>` : ""}
          </div>
        </div>`
      : "";
    const footHtml = isLoggedIn
      ? ""
      : `<div class="mobile-nav-panel-foot">
          <a href="${loginHref}" class="btn btn-outline">Log In</a>
          <a href="${signupHref}" class="btn btn-primary">Sign Up</a>
        </div>`;

    mobilePanel.innerHTML = `
      <div class="mobile-nav-head">
        <span class="mobile-nav-head-title">Menu</span>
        <button type="button" class="mobile-nav-close" id="mobile-nav-close-btn" aria-label="Close"><i class="fa-solid fa-xmark"></i></button>
      </div>
      ${userCardHtml}
      <div class="mobile-nav-links">${linkHtml}</div>
      ${footHtml}
    `;
    mobilePanel.querySelectorAll("a").forEach((a) => a.addEventListener("click", closeMobilePanel));
    mobilePanel.querySelector("#mobile-nav-close-btn")?.addEventListener("click", closeMobilePanel);
  }
  // Render immediately with whatever auth state we already know (instant —
  // no flicker/wait) so the nav is correct the moment this page/route boots.
  render(navIsAdmin, navUserInfo);

  // Everything below (one-time listeners + the auth subscription) only ever
  // runs on the very first initNav() call in this page's lifetime.
  if (navBound) return;
  navBound = true;

  const hamburger = document.getElementById("hamburger");
  if (hamburger) {
    hamburger.addEventListener("click", () => {
      if (mobilePanel.classList.contains("open")) closeMobilePanel();
      else openMobilePanel();
    });
  }
  mobileBackdrop.addEventListener("click", closeMobilePanel);
  window.addEventListener("resize", () => {
    if (window.innerWidth > 860) {
      closeMobilePanel();
      hamburger?.classList.remove("active");
    }
  });

  document.addEventListener("click", (e) => {
    const menu = document.getElementById("user-menu");
    if (menu && !menu.contains(e.target)) closeUserDropdown();
  });
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") { closeUserDropdown(); closeMobilePanel(); }
  });

  onAuthStateChanged(auth, async (user) => {
    if (user) {
      isLoggedIn = true;
      navIsLoggedIn = true;
      const profile = await getUserProfile(user.uid);
      const isAdmin = !!profile?.isAdmin;
      const name = profile?.displayName || user.email?.split("@")[0] || "User";
      const email = user.email || "";
      const photo = profile?.photoURL || "";
      const avatarHtml = photo ? `<img src="${photo}" alt="${escapeHtml(name)}">` : initials(name);
      navIsAdmin = isAdmin;
      navUserInfo = { name, email, avatarHtml };
      render(isAdmin, navUserInfo);

      // Block the whole site behind the mandatory phone gate until a
      // non-admin account has a saved number (see showPhoneRequiredGate above).
      if (!isAdmin && profile && !profile.phone) {
        showPhoneRequiredGate(user.uid);
      }

      if (navUser) {
        navUser.innerHTML = `
          <div class="user-menu" id="user-menu">
            <button type="button" class="avatar-chip" id="avatar-toggle-btn" title="${escapeHtml(name)}">${avatarHtml}</button>
            <div class="user-dropdown" id="user-dropdown" hidden>
              <div class="user-dropdown-head">
                <div class="user-dropdown-avatar">${avatarHtml}</div>
                <div class="user-dropdown-info">
                  <div class="user-dropdown-name">${escapeHtml(name)}</div>
                  ${email ? `<div class="user-dropdown-email">${escapeHtml(email)}</div>` : ""}
                </div>
              </div>
              <div class="user-dropdown-divider"></div>
              <a href="${profileHref}" class="user-dropdown-item"><i class="fa-solid fa-user"></i> Profile</a>
              ${isAdmin ? `<a href="admin.html" class="user-dropdown-item admin"><i class="fa-solid fa-gear"></i> Admin Panel</a>` : ""}
              <div class="user-dropdown-divider"></div>
              <button type="button" class="user-dropdown-item danger" id="dropdown-logout-btn"><i class="fa-solid fa-right-from-bracket"></i> Logout</button>
            </div>
          </div>
        `;
        const toggleBtn = document.getElementById("avatar-toggle-btn");
        const dropdown = document.getElementById("user-dropdown");
        toggleBtn?.addEventListener("click", (e) => {
          e.stopPropagation();
          const opening = dropdown.hidden;
          dropdown.hidden = !opening;
          toggleBtn.classList.toggle("active", opening);
          closeMobilePanel();
        });
        document.getElementById("dropdown-logout-btn")?.addEventListener("click", async () => {
          closeUserDropdown();
          await signOut(auth);
          toast("Logged out", "success");
          setTimeout(() => (window.location.href = "index.html#/home"), 500);
        });
      }
    } else {
      isLoggedIn = false;
      navIsLoggedIn = false;
      navIsAdmin = false;
      navUserInfo = null;
      render(false);
      if (navUser) {
        navUser.innerHTML = `
          <a href="${loginHref}" class="btn btn-outline btn-sm">Log In</a>
          <a href="${signupHref}" class="btn btn-primary btn-sm">Sign Up</a>
        `;
      }
    }
  });
}

/* ---------- YouTube ID / thumbnail / embed helpers ---------- */
export function youTubeId(url = "") {
  const m = url.match(/(?:youtube\.com\/(?:watch\?v=|embed\/|shorts\/)|youtu\.be\/)([A-Za-z0-9_-]{11})/);
  return m ? m[1] : null;
}
export function isDirectVideo(url = "") {
  return /\.(mp4|webm|ogg)(\?.*)?$/i.test(url);
}
export function videoThumbnail(url = "") {
  const yid = youTubeId(url);
  if (yid) return `https://img.youtube.com/vi/${yid}/hqdefault.jpg`;
  return "";
}
export function videoEmbedUrl(url = "") {
  const yid = youTubeId(url);
  if (yid) return `https://www.youtube.com/embed/${yid}?autoplay=1&rel=0`;
  return "";
}

/* ---------- Build an embed URL from a Google Drive PDF link ---------- */
export function driveFileId(url = "") {
  const m = url.match(/\/d\/([a-zA-Z0-9_-]{10,})/) || url.match(/[?&]id=([a-zA-Z0-9_-]{10,})/);
  return m ? m[1] : null;
}
export function isDriveLink(url = "") {
  return /drive\.google\.com/.test(url);
}
export function drivePreviewUrl(url = "") {
  const id = driveFileId(url);
  return id ? `https://drive.google.com/file/d/${id}/preview` : "";
}
export function driveDownloadUrl(url = "") {
  const id = driveFileId(url);
  return id ? `https://drive.google.com/uc?export=download&id=${id}` : url;
}

/* ---------- Generic confirm dialog (before delete) — custom styled box, not the native browser confirm() ---------- */
export function confirmAction(message, { title = "Confirm", confirmLabel = "Yes, Confirm", cancelLabel = "Cancel", danger = true } = {}) {
  return new Promise((resolve) => {
    closeModal();
    const overlay = document.createElement("div");
    overlay.className = "modal-overlay confirm-overlay";
    overlay.innerHTML = `
      <div class="modal-box card confirm-box">
        <div class="confirm-icon ${danger ? "danger" : ""}"><i class="fa-solid ${danger ? "fa-triangle-exclamation" : "fa-circle-question"}"></i></div>
        <h3 class="confirm-title">${escapeHtml(title)}</h3>
        <p class="confirm-msg">${escapeHtml(message)}</p>
        <div class="confirm-actions">
          <button type="button" class="btn btn-outline btn-block" data-confirm-cancel>${escapeHtml(cancelLabel)}</button>
          <button type="button" class="btn ${danger ? "btn-danger" : "btn-primary"} btn-block" data-confirm-ok>${escapeHtml(confirmLabel)}</button>
        </div>
      </div>`;
    document.body.appendChild(overlay);
    document.body.style.overflow = "hidden";

    let settled = false;
    function onKey(e) {
      if (e.key === "Escape") finish(false);
      if (e.key === "Enter") finish(true);
    }
    function finish(result) {
      if (settled) return;
      settled = true;
      document.removeEventListener("keydown", onKey);
      overlay.classList.add("closing");
      setTimeout(() => {
        overlay.remove();
        if (!document.querySelector(".modal-overlay")) document.body.style.overflow = "";
      }, 150);
      resolve(result);
    }
    overlay.querySelector("[data-confirm-ok]").addEventListener("click", () => finish(true));
    overlay.querySelector("[data-confirm-cancel]").addEventListener("click", () => finish(false));
    overlay.addEventListener("click", (e) => {
      if (e.target === overlay) finish(false);
    });
    document.addEventListener("keydown", onKey);
  });
}

/* ---------- Generic modal helper ---------- */
export function openModal(innerHtml, { onClose } = {}) {
  closeModal();
  const overlay = document.createElement("div");
  overlay.className = "modal-overlay";
  overlay.id = "active-modal-overlay";
  overlay.innerHTML = `<div class="modal-box card">${innerHtml}</div>`;
  document.body.appendChild(overlay);
  document.body.style.overflow = "hidden";
  overlay.addEventListener("click", (e) => {
    if (e.target === overlay) closeModal();
  });
  overlay.querySelectorAll("[data-modal-close]").forEach((el) => el.addEventListener("click", () => closeModal()));
  if (onClose) overlay.dataset.hasCloseCb = "1";
  overlay._onClose = onClose;
  return overlay;
}
export function closeModal() {
  const existing = document.getElementById("active-modal-overlay");
  if (existing) {
    existing._onClose?.();
    existing.remove();
    document.body.style.overflow = "";
  }
}

function initials(name) {
  return `<span>${(name || "?").trim().charAt(0).toUpperCase()}</span>`;
}

export function escapeHtml(str = "") {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/* ---------- Convert a number to zero-padded digit string (kept for compatibility) ---------- */
export function toBnDigits(num) {
  return String(num);
}

/* ---------- Format seconds as minutes:seconds ---------- */
export function formatTime(totalSeconds) {
  const m = Math.floor(totalSeconds / 60);
  const s = totalSeconds % 60;
  return `${m}:${String(s).padStart(2, "0")}`;
}

/* ---------- Format seconds as "Xm Ys" (used for exam leaderboard time-taken column) ---------- */
export function formatDuration(totalSeconds) {
  const s = Math.max(0, Math.round(totalSeconds || 0));
  const m = Math.floor(s / 60);
  const r = s % 60;
  if (m <= 0) return `${r}s`;
  return `${m}m ${r}s`;
}

/* ---------- Format a (possibly negative-marked, possibly fractional) exam score ----------
   Trims to at most 2 decimals and drops trailing zeros — 7 stays "7", 7.5 stays "7.5",
   7.25 stays "7.25", -1.5 stays "-1.5". Used anywhere a net exam score is displayed. ---------- */
export function formatScore(n) {
  const num = Number(n || 0);
  const rounded = Math.round(num * 100) / 100;
  return String(rounded);
}

/* ---------- Format date in English ---------- */
export function formatDate(ts) {
  if (!ts) return "";
  const date = ts.toDate ? ts.toDate() : new Date(ts);
  const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  return `${date.getDate()} ${months[date.getMonth()]}, ${date.getFullYear()}`;
}

/* ---------- Format date + time in English (used in exam scheduling) ---------- */
export function formatDateTime(ts) {
  if (!ts) return "";
  const date = ts.toDate ? ts.toDate() : new Date(ts);
  const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  const h = date.getHours();
  const period = h < 12 ? "AM" : "PM";
  let h12 = h % 12;
  if (h12 === 0) h12 = 12;
  const m = String(date.getMinutes()).padStart(2, "0");
  return `${date.getDate()} ${months[date.getMonth()]}, ${date.getFullYear()} — ${h12}:${m} ${period}`;
}

/* ---------- Determine an exam's current state from its publish schedule ----------
   exam.publishAt (Timestamp) — when it becomes visible/available
   exam.closesAt  (Timestamp | null) — when it closes (null means no limit) */
export function getExamAvailability(exam) {
  const now = new Date();
  const publishAt = exam.publishAt?.toDate ? exam.publishAt.toDate() : exam.publishAt ? new Date(exam.publishAt) : null;
  const closesAt = exam.closesAt?.toDate ? exam.closesAt.toDate() : exam.closesAt ? new Date(exam.closesAt) : null;
  let state = "open";
  if (publishAt && now < publishAt) state = "upcoming";
  else if (closesAt && now > closesAt) state = "closed";
  return { state, publishAt, closesAt };
}
