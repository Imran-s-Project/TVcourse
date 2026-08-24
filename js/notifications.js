// ==========================================================================
// notifications.js — Site-wide notification bell (in-app, 100% free — no
// push service, no server, just Firestore + this client-side listener).
//
// Data model (see README.md for the matching security rules):
//   notifications/{id}
//     title, message            — what's shown
//     type                      — "course_update" | "new_course" | "exam" | "announcement" | "general" (icon only)
//     courseIds: string[]       — tagged course(s); tapping the notification opens courseIds[0]
//     courseTitles: string[]    — denormalized titles, parallel to courseIds, so the chip
//                                  can render without an extra fetch
//     audience: "all" | "enrolled" — "enrolled" only shows to users whose users/{uid}.enrolledCourses
//                                     overlaps courseIds (covers both free-enrolled and paid/unlocked)
//     active: boolean           — soft on/off switch (admin can hide without deleting)
//     createdAt, createdBy
//
//   users/{uid}.notifReadIds: { [notifId]: true }  — per-user read state, merged in
//     with a dot-path update (allowed by the existing users/{uid} update rule, since
//     it never touches the isAdmin field).
//
// Mounted from js/utils.js's initNav() (dynamic import, see the comment there) so it
// stays in sync with the exact same auth state every page already tracks — no separate
// auth listener needed here.
// ==========================================================================
import { db } from "./firebase-config.js";
import {
  collection, query, where, orderBy, limit, onSnapshot, doc, updateDoc,
} from "https://www.gstatic.com/firebasejs/10.13.0/firebase-firestore.js";
import { escapeHtml } from "./utils.js";
import { courseUrl } from "./router.js";

const TYPE_ICON = {
  course_update: "fa-video",
  new_course: "fa-book-sparkles",
  exam: "fa-file-pen",
  announcement: "fa-bullhorn",
  general: "fa-circle-info",
};

let bound = false;        // click/keydown listeners bound exactly once per page load
let unsub = null;         // current onSnapshot unsubscribe fn
let currentUid = null;
let currentProfile = null; // { enrolledCourses, notifReadIds, ... }
let allNotifs = [];       // latest snapshot, already filtered by audience
let panelOpen = false;

/* ---------- helpers ---------- */

function onIndexPage() {
  return /(^|\/)(index\.html)?$/.test(window.location.pathname);
}

// Build a link that works whether the click happens on index.html (SPA hash
// nav, no reload) or on admin.html / a static page (needs the index.html
// prefix to actually land on the SPA first) — same rule utils.js's initNav
// already uses for Home/Profile/etc.
function targetHref(n) {
  if (!n.courseIds || !n.courseIds.length) return null;
  const hash = courseUrl(n.courseIds[0]);
  return onIndexPage() ? hash : `index.html${hash}`;
}

function timeAgo(ts) {
  if (!ts) return "";
  const d = ts.toDate ? ts.toDate() : new Date(ts);
  const diffSec = Math.floor((Date.now() - d.getTime()) / 1000);
  if (diffSec < 60) return "এইমাত্র";
  if (diffSec < 3600) return `${Math.floor(diffSec / 60)} মিনিট আগে`;
  if (diffSec < 86400) return `${Math.floor(diffSec / 3600)} ঘণ্টা আগে`;
  if (diffSec < 604800) return `${Math.floor(diffSec / 86400)} দিন আগে`;
  return d.toLocaleDateString("en-GB", { day: "numeric", month: "short" });
}

function visibleFor(n, profile) {
  if (n.audience === "enrolled") {
    const tagged = n.courseIds || [];
    const enrolled = profile?.enrolledCourses || [];
    return tagged.some((id) => enrolled.includes(id));
  }
  return true; // "all"
}

function isRead(n) {
  return !!currentProfile?.notifReadIds?.[n.id];
}

/* ---------- rendering ---------- */

function notifItemHtml(n) {
  const read = isRead(n);
  const icon = TYPE_ICON[n.type] || "fa-circle-info";
  const tags = (n.courseTitles || [])
    .map((t) => `<span class="notif-tag">${escapeHtml(t)}</span>`)
    .join("");
  return `
    <button type="button" class="notif-item ${read ? "" : "unread"}" data-id="${n.id}">
      <div class="notif-item-icon"><i class="fa-solid ${icon}"></i></div>
      <div class="notif-item-body">
        <div class="notif-item-title">${escapeHtml(n.title || "")}</div>
        ${n.message ? `<div class="notif-item-msg">${escapeHtml(n.message)}</div>` : ""}
        ${tags ? `<div class="notif-item-tags">${tags}</div>` : ""}
        <div class="notif-item-time">${timeAgo(n.createdAt)}</div>
      </div>
      ${read ? "" : `<span class="notif-dot" aria-hidden="true"></span>`}
    </button>`;
}

function render() {
  const badge = document.getElementById("notif-badge");
  const list = document.getElementById("notif-panel-list");
  if (!badge || !list) return;

  const unread = allNotifs.filter((n) => !isRead(n)).length;
  badge.textContent = unread > 9 ? "9+" : String(unread);
  badge.classList.toggle("hidden", unread === 0);

  if (!allNotifs.length) {
    list.innerHTML = `<div class="notif-empty"><i class="fa-regular fa-bell-slash"></i><span>এখনো কোনো নোটিফিকেশন নেই</span></div>`;
    return;
  }
  list.innerHTML = allNotifs.map(notifItemHtml).join("");
}

