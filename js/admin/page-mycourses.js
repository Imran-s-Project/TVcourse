// ==========================================================================
// page-mycourses.js — "My Courses" SPA route (#/mycourses).
// A dedicated, data-smart page for the courses this user is enrolled in.
// Mirrors js/hub.js's single-file render()+init pattern (markup + behavior
// together, one mount point). Replaces the old profile-page "My Courses"
// tab — see js/page-profile.js / js/profile.js.
//
// Smart-engineering notes:
//  - Fetches ONLY the enrolled course documents (parallel getDoc reads),
//    never the full "courses" collection — scales fine at 10 or 10,000
//    published courses, unlike a collection-scan-then-filter approach.
//  - Client-side search + sort run against an in-memory index built once
//    per load, so every keystroke/filter/sort click is O(n) with no
//    network round-trip.
//  - A "Resume" spotlight auto-picks the single most relevant course
//    (closest to finishing) instead of making the user hunt for it.
//  - Search input is debounced; sort/filter choice persists per-account
//    in localStorage so the page remembers how you like to view it.
//  - Skeleton placeholders during fetch instead of a bare spinner.
//  - Card entrance uses an IntersectionObserver reveal; prefers-reduced-
//    motion is already handled globally in css/base.css.
// ==========================================================================
import { db } from "./firebase-config.js";
import { doc, getDoc } from "https://www.gstatic.com/firebasejs/10.13.0/firebase-firestore.js";
import { requireAuth, getUserProfile, escapeHtml, generateCertificatePdf } from "./utils.js";
import { courseUrl } from "./router.js";

export const title = "My Courses — Tech Verse Course";

const FILTERS = [
  { key: "all", label: "All" },
  { key: "in-progress", label: "In Progress" },
  { key: "completed", label: "Completed" },
  { key: "not-started", label: "Not Started" },
];

const SORTS = [
  { key: "smart", label: "Smart Order" },
  { key: "progress-desc", label: "Progress: High to Low" },
  { key: "progress-asc", label: "Progress: Low to High" },
  { key: "az", label: "Title: A → Z" },
];

const STATUS_META = {
  "in-progress": { label: "In Progress", cls: "progress" },
  "completed": { label: "Completed", cls: "done" },
  "not-started": { label: "Not Started", cls: "new" },
};

const PREF_KEY = "tvc_mycourses_prefs"; // per-account UI prefs (filter/sort), not sensitive data

// ── State ──────────────────────────────────────────────────────────────────
let currentUser = null;
let profile = null;
let myCourses = [];        // enrolled courses, enriched with pct + status
let visibleList = [];      // after search+filter+sort — what's actually on screen
let activeFilter = "all";
let activeSort = "smart";
let searchTerm = "";
let searchDebounce = null;
let bootedOnce = false;    // markup mounted once; data still refreshes on every visit
let revealObserver = null;

// ── Markup ───────────────────────────────────────────────────────────────
export function render() {
  return `
  <main class="container">
    <div class="mycourses-header">
      <h1><i class="fa-solid fa-book-open"></i> My Courses</h1>
      <p class="muted">Only the courses you're enrolled in — smart-sorted so what needs finishing comes first.</p>
    </div>

    <div class="mycourses-stats" id="mycourses-stats"></div>

    <div id="mycourses-spotlight"></div>

    <div class="mycourses-toolbar" id="mycourses-toolbar">
      <div class="mc-search">
        <i class="fa-solid fa-magnifying-glass"></i>
        <input type="text" id="mc-search-input" placeholder="Search your courses..." autocomplete="off">
      </div>
      <div class="mycourses-filter-row" id="mycourses-filter-row"></div>
      <select class="mc-sort-select" id="mc-sort-select" aria-label="Sort courses">
        ${SORTS.map((s) => `<option value="${s.key}">${s.label}</option>`).join("")}
      </select>
    </div>

    <div id="mycourses-grid"></div>
  </main>`;
}

// ── Public init — called by app.js's router on every #/mycourses visit ───
export async function initMyCoursesPage() {
  currentUser = await requireAuth();
  if (!currentUser) return;

  if (!bootedOnce) {
    bootedOnce = true;
    loadPrefs();
    document.getElementById("mc-sort-select").value = activeSort;
    bindToolbar();
  }

  await refresh();
}

// ── Preferences (per-account, non-sensitive UI state only) ───────────────
function loadPrefs() {
  try {
    const all = JSON.parse(localStorage.getItem(PREF_KEY) || "{}");
    const mine = all[currentUser.uid];
    if (mine) {
      activeFilter = FILTERS.some((f) => f.key === mine.filter) ? mine.filter : "all";
      activeSort = SORTS.some((s) => s.key === mine.sort) ? mine.sort : "smart";
    }
  } catch { /* corrupt/blocked storage — fall back to defaults silently */ }
}

function savePrefs() {
  try {
    const all = JSON.parse(localStorage.getItem(PREF_KEY) || "{}");
    all[currentUser.uid] = { filter: activeFilter, sort: activeSort };
    localStorage.setItem(PREF_KEY, JSON.stringify(all));
  } catch { /* storage unavailable (private mode, quota, etc.) — non-critical */ }
}

