// ==========================================================================
// utils.js — Shared helper functions
// ==========================================================================
import { auth, db } from "./firebase-config.js";
import { onAuthStateChanged, signOut } from "https://www.gstatic.com/firebasejs/10.13.0/firebase-auth.js";
import { doc, getDoc, updateDoc, serverTimestamp } from "https://www.gstatic.com/firebasejs/10.13.0/firebase-firestore.js";

/* ---------- Support email addresses + mailto template ----------
   Central place for the site's two support inboxes, plus a helper that
   builds a mailto: link with an English subject and greeting already
   filled in — the user only has to type their details after "Details:".
   Update the two addresses here and every Contact/Support link on the
   site picks it up. ---------- */
export const SUPPORT_EMAIL_GMAIL = "tv.support.info@gmail.com";
export const SUPPORT_EMAIL_YAHOO = "info.techverse@yahoo.com";

export function supportMailto(address) {
  const subject = "Support Request - Tech Verse Course";
  const body = "Hello Tech Verse Course Support Team,\n\nDetails:\n\n\nThank you,";
  return `mailto:${address}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
}

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

/* ---------- Suspended-account gate ----------
   Mirrors showPhoneRequiredGate() below: a full-screen, non-dismissable
   overlay mounted directly on <body>. Shown when a suspended user's session
   is caught by initNav's onAuthStateChanged handler. The account is signed
   out before this is shown, so there is nothing to "continue" to — the only
   way out is closing the tab or contacting support. ---------- */
function showSuspendedGate() {
  if (document.getElementById("suspended-gate-overlay")) return;
  const overlay = document.createElement("div");
  overlay.id = "suspended-gate-overlay";
  overlay.className = "phone-gate-overlay";
  overlay.innerHTML = `
    <div class="phone-gate-box">
      <div class="phone-gate-icon" style="background:rgba(225,95,82,0.16); color:#F0938A;"><i class="fa-solid fa-ban"></i></div>
      <h3>Account Banned</h3>
      <p class="phone-gate-warning">
        <i class="fa-solid fa-triangle-exclamation"></i>
        <span>Your account has been banned by an admin and can no longer access Tech Verse Course. If you think this is a mistake, please contact support.</span>
      </p>
      <a href="${supportMailto(SUPPORT_EMAIL_GMAIL)}" class="btn btn-primary btn-block">Contact Support</a>
    </div>
  `;
  document.body.appendChild(overlay);
  document.body.style.overflow = "hidden";
}

/* ---------- Presence heartbeat ----------
   Writes users/{uid}.lastActive so the admin panel can show who's online
   right now. Fires immediately on login, then on an interval, then again
   whenever the tab becomes visible after being backgrounded (so a user who
   left a tab open all night doesn't stay "online" from a single stale write,
   and one who comes back to an old tab shows online again right away). Only
   ever started once per page load, same one-time-setup pattern as navBound. */
let presenceStarted = false;
function startPresenceHeartbeat(uid) {
  if (presenceStarted) return;
  presenceStarted = true;
  const beat = () => updateDoc(doc(db, "users", uid), { lastActive: serverTimestamp() }).catch(() => {});
  beat();
  setInterval(beat, 45000);
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") beat();
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
  // "My Courses" is its own dedicated SPA route (see js/page-mycourses.js +
  // js/app.js) — a smart, filterable view of only the courses this user is
  // enrolled in, separate from the full profile page.
  const myCoursesHref = onIndexPage ? "#/mycourses" : "index.html#/mycourses";
  // Exam is likewise a hash route inside index.html now (see the exam/ section +
  // the #page-exam shell) — there is no more exam.html file to link to.
  const examHref = onIndexPage ? "#/exam" : "index.html#/exam";
  // Learning Hub is likewise a hash route inside index.html (see js/hub.js +
  // the #page-hub shell) — badges, discussion and flashcards live there.
  const hubHref = onIndexPage ? "#/hub" : "index.html#/hub";
  const baseLinks = [
    { href: homeHref, label: '<i class="fa-solid fa-house"></i> Home', key: "home" },
    { href: myCoursesHref, label: '<i class="fa-solid fa-book-open"></i> My Courses', key: "mycourses" },
    { href: examHref, label: '<i class="fa-solid fa-file-pen"></i> Exam', key: "exam" },
    { href: hubHref, label: `<i class="fa-solid fa-layer-group"></i> Hub ${newPillHtml("hub_nav")}`, key: "hub" },
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
      const profile = await getUserProfile(user.uid);

      // Suspended accounts are signed out immediately and blocked behind a
      // full-screen notice — nothing below this runs for them (no nav, no
      // presence heartbeat, no site access).
      if (profile?.suspended) {
        await signOut(auth);
        showSuspendedGate();
        return;
      }

      isLoggedIn = true;
      navIsLoggedIn = true;
      startPresenceHeartbeat(user.uid);
      // Dynamic import (not a static one) so utils.js and notifications.js don't form
      // a circular import — notifications.js itself statically imports escapeHtml from here.
      import("./notifications.js").then(({ mountNotificationBell }) => mountNotificationBell(user.uid, profile)).catch(() => {});
      // Same dynamic-import reasoning as notifications.js above — keeps the
      // daily login-streak counter (used by the Learning Hub's Achievements
      // tab) ticking forward from every page the person visits, not just
      // the Hub itself, without utils.js <-> badges.js forming a cycle.
      import("./badges.js").then(({ updateDailyStreak }) => updateDailyStreak(user.uid)).catch(() => {});
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
      import("./notifications.js").then(({ unmountNotificationBell }) => unmountNotificationBell()).catch(() => {});
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

/* ---------- Relative "time ago" string (e.g. "3h ago", "2d ago") ----------
   Used by the Learning Hub's Discussion tab for thread/reply timestamps —
   falls back to formatDate() once something is more than a week old, since
   "23d ago" is less useful to read than an actual date at that point. ---------- */
export function timeAgo(ts) {
  if (!ts) return "";
  const date = ts.toDate ? ts.toDate() : new Date(ts);
  const diffSec = Math.max(0, Math.floor((Date.now() - date.getTime()) / 1000));
  if (diffSec < 60) return "just now";
  const diffMin = Math.floor(diffSec / 60);
  if (diffMin < 60) return `${diffMin}m ago`;
  const diffHr = Math.floor(diffMin / 60);
  if (diffHr < 24) return `${diffHr}h ago`;
  const diffDay = Math.floor(diffHr / 24);
  if (diffDay < 7) return `${diffDay}d ago`;
  return formatDate(ts);
}

/* ---------- "NEW" feature-discovery pills ----------
   A small, reusable, site-wide system for marking freshly-shipped features
   with a "NEW" pill until the person actually opens/uses them — so future
   additions (not just today's Hub) can plug into the same mechanism instead
   of each one inventing its own "is this new" flag. Purely local (per
   browser) via localStorage; nothing server-side to manage. Once a key is
   marked seen it stays seen forever on that device. ---------- */
const FEATURE_SEEN_PREFIX = "tv_seen_";

export function isFeatureSeen(key) {
  try {
    return localStorage.getItem(FEATURE_SEEN_PREFIX + key) === "1";
  } catch {
    return true; // if storage is unavailable, don't nag with a pill we can't ever clear
  }
}

export function markFeatureSeen(key) {
  try {
    localStorage.setItem(FEATURE_SEEN_PREFIX + key, "1");
  } catch { /* ignore — storage unavailable */ }
}

/** Returns a <span class="new-pill">NEW</span> if this feature key hasn't been
 *  marked seen yet on this device, otherwise an empty string. */
export function newPillHtml(key) {
  return isFeatureSeen(key) ? "" : `<span class="new-pill">New</span>`;
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

/* ---------- How many questions a student actually sees for this exam ----------
   exam.questionCount is always the FULL pool size (every question the admin
   added). If exam.questionsPerAttempt is set (and smaller than the pool), a
   random subset is drawn on every attempt — see exam/exam.js beginAttempt()
   — so that's the number that's actually meaningful to show a student before
   they start (and what the timer/negative-marking math is based on). Every
   card that displays a question count (exam list, lesson exam banner, admin
   table) should go through this helper instead of reading ex.questionCount
   directly, so they all stay consistent if the pool logic ever changes. ---------- */
export function getExamQuestionCount(exam = {}) {
  const perAttempt = Number(exam.questionsPerAttempt) || 0;
  const pool = Number(exam.questionCount) || 0;
  return perAttempt > 0 && perAttempt < pool ? perAttempt : pool;
}
export function isExamRandomPool(exam = {}) {
  const perAttempt = Number(exam.questionsPerAttempt) || 0;
  return perAttempt > 0 && perAttempt < (Number(exam.questionCount) || 0);
}

/* -------- Shared Bengali-Unicode font loader for jsPDF --------
   jsPDF's built-in fonts (Helvetica etc.) only cover Latin characters.
   Bengali text drawn with them comes out as garbled boxes/symbols instead
   of real Bengali letters. This loads Noto Sans Bengali (Regular + Bold)
   once, caches the base64 in memory for the rest of the session, and
   registers it with whichever jsPDF document instance needs it — used by
   every PDF export on the site (exam result, profile/certificate, admin
   reports) so all downloaded PDFs show clear, correctly-shaped Bengali
   text instead of the old symbol/garbled output. ---------- */
const BENGALI_FONT_REGULAR_URL = "https://notofonts.github.io/bengali/fonts/NotoSansBengali/hinted/ttf/NotoSansBengali-Regular.ttf";
const BENGALI_FONT_BOLD_URL = "https://notofonts.github.io/bengali/fonts/NotoSansBengali/hinted/ttf/NotoSansBengali-Bold.ttf";
let _bengaliFontFilesPromise = null;

function _arrayBufferToBase64(buf) {
  let binary = "";
  const bytes = new Uint8Array(buf);
  const chunkSize = 0x8000;
  for (let i = 0; i < bytes.length; i += chunkSize) {
    binary += String.fromCharCode.apply(null, bytes.subarray(i, i + chunkSize));
  }
  return btoa(binary);
}

async function _fetchFontBase64(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Font fetch failed (${res.status}): ${url}`);
  return _arrayBufferToBase64(await res.arrayBuffer());
}