/* ---------- read-state ---------- */

function markRead(id) {
  if (!currentUid || !id || isRead({ id })) return;
  currentProfile.notifReadIds = { ...(currentProfile.notifReadIds || {}), [id]: true };
  render();
  updateDoc(doc(db, "users", currentUid), { [`notifReadIds.${id}`]: true }).catch(() => {});
}

function markAllRead() {
  if (!currentUid || !allNotifs.length) return;
  const updates = {};
  const nextMap = { ...(currentProfile.notifReadIds || {}) };
  allNotifs.forEach((n) => {
    if (!nextMap[n.id]) {
      nextMap[n.id] = true;
      updates[`notifReadIds.${n.id}`] = true;
    }
  });
  if (!Object.keys(updates).length) return;
  currentProfile.notifReadIds = nextMap;
  render();
  updateDoc(doc(db, "users", currentUid), updates).catch(() => {});
}

/* ---------- panel open/close ---------- */

function setPanelOpen(open) {
  const panel = document.getElementById("notif-panel");
  const btn = document.getElementById("notif-bell-btn");
  const backdrop = document.getElementById("notif-backdrop");
  if (!panel || !btn) return;
  panelOpen = open;
  if (open) positionPanel(panel);
  panel.hidden = !open;
  btn.classList.toggle("active", open);
  backdrop?.classList.toggle("open", open);
}

// Anchors the panel just below the sticky top navbar (not the bell button
// itself), so it always reads as "a section that drops down under the
// header" instead of overlapping it. Recomputed every time it opens so it
// stays correct across page/nav-height changes and orientation switches.
function positionPanel(panel) {
  const nav = document.querySelector(".topnav");
  const navBottom = nav ? nav.getBoundingClientRect().bottom : 68;
  const gap = 10;
  panel.style.top = `${Math.round(navBottom + gap)}px`;
  panel.style.maxHeight = `calc(100vh - ${Math.round(navBottom + gap)}px - 16px)`;
}

/* ---------- one-time DOM + listener setup ---------- */

function ensureContainer() {
  const mount = document.getElementById("nav-notif");
  if (!mount) return;

  if (!document.getElementById("notif-bell-btn")) {
    mount.innerHTML = `
      <div class="notif-menu" id="notif-menu">
        <button type="button" class="notif-bell-btn" id="notif-bell-btn" aria-label="Notifications">
          <i class="fa-solid fa-bell"></i>
          <span class="notif-badge hidden" id="notif-badge">0</span>
        </button>
        <div class="notif-panel" id="notif-panel" hidden>
          <div class="notif-panel-sheet-handle"></div>
          <div class="notif-panel-head">
            <span>Notifications</span>
            <button type="button" class="notif-markall-btn" id="notif-markall-btn">Mark all read</button>
          </div>
          <div class="notif-panel-list" id="notif-panel-list"></div>
        </div>
      </div>
      <div class="notif-backdrop" id="notif-backdrop"></div>`;
  }

  if (bound) return;
  bound = true;

  document.getElementById("notif-bell-btn").addEventListener("click", (e) => {
    e.stopPropagation();
    setPanelOpen(!panelOpen);
  });
  document.getElementById("notif-markall-btn").addEventListener("click", (e) => {
    e.stopPropagation();
    markAllRead();
  });
  document.getElementById("notif-panel-list").addEventListener("click", (e) => {
    const item = e.target.closest(".notif-item");
    if (!item) return;
    const n = allNotifs.find((x) => x.id === item.dataset.id);
    if (!n) return;
    markRead(n.id);
    const href = targetHref(n);
    if (href) {
      setPanelOpen(false);
      window.location.href = href;
    }
  });
  document.getElementById("notif-backdrop").addEventListener("click", () => setPanelOpen(false));
  document.addEventListener("click", (e) => {
    const menu = document.getElementById("notif-menu");
    if (panelOpen && menu && !menu.contains(e.target)) setPanelOpen(false);
  });
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && panelOpen) setPanelOpen(false);
  });
  window.addEventListener("resize", () => {
    if (panelOpen) positionPanel(document.getElementById("notif-panel"));
  });
}

/* ---------- public API ---------- */

export function mountNotificationBell(uid, profile) {
  currentUid = uid;
  currentProfile = profile || {};
  ensureContainer();
  document.getElementById("nav-notif")?.classList.remove("hidden");

  if (unsub) unsub();
  const q = query(
    collection(db, "notifications"),
    where("active", "==", true),
    orderBy("createdAt", "desc"),
    limit(40)
  );
  unsub = onSnapshot(
    q,
    (snap) => {
      allNotifs = snap.docs
        .map((d) => ({ id: d.id, ...d.data() }))
        .filter((n) => visibleFor(n, currentProfile));
      render();
    },
    () => {
      // Rules not deployed yet, or offline — fail quiet, bell just stays at 0.
    }
  );
}

export function unmountNotificationBell() {
  if (unsub) {
    unsub();
    unsub = null;
  }
  currentUid = null;
  currentProfile = null;
  allNotifs = [];
  setPanelOpen(false);
  document.getElementById("nav-notif")?.classList.add("hidden");
  const badge = document.getElementById("notif-badge");
  if (badge) badge.classList.add("hidden");
  const list = document.getElementById("notif-panel-list");
  if (list) list.innerHTML = "";
}