// ── Toolbar bindings (bound once) ─────────────────────────────────────────
function bindToolbar() {
  const searchInput = document.getElementById("mc-search-input");
  searchInput.addEventListener("input", () => {
    clearTimeout(searchDebounce);
    searchDebounce = setTimeout(() => {
      searchTerm = searchInput.value.trim().toLowerCase();
      renderGrid();
    }, 220);
  });

  document.getElementById("mc-sort-select").addEventListener("change", (e) => {
    activeSort = e.target.value;
    savePrefs();
    renderGrid();
  });
}

// ── Refresh: re-fetch profile + enrolled courses, re-render everything ───
async function refresh() {
  showSkeleton();
  profile = await getUserProfile(currentUser.uid);
  await loadCourses();
  renderStats();
  renderSpotlight();
  renderFilters();
  renderGrid();
}

function showSkeleton() {
  const grid = document.getElementById("mycourses-grid");
  grid.innerHTML = `<div class="mc-grid">${Array.from({ length: 3 }).map(() => `
    <div class="mc-card mc-skeleton" aria-hidden="true">
      <div class="mc-skel-cover"></div>
      <div class="mc-body">
        <div class="mc-skel-line" style="width:70%"></div>
        <div class="mc-skel-line" style="width:40%;height:18px;margin-top:10px"></div>
        <div class="mc-skel-line" style="width:100%;height:7px;margin-top:14px"></div>
      </div>
    </div>`).join("")}</div>`;
}

// ── Data — parallel per-document reads, not a full collection scan ───────
async function loadCourses() {
  const enrolled = profile?.enrolledCourses || [];
  if (!enrolled.length) {
    myCourses = [];
    return;
  }
  const snaps = await Promise.all(
    enrolled.map((id) => getDoc(doc(db, "courses", id)).catch(() => null))
  );
  myCourses = snaps
    .filter((s) => s && s.exists())
    .map((s) => {
      const c = { id: s.id, ...s.data() };
      const doneMap = profile?.progress?.[c.id] || {};
      const doneCount = Object.values(doneMap).filter(Boolean).length;
      const pct = c.lessonCount ? Math.round((doneCount / c.lessonCount) * 100) : 0;
      const status = c.lessonCount > 0 && pct >= 100 ? "completed" : pct > 0 ? "in-progress" : "not-started";
      return { ...c, pct, status };
    });
}

// ── Stats strip ──────────────────────────────────────────────────────────
function renderStats() {
  const box = document.getElementById("mycourses-stats");
  const total = myCourses.length;
  const inProgress = myCourses.filter((c) => c.status === "in-progress").length;
  const completed = myCourses.filter((c) => c.status === "completed").length;
  box.innerHTML = `
    <div class="mc-stat"><b>${total}</b><span>Enrolled</span></div>
    <div class="mc-stat"><b>${inProgress}</b><span>In Progress</span></div>
    <div class="mc-stat"><b>${completed}</b><span>Completed</span></div>
  `;
}

// ── Spotlight: auto-picks the single course closest to finishing ─────────
function renderSpotlight() {
  const box = document.getElementById("mycourses-spotlight");
  const candidate = myCourses
    .filter((c) => c.status === "in-progress")
    .sort((a, b) => b.pct - a.pct)[0];

  if (!candidate) {
    box.innerHTML = "";
    return;
  }

  box.innerHTML = `
    <a class="mc-spotlight" href="${courseUrl(candidate.id)}">
      <div class="mc-spotlight-cover" style="${candidate.coverImage ? `background-image:url('${candidate.coverImage}')` : ""}"></div>
      <div class="mc-spotlight-body">
        <span class="mc-spotlight-eyebrow"><i class="fa-solid fa-bolt"></i> Resume where you left off</span>
        <h3>${escapeHtml(candidate.title || "")}</h3>
        <div class="mc-progress-row">
          <div class="progress-track mc-progress-track"><div class="progress-fill" style="width:${candidate.pct}%"></div></div>
          <span class="mc-pct">${candidate.pct}%</span>
        </div>
        <span class="mc-spotlight-cta">Continue Learning <i class="fa-solid fa-arrow-right"></i></span>
      </div>
    </a>`;
}

// ── Filter chips (with live counts) ───────────────────────────────────────
function renderFilters() {
  const row = document.getElementById("mycourses-filter-row");
  if (!myCourses.length) {
    row.innerHTML = "";
    return;
  }
  row.innerHTML = FILTERS.map((f) => {
    const count = f.key === "all" ? myCourses.length : myCourses.filter((c) => c.status === f.key).length;
    const active = f.key === activeFilter;
    return `<button type="button" class="mc-chip ${active ? "active" : ""}" data-filter="${f.key}" aria-pressed="${active}">${f.label} <span>${count}</span></button>`;
  }).join("");
  row.querySelectorAll("[data-filter]").forEach((btn) =>
    btn.addEventListener("click", () => {
      activeFilter = btn.dataset.filter;
      savePrefs();
      renderFilters();
      renderGrid();
    })
  );
}