function _loadBengaliFontFiles() {
  if (!_bengaliFontFilesPromise) {
    _bengaliFontFilesPromise = (async () => {
      const regular = await _fetchFontBase64(BENGALI_FONT_REGULAR_URL);
      // Bold is a nice-to-have — if it fails to fetch, reuse Regular so
      // setFont(..., "bold") still renders correct Bengali glyphs (just
      // not visually bolder) instead of throwing or falling back to Helvetica.
      const bold = await _fetchFontBase64(BENGALI_FONT_BOLD_URL).catch(() => regular);
      return { regular, bold };
    })().catch((err) => {
      _bengaliFontFilesPromise = null; // allow retry on next PDF export
      throw err;
    });
  }
  return _bengaliFontFilesPromise;
}

/**
 * Registers Noto Sans Bengali with a jsPDF document instance so Bengali
 * text renders correctly instead of as garbled symbols. Call once right
 * after `new jsPDF(...)`, before drawing any text, then use
 * doc.setFont("NotoSansBengali", "normal" | "bold").
 * Returns true if the font is ready, false if it couldn't be loaded (e.g.
 * offline) — callers should fall back to the default font rather than throw.
 */
export async function useBengaliFont(pdfDoc) {
  try {
    const { regular, bold } = await _loadBengaliFontFiles();
    pdfDoc.addFileToVFS("NotoSansBengali-Regular.ttf", regular);
    pdfDoc.addFont("NotoSansBengali-Regular.ttf", "NotoSansBengali", "normal");
    pdfDoc.addFileToVFS("NotoSansBengali-Bold.ttf", bold);
    pdfDoc.addFont("NotoSansBengali-Bold.ttf", "NotoSansBengali", "bold");
    pdfDoc.setFont("NotoSansBengali", "normal");
    return true;
  } catch (err) {
    console.error("Bengali PDF font failed to load, falling back to default font:", err);
    return false;
  }
}

