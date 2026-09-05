// ==========================================================================
// page-parent.js — "Parent Dashboard" SPA route (#/parent).
// Read-only view for a linked parent/guardian account: switch between
// linked children, see their course progress and exam results. Mirrors
// js/page-mycourses.js's single-file render()+init pattern (markup +
// behavior together, one mount point, data re-fetched on every visit).
//
// Smart-engineering notes:
//  - One delegated click listener on the (never-replaced) #pd-content
//    container handles every action (select child / add child / unlink) —
//    no per-render re-binding needed even though the inner HTML is fully
//    replaced on every refresh(), same reasoning as page-mycourses.js.
//  - fetchAllChildren() (js/parent-data.js) quietly drops any child whose
//    access was revoked from their side, so a stale link never renders a
//    broken card.
//  - Course progress % uses the exact same calculation as "My Courses" so
//    the numbers a parent sees always match what the child sees.
// ==========================================================================
import { requireAuth, getUserProfile, toast, escapeHtml, formatDate, formatScore, openModal, closeModal, confirmAction } from "./utils.js";
import { fetchAllChildren, linkChildByCode, unlinkChild } from "./parent-data.js";

export const title = "Parent Dashboard — Tech Verse Course";

// ── State ──────────────────────────────────────────────────────────────────
let currentUser = null;
let children = [];      // [{ profile, courses, results }, ...]
let selectedUid = null;
let bootedOnce = false;

// ── Markup ───────────────────────────────────────────────────────────────
export function render() {
  return `
  <main class="container">
    <div class="pd-header">
      <h1><i class="fa-solid fa-people-roof"></i> Parent Dashboard</h1>
      <p class="muted">Track your child's course progress and exam results — read-only, all in one place.</p>
    </div>
    <div id="pd-content"></div>
  </main>`;
}

// ── Public init — called by app.js's router on every #/parent visit ──────
export async function initParentPage() {
  currentUser = await requireAuth();
  if (!currentUser) return;

  if (!bootedOnce) {
    bootedOnce = true;
    bindDelegatedEvents();
  }

  await refresh();
}

// ── Data refresh ───────────────────────────────────────────────────────────
async function refresh() {
  showSkeleton();
  const parentProfile = await getUserProfile(currentUser.uid);
  children = await fetchAllChildren(currentUser.uid, parentProfile);

  if (!children.length) {
    renderEmpty();
    return;
  }
  if (!selectedUid || !children.some((c) => c.profile.id === selectedUid)) {
    selectedUid = children[0].profile.id;
  }
  renderDashboard();
}

function showSkeleton() {
  document.getElementById("pd-content").innerHTML = `<div class="loading-screen"><span class="spinner"></span></div>`;
}

function renderEmpty() {
  document.getElementById("pd-content").innerHTML = `
    <div class="pd-empty">
      <div class="icon"><i class="fa-solid fa-user-plus"></i></div>
      <h3>No Child Linked Yet</h3>
      <p>Ask your child to open <b>Profile → Family</b> on their own account and share their Family Link Code with you. Enter it below to start tracking their progress.</p>
      <button type="button" class="btn btn-primary" data-pd-action="add-child"><i class="fa-solid fa-link"></i> Link Your Child's Account</button>
    </div>`;
}

// ── Dashboard render ───────────────────────────────────────────────────────
function renderDashboard() {
  const child = children.find((c) => c.profile.id === selectedUid);
  document.getElementById("pd-content").innerHTML = renderSwitcher() + (child ? renderChildDetail(child) : "");
}

function chipAvatar(profile, size = "sm") {
  const cls = size === "sm" ? "pd-chip-avatar" : "pd-child-avatar";
  return profile.photoURL
    ? `<span class="${cls}"><img src="${profile.photoURL}" alt=""></span>`
    : `<span class="${cls}">${escapeHtml((profile.displayName || "?").charAt(0).toUpperCase())}</span>`;
}