// ── Filter + search + sort pipeline ───────────────────────────────────────
function computeVisibleList() {
  let list = activeFilter === "all" ? myCourses : myCourses.filter((c) => c.status === activeFilter);

  if (searchTerm) {
    list = list.filter((c) =>
      (c.title || "").toLowerCase().includes(searchTerm) ||
      (c.category || "").toLowerCase().includes(searchTerm)
    );
  }

  const sorters = {
    smart: (a, b) => {
      const order = { "in-progress": 0, "not-started": 1, completed: 2 };
      if (order[a.status] !== order[b.status]) return order[a.status] - order[b.status];
      return b.pct - a.pct;
    },
    "progress-desc": (a, b) => b.pct - a.pct,
    "progress-asc": (a, b) => a.pct - b.pct,
    az: (a, b) => (a.title || "").localeCompare(b.title || ""),
  };
  return [...list].sort(sorters[activeSort] || sorters.smart);
}

// ── Card grid ────────────────────────────────────────────────────────────
function renderGrid() {
  const grid = document.getElementById("mycourses-grid");

  if (!myCourses.length) {
    grid.innerHTML = `
      <div class="empty-state">
        <div class="icon"><i class="fa-solid fa-book-open"></i></div>
        <p>Not enrolled in any courses yet</p>
        <a href="index.html#/home" class="btn btn-primary" style="margin-top:14px;display:inline-flex">Browse Courses</a>
      </div>`;
    return;
  }

  visibleList = computeVisibleList();

  if (!visibleList.length) {
    grid.innerHTML = `<div class="empty-state"><div class="icon"><i class="fa-solid fa-magnifying-glass"></i></div><p>No courses match your search/filter</p></div>`;
    return;
  }

  grid.innerHTML = `<div class="mc-grid">${visibleList.map(cardHtml).join("")}</div>`;

  grid.querySelectorAll("[data-cert-course]").forEach((btn) =>
    btn.addEventListener("click", async () => {
      const c = myCourses.find((x) => x.id === btn.dataset.certCourse);
      if (!c) return;
      const original = btn.innerHTML;
      btn.disabled = true;
      btn.innerHTML = '<span class="spinner"></span>';
      try {
        const certA = (c.id || "").replace(/[^a-zA-Z0-9]/g, "").slice(0, 4).toUpperCase();
        const certB = (currentUser?.uid || "").replace(/[^a-zA-Z0-9]/g, "").slice(0, 6).toUpperCase();
        await generateCertificatePdf({
          studentName: profile?.displayName || currentUser.email.split("@")[0],
          courseTitle: c.title || "",
          certificateId: `TVC-${certA}-${certB}`,
        });
      } finally {
        btn.disabled = false;
        btn.innerHTML = original;
      }
    })
  );

  observeReveal(grid.querySelectorAll(".mc-card"));
}

function cardHtml(c) {
  const meta = STATUS_META[c.status];
  const actionLabel = c.status === "not-started" ? "Start Course" : c.status === "completed" ? "Review Course" : "Continue Learning";
  return `
  <div class="mc-card">
    <a class="mc-card-link" href="${courseUrl(c.id)}">
      <div class="mc-cover" style="${c.coverImage ? `background-image:url('${c.coverImage}')` : ""}">
        <span class="mc-status mc-status-${meta.cls}">${meta.label}</span>
      </div>
      <div class="mc-body">
        <h3>${escapeHtml(c.title || "")}</h3>
        ${c.category ? `<span class="mc-cat">${escapeHtml(c.category)}</span>` : ""}
        <div class="mc-progress-row">
          <div class="progress-track mc-progress-track"><div class="progress-fill" style="width:${c.pct}%"></div></div>
          <span class="mc-pct">${c.pct}%</span>
        </div>
      </div>
    </a>
    <div class="mc-action-row">
      <a class="mc-action-link" href="${courseUrl(c.id)}">${actionLabel} <i class="fa-solid fa-arrow-right"></i></a>
      ${c.status === "completed" ? `<button type="button" class="btn btn-teal btn-sm" data-cert-course="${c.id}"><i class="fa-solid fa-award"></i> Certificate</button>` : ""}
    </div>
  </div>`;
}

// ── Entrance reveal (respects prefers-reduced-motion globally already) ───
function observeReveal(cards) {
  if (revealObserver) revealObserver.disconnect();
  if (!("IntersectionObserver" in window)) {
    cards.forEach((el) => el.classList.add("mc-in"));
    return;
  }
  revealObserver = new IntersectionObserver(
    (entries) => {
      entries.forEach((entry, i) => {
        if (!entry.isIntersecting) return;
        setTimeout(() => entry.target.classList.add("mc-in"), Math.min(i, 6) * 40);
        revealObserver.unobserve(entry.target);
      });
    },
    { threshold: 0.1 }
  );
  cards.forEach((el) => revealObserver.observe(el));
}