/* ---------- Canvas-rasterized Bengali text for PDFs ----------
   jsPDF embeds TTFs glyph-by-glyph with no OpenType shaping (no GSUB/GPOS),
   so Bengali conjuncts and matras — which depend on shaping — render broken
   or out of order even with useBengaliFont() above registered correctly.
   The browser's own Canvas 2D text renderer *does* do full shaping, so for
   Bengali lines we draw the text to an offscreen canvas (using this same
   font, loaded as a real FontFace) and embed the result as a PNG image
   instead of native PDF text. Pure-English lines keep using native jsPDF
   text (crisp, selectable, tiny file size) — see exam-pdf.js's hasBengali()
   split. Returns the CSS font-family name to use once loaded; cached so the
   font file is only registered with the document once. */
let _bengaliCanvasFontPromise = null;
export function loadBengaliCanvasFont() {
  if (!_bengaliCanvasFontPromise) {
    _bengaliCanvasFontPromise = (async () => {
      const { regular, bold } = await _loadBengaliFontFiles();
      const toBuffer = (b64) => {
        const bin = atob(b64);
        const bytes = new Uint8Array(bin.length);
        for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
        return bytes.buffer;
      };
      const family = "NotoSansBengaliCanvas";
      const regularFace = new FontFace(family, toBuffer(regular), { weight: "400" });
      const boldFace = new FontFace(family, toBuffer(bold), { weight: "700" });
      await Promise.all([regularFace.load(), boldFace.load()]);
      document.fonts.add(regularFace);
      document.fonts.add(boldFace);
      return family;
    })().catch((err) => {
      _bengaliCanvasFontPromise = null;
      throw err;
    });
  }
  return _bengaliCanvasFontPromise;
}