function renderSwitcher() {
  const chips = children
    .map((c) => {
      const p = c.profile;
      const active = p.id === selectedUid;
      return `<button type="button" class="pd-chip ${active ? "active" : ""}" data-pd-action="select-child" data-uid="${p.id}">
        ${chipAvatar(p)} ${escapeHtml(p.displayName || "Student")}
      </button>`;
    })
    .join("");
  return `<div class="pd-switcher">
    ${chips}
    <button type="button" class="pd-add-chip" data-pd-action="add-child"><i class="fa-solid fa-plus"></i> Add Child</button>
  </div>`;
}

function renderChildDetail(child) {
  const p = child.profile;
  const joined = p.createdAt ? formatDate(p.createdAt) : "";
  return `
    <div class="pd-child-head card">
      ${chipAvatar(p, "lg")}
      <div class="pd-child-info">
        <h2>${escapeHtml(p.displayName || "Student")}</h2>
        <div class="pd-child-meta">
          ${p.email ? `<span><i class="fa-regular fa-envelope"></i> ${escapeHtml(p.email)}</span>` : ""}
          ${joined ? `<span><i class="fa-regular fa-calendar"></i> Joined ${joined}</span>` : ""}
        </div>
      </div>
      <button type="button" class="btn btn-outline btn-sm pd-unlink-btn" data-pd-action="unlink" data-uid="${p.id}">
        <i class="fa-solid fa-link-slash"></i> Unlink
      </button>
    </div>

    ${renderStats(child)}

    <div class="pd-section-title"><i class="fa-solid fa-book-open"></i> Course Progress</div>
    ${renderCourses(child.courses)}

    <div class="pd-section-title"><i class="fa-solid fa-file-pen"></i> Exam Results</div>
    <div>${renderResults(child.results)}</div>
  `;
}

function renderStats(child) {
  const courses = child.courses;
  const results = child.results;
  const enrolled = courses.length;
  const completed = courses.filter((c) => c.status === "completed").length;
  const avgProgress = enrolled ? Math.round(courses.reduce((s, c) => s + c.pct, 0) / enrolled) : 0;
  const examsTaken = results.length;
  const avgScore = examsTaken
    ? Math.round(results.reduce((s, r) => s + resultPercent(r), 0) / examsTaken)
    : 0;

  const stats = [
    { icon: "fa-book-open", val: enrolled, label: "Enrolled Courses" },
    { icon: "fa-circle-check", val: completed, label: "Completed" },
    { icon: "fa-chart-line", val: `${avgProgress}%`, label: "Avg. Progress" },
    { icon: "fa-file-pen", val: examsTaken, label: "Exams Taken" },
    { icon: "fa-award", val: `${avgScore}%`, label: "Avg. Score" },
  ];
  return `<div class="pd-stats">${stats
    .map(
      (s) => `
    <div class="stat-card card">
      <i class="fa-solid ${s.icon}"></i>
      <div><b>${s.val}</b><span>${s.label}</span></div>
    </div>`
    )
    .join("")}</div>`;
}

const COURSE_STATUS_LABEL = { "in-progress": "In Progress", completed: "Completed", "not-started": "Not Started" };

function renderCourses(courses) {
  if (!courses.length) {
    return `<div class="empty-state"><div class="icon"><i class="fa-solid fa-book-open"></i></div><p>Not enrolled in any course yet</p></div>`;
  }
  return `<div class="pd-course-grid">${courses
    .map(
      (c) => `
    <div class="pd-course-card">
      <div class="pd-course-cover" style="${c.coverImage ? `background-image:url('${c.coverImage}')` : ""}">
        <span class="pd-course-status ${c.status}">${COURSE_STATUS_LABEL[c.status]}</span>
      </div>
      <div class="pd-course-body">
        <h4>${escapeHtml(c.title || "")}</h4>
        <div class="pd-course-progress-row">
          <div class="pd-course-progress-track"><div class="progress-fill" style="width:${c.pct}%"></div></div>
          <span class="pd-course-pct">${c.pct}%</span>
        </div>
      </div>
    </div>`
    )
    .join("")}</div>`;
}

function resultPercent(r) {
  if (typeof r.percent === "number") return r.percent;
  return r.total ? Math.round((r.score / r.total) * 100) : 0;
}