/* ---------- Shared Bengali-detection + canvas-rasterization helpers ----------
   Used by every PDF export that mixes Bengali with native jsPDF text (exam
   result PDF, admin leaderboard PDF, and any future export): jsPDF draws TTF
   glyphs one-by-one with no OpenType shaping, so Bengali conjuncts/matras
   come out broken even with a Bengali font registered via useBengaliFont()
   above. The fix is to detect Bengali text and rasterize just that text on
   an offscreen canvas (real browser shaping) as a small PNG, while pure
   English/number text keeps using fast, crisp, selectable native jsPDF
   text. Centralized here so every export gets the same correct behavior
   instead of each file re-solving (or forgetting to solve) it. ---------- */
const BENGALI_RE = /[\u0980-\u09FF]/;
export const hasBengaliText = (text) => BENGALI_RE.test(text || "");

// Rasterize at higher resolution than the final point-size for crisp print output.
const RASTER_SCALE = 3;

/**
 * Renders a single line of text onto an offscreen canvas (using the loaded
 * Bengali canvas font, or the given fallback) and returns a PNG data URL
 * plus its size in PDF points, ready to hand to doc.addImage(). Handles
 * Bengali (needs real shaping) and non-Bengali (still fine to rasterize,
 * e.g. mixed lines) text alike.
 */
export function rasterizeTextLine(text, { fontPt, bold = false, colorRgb = [0, 0, 0], canvasFont }) {
  const px = fontPt * RASTER_SCALE;
  const measureCanvas = document.createElement("canvas");
  const mctx = measureCanvas.getContext("2d");
  mctx.font = `${bold ? "700" : "400"} ${px}px "${canvasFont}", sans-serif`;
  const width = Math.max(4, Math.ceil(mctx.measureText(text).width) + 6);
  const height = Math.ceil(px * 1.5);

  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  ctx.font = `${bold ? "700" : "400"} ${px}px "${canvasFont}", sans-serif`;
  ctx.fillStyle = `rgb(${colorRgb.join(",")})`;
  ctx.textBaseline = "alphabetic";
  ctx.fillText(text, 2, px * 1.02);

  return {
    dataUrl: canvas.toDataURL("image/png"),
    widthPt: width / RASTER_SCALE,
    heightPt: height / RASTER_SCALE,
  };
}

/* ---------- Course completion certificate (shared) ----------
   Called from both js/course.js (banner shown on the course page once every
   lesson is marked complete) and js/page-mycourses.js (the "My Courses"
   page, once a course reaches 100%) — kept here, not duplicated in either
   file, so both entry points always produce an identical certificate. Uses the same
   NAVY/AMBER/BG palette as profile.js's enrollment-invoice PDF for a
   consistent brand look across every downloadable document on the site. ---------- */
let _certLogoCache = null;
function _loadCertLogo() {
  if (_certLogoCache !== null) return Promise.resolve(_certLogoCache);
  return new Promise((resolve) => {
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = () => { _certLogoCache = img; resolve(img); };
    img.onerror = () => { _certLogoCache = false; resolve(false); };
    img.src = "assets/logo.png";
  });
}

/**
 * Generates and downloads a "Certificate of Completion" PDF.
 * @param {{studentName:string, courseTitle:string, completionDate?:Date, certificateId?:string}} opts
 * Returns true on success, false if the PDF engine/font couldn't be prepared
 * (caller should toast; this function only toasts the "no jsPDF" case since
 * that's the one true failure — a missing Bengali font still falls back and succeeds).
 */
export async function generateCertificatePdf({ studentName, courseTitle, completionDate = new Date(), certificateId = "" } = {}) {
  const { jsPDF } = window.jspdf || {};
  if (!jsPDF) {
    toast("Couldn't load the PDF engine. Check your connection and try again.", "error");
    return false;
  }

  const logoImg = await _loadCertLogo();
  const pdfDoc = new jsPDF({ unit: "pt", format: "a4", orientation: "landscape" });
  const bnLoaded = await useBengaliFont(pdfDoc);
  const bnFont = bnLoaded ? "NotoSansBengali" : undefined;

  const W = pdfDoc.internal.pageSize.getWidth();
  const H = pdfDoc.internal.pageSize.getHeight();

  const hex = (h) => {
    h = h.replace("#", "");
    return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];
  };
  const setFill = (c) => { const [r, g, b] = hex(c); pdfDoc.setFillColor(r, g, b); };
  const setDraw = (c) => { const [r, g, b] = hex(c); pdfDoc.setDrawColor(r, g, b); };
  const setTxt = (c) => { const [r, g, b] = hex(c); pdfDoc.setTextColor(r, g, b); };

  const NAVY = "#14182B";
  const AMBER = "#E8A33D";
  const BG = "#FAF7F1";
  const MUTED = "#6b7280";

  // Background
  setFill(BG);
  pdfDoc.rect(0, 0, W, H, "F");

  // Outer navy border + inner amber accent border
  setDraw(NAVY);
  pdfDoc.setLineWidth(2.2);
  pdfDoc.rect(24, 24, W - 48, H - 48);
  setDraw(AMBER);
  pdfDoc.setLineWidth(0.8);
  pdfDoc.rect(34, 34, W - 68, H - 68);

  // Faint centered watermark logo
  if (logoImg) {
    pdfDoc.saveGraphicsState();
    pdfDoc.setGState(new pdfDoc.GState({ opacity: 0.06 }));
    const wm = 260;
    pdfDoc.addImage(logoImg, "PNG", (W - wm) / 2, (H - wm) / 2, wm, wm);
    pdfDoc.restoreGraphicsState();
  }

  let y = 90;
  if (logoImg) pdfDoc.addImage(logoImg, "PNG", W / 2 - 20, y - 34, 40, 40);
  pdfDoc.setFont(bnFont, "bold");
  pdfDoc.setFontSize(15);
  setTxt(NAVY);
  pdfDoc.text("Tech Verse Course", W / 2, y + 20, { align: "center" });

  y += 46;
  pdfDoc.setFont(bnFont, "bold");
  pdfDoc.setFontSize(28);
  setTxt(AMBER);
  pdfDoc.text("CERTIFICATE OF COMPLETION", W / 2, y, { align: "center" });

  y += 34;
  pdfDoc.setFont(bnFont, "normal");
  pdfDoc.setFontSize(12);
  setTxt(MUTED);
  pdfDoc.text("This is to certify that", W / 2, y, { align: "center" });

  y += 42;
  pdfDoc.setFont(bnFont, "bold");
  pdfDoc.setFontSize(26);
  setTxt(NAVY);
  pdfDoc.text(studentName || "Student", W / 2, y, { align: "center" });
  const nameWidth = pdfDoc.getTextWidth(studentName || "Student");
  setDraw(AMBER);
  pdfDoc.setLineWidth(1.4);
  pdfDoc.line(W / 2 - nameWidth / 2 - 10, y + 8, W / 2 + nameWidth / 2 + 10, y + 8);

  y += 38;
  pdfDoc.setFont(bnFont, "normal");
  pdfDoc.setFontSize(12);
  setTxt(MUTED);
  pdfDoc.text("has successfully completed the course", W / 2, y, { align: "center" });

  y += 34;
  pdfDoc.setFont(bnFont, "bold");
  pdfDoc.setFontSize(19);
  setTxt(NAVY);
  const courseLines = pdfDoc.splitTextToSize(courseTitle || "Course", W - 220);
  pdfDoc.text(courseLines, W / 2, y, { align: "center" });
  y += courseLines.length * 22;

  // Footer row: date on the left, certificate ID on the right
  const footerY = H - 66;
  setDraw("#e8e2d6");
  pdfDoc.setLineWidth(0.6);
  pdfDoc.line(70, footerY - 18, W - 70, footerY - 18);

  pdfDoc.setFont(bnFont, "normal");
  pdfDoc.setFontSize(10);
  setTxt(MUTED);
  const dateStr = completionDate.toLocaleDateString("en-GB", { day: "2-digit", month: "long", year: "numeric" });
  pdfDoc.text(`Date of Completion: ${dateStr}`, 70, footerY);
  if (certificateId) {
    pdfDoc.text(`Certificate ID: ${certificateId}`, W - 70, footerY, { align: "right" });
  }

  const safeName = (studentName || "student").replace(/[^a-z0-9\u0980-\u09FF]+/gi, "_").slice(0, 40);
  const safeCourse = (courseTitle || "course").replace(/[^a-z0-9\u0980-\u09FF]+/gi, "_").slice(0, 50);
  pdfDoc.save(`${safeCourse}_certificate_${safeName}.pdf`);
  return true;
}