function renderResults(results) {
  if (!results.length) {
    return `<div class="empty-state"><div class="icon"><i class="fa-solid fa-file-pen"></i></div><p>No exams taken yet</p></div>`;
  }
  return results
    .map((r) => {
      const pct = resultPercent(r);
      const band = pct >= 80 ? "high" : pct >= 50 ? "mid" : "low";
      return `
      <div class="pd-result-row card">
        <div>
          <h4>${escapeHtml(r.examTitle || "Exam")}</h4>
          <div class="pd-result-meta">
            <span><i class="fa-regular fa-calendar"></i> ${formatDate(r.submittedAt)}</span>
            ${r.attemptNumber ? `<span><i class="fa-solid fa-rotate-right"></i> Attempt ${r.attemptNumber}</span>` : ""}
          </div>
        </div>
        <div class="pd-result-score-wrap">
          <span class="pd-result-score">${formatScore(r.score)}/${r.total}</span>
          <span class="pd-percent-pill pd-percent-${band}">${pct}%</span>
        </div>
      </div>`;
    })
    .join("");
}

// ── Events (delegated once onto #pd-content, which is never replaced itself) ──
function bindDelegatedEvents() {
  document.getElementById("pd-content").addEventListener("click", (e) => {
    const btn = e.target.closest("[data-pd-action]");
    if (!btn) return;
    const action = btn.dataset.pdAction;
    if (action === "add-child") openAddChildModal();
    else if (action === "select-child") {
      selectedUid = btn.dataset.uid;
      renderDashboard();
    } else if (action === "unlink") {
      handleUnlink(btn.dataset.uid);
    }
  });
}

function openAddChildModal() {
  openModal(`
    <div class="modal-head">
      <h3><i class="fa-solid fa-user-plus"></i> Link Your Child's Account</h3>
      <button type="button" class="modal-close-btn" data-modal-close><i class="fa-solid fa-xmark"></i></button>
    </div>
    <div class="pd-link-form">
      <p class="pd-link-hint">Ask your child to open <b>Profile → Family</b> on their own account and share their Family Link Code with you.</p>
      <div class="field">
        <label for="pd-link-code-input">Family Link Code</label>
        <input type="text" id="pd-link-code-input" placeholder="e.g. AB2CD9EFGH" maxlength="12" autocomplete="off">
      </div>
      <div class="form-error" id="pd-link-error"></div>
      <button type="button" class="btn btn-primary btn-block" id="pd-link-submit-btn">Link Child</button>
    </div>
  `);
  const input = document.getElementById("pd-link-code-input");
  setTimeout(() => input?.focus(), 50);
  document.getElementById("pd-link-submit-btn").addEventListener("click", submitAddChild);
  input?.addEventListener("keydown", (e) => {
    if (e.key === "Enter") submitAddChild();
  });
}

async function submitAddChild() {
  const input = document.getElementById("pd-link-code-input");
  const errorEl = document.getElementById("pd-link-error");
  const btn = document.getElementById("pd-link-submit-btn");
  errorEl.textContent = "";
  btn.disabled = true;
  const originalHtml = btn.innerHTML;
  btn.innerHTML = `<span class="spinner"></span>`;
  try {
    await linkChildByCode(currentUser.uid, input.value);
    closeModal();
    toast("Child account linked", "success");
    await refresh();
  } catch (err) {
    errorEl.textContent = err.message || "Couldn't link that account. Please try again.";
    btn.disabled = false;
    btn.innerHTML = originalHtml;
  }
}

async function handleUnlink(uid) {
  const child = children.find((c) => c.profile.id === uid);
  const name = child?.profile?.displayName || "this account";
  const ok = await confirmAction(
    `Unlink ${name}? You'll stop seeing their progress and exam results until they share a new link code with you.`,
    { title: "Unlink Child Account", confirmLabel: "Yes, Unlink" }
  );
  if (!ok) return;
  await unlinkChild(currentUser.uid, uid);
  toast("Unlinked", "success");
  if (selectedUid === uid) selectedUid = null;
  await refresh();
}
