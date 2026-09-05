// ==========================================================================
// admin/overview.js — Overview tab: stat grid, recent signups, most popular
// course, and the "submissions by date" breakdown
// ==========================================================================
import { db } from "../firebase-config.js";
import {
  collection, getDocs, query, where, getCountFromServer,
} from "https://www.gstatic.com/firebasejs/10.13.0/firebase-firestore.js";
import { escapeHtml, formatDate, timeAgo } from "../utils.js";
import { courses } from "../admin.js";
import { isUserOnline, showUserDetail, userAvatarHtml } from "./users.js";
import { monthKey } from "./analytics.js";

/* ==========================================================================
   Overview
   ========================================================================== */
export async function loadOverview() {
  const grid = document.getElementById("stat-grid");
  try {
    const [lessonCount, examsSnap, usersSnap, resultsSnap, pendingSnap, purchasesSnap] = await Promise.all([
      Promise.resolve(courses.reduce((sum, c) => sum + (c.lessonCount || 0), 0)),
      getDocs(collection(db, "exams")),
      getDocs(collection(db, "users")),
      getDocs(collection(db, "results")),
      getCountFromServer(query(collection(db, "purchaseRequests"), where("status", "==", "pending"))),
      getDocs(collection(db, "purchaseRequests")),
    ]);
    // Online count + active-learner count are derived from the users we already
    // fetched — no extra reads needed just to slice the same data differently.
    const onlineCount = usersSnap.docs.filter((d) => isUserOnline(d.data())).length;
    const activeLearnerCount = usersSnap.docs.filter((d) => (d.data().enrolledCourses || []).length > 0).length;
    const pendingCount = pendingSnap.data().count;

    const thisMonthKey = monthKey(new Date());
    const monthRevenue = purchasesSnap.docs
      .map((d) => d.data())
      .filter((p) => p.status === "approved" && monthKey(p.reviewedAt || p.createdAt) === thisMonthKey)
      .reduce((sum, p) => sum + (Number(p.amount) || 0), 0);

    // Each card is clickable: "nav" jumps to that admin section, "scroll" jumps
    // to a spot further down this same page (used for cards with no dedicated tab).
    const stats = [
      { icon: "fa-book", tone: "violet", n: courses.length, l: "Courses", nav: "courses" },
      { icon: "fa-video", tone: "teal", n: lessonCount, l: "Videos", nav: "lessons" },
      { icon: "fa-file-pen", tone: "coral", n: examsSnap.size, l: "Exams", nav: "exams" },
      { icon: "fa-users", tone: "green", n: usersSnap.size, l: "Registered Users", nav: "users" },
      { icon: "fa-user-graduate", tone: "violet", n: activeLearnerCount, l: "Active Learners", nav: "users" },
      { icon: "fa-clipboard-check", tone: "violet", n: resultsSnap.size, l: "Exams Taken", scroll: "recent-results-card" },
      { icon: "fa-sack-dollar", tone: "teal", n: `৳${monthRevenue.toLocaleString()}`, l: "This Month's Revenue", nav: "analytics" },
      { icon: "fa-money-bill-wave", tone: pendingCount > 0 ? "alert" : "muted", n: pendingCount, l: "Pending Purchases", nav: "purchases" },
      { icon: "fa-tower-broadcast", tone: "green", n: onlineCount, l: "Online Now", nav: "users" },
    ];

    grid.innerHTML = stats
      .map(
        (s) => `
      <button type="button" class="ov-stat-card tone-${s.tone}" data-nav="${s.nav || ""}" data-scroll="${s.scroll || ""}">
        <span class="ov-stat-icon"><i class="fa-solid ${s.icon}"></i></span>
        <span class="ov-stat-body">
          <span class="ov-stat-n">${s.n}</span>
          <span class="ov-stat-l">${s.l}</span>
        </span>
        <i class="fa-solid fa-chevron-right ov-stat-arrow"></i>
      </button>`
      )
      .join("");

    grid.querySelectorAll(".ov-stat-card").forEach((card) => {
      card.addEventListener("click", () => {
        if (card.dataset.nav) {
          document.querySelector(`.admin-nav-item[data-section="${card.dataset.nav}"]`)?.click();
        } else if (card.dataset.scroll) {
          document.getElementById(card.dataset.scroll)?.scrollIntoView({ behavior: "smooth", block: "start" });
        }
      });
    });

    const usersMap = {};
    usersSnap.docs.forEach((d) => (usersMap[d.id] = d.data()));
    renderSubmissionsByDate(resultsSnap.docs.map((d) => d.data()), usersMap);
    renderRecentSignups(usersSnap.docs.map((d) => ({ id: d.id, ...d.data() })));
    renderMostPopularCourse(usersSnap.docs.map((d) => d.data()));
  } catch (err) {
    grid.innerHTML = `<div class="empty-state"><p>Could not load</p></div>`;
  }
}

/* ---------- Recent Signups — last 6 registered users, newest first ---------- */
function renderRecentSignups(users) {
  const list = document.getElementById("ov-signups-list");
  if (!list) return;
  const recent = [...users]
    .sort((a, b) => (b.createdAt?.seconds || 0) - (a.createdAt?.seconds || 0))
    .slice(0, 6);
  if (!recent.length) {
    list.innerHTML = `<div class="empty-state">No signups yet</div>`;
    return;
  }
  list.innerHTML = recent
    .map(
      (u) => `
    <div class="ov-signup-row" data-view-user="${u.id}">
      ${userAvatarHtml(u)}
      <div class="ov-signup-main">
        <div class="ov-signup-name">${escapeHtml(u.displayName || "Unnamed User")}</div>
        <div class="ov-signup-email">${escapeHtml(u.email || "")}</div>
      </div>
      <span class="ov-signup-time">${u.createdAt ? timeAgo(u.createdAt) : ""}</span>
    </div>`
    )
    .join("");
  list.querySelectorAll("[data-view-user]").forEach((el) =>
    el.addEventListener("click", () => {
      document.querySelector('.admin-nav-item[data-section="users"]')?.click();
      showUserDetail(el.dataset.viewUser);
    })
  );
}

/* ---------- Most Popular Course — ranked by live enrollment count, tallied
   from users.enrolledCourses (no extra Firestore read; users are already
   loaded for the stat grid above). ---------- */
function renderMostPopularCourse(users) {
  const body = document.getElementById("ov-popular-body");
  if (!body) return;
  const counts = {};
  users.forEach((u) => (u.enrolledCourses || []).forEach((cid) => (counts[cid] = (counts[cid] || 0) + 1)));
  const topId = Object.keys(counts).sort((a, b) => counts[b] - counts[a])[0];
  const topCourse = topId ? courses.find((c) => c.id === topId) : null;

  if (!topCourse) {
    body.innerHTML = `<div class="empty-state">No enrollments yet</div>`;
    return;
  }
  body.innerHTML = `
    <img class="ov-popular-cover" src="${escapeHtml(topCourse.coverImage || "")}" alt="">
    <div class="ov-popular-info">
      <div class="ov-popular-title">${escapeHtml(topCourse.title)}</div>
      <div class="ov-popular-count"><b>${counts[topId]}</b> student${counts[topId] > 1 ? "s" : ""} enrolled</div>
      <button type="button" class="btn btn-outline btn-sm ov-popular-link" id="ov-popular-view-btn">View Course</button>
    </div>`;
  document.getElementById("ov-popular-view-btn")?.addEventListener("click", () => {
    document.querySelector('.admin-nav-item[data-section="courses"]')?.click();
  });
}

export function bindOverviewRefresh() {
  const btn = document.getElementById("overview-refresh-btn");
  btn?.addEventListener("click", () => {
    btn.disabled = true;
    const icon = btn.querySelector("i");
    icon?.classList.add("fa-spin");
    loadOverview().finally(() => {
      btn.disabled = false;
      icon?.classList.remove("fa-spin");
    });
  });
}

/* ---------- Group all exam submissions by calendar day for the Overview
   panel: each day collapses to a single row (date only); tapping it expands
   to show that day's per-exam breakdown and every submission's exact time. ---------- */
function submissionDayKey(ts) {
  const d = ts?.toDate ? ts.toDate() : ts instanceof Date ? ts : null;
  if (!d) return null;
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}
function submissionClockTime(ts) {
  const d = ts?.toDate ? ts.toDate() : new Date(ts);
  const h = d.getHours();
  const period = h < 12 ? "AM" : "PM";
  let h12 = h % 12;
  if (h12 === 0) h12 = 12;
  const m = String(d.getMinutes()).padStart(2, "0");
  return `${h12}:${m} ${period}`;
}
function renderSubmissionsByDate(results, usersMap) {
  const container = document.getElementById("submissions-by-date");
  const totalLabel = document.getElementById("submissions-total-label");
  const summaryStrip = document.getElementById("sub-summary-strip");

  const dayGroups = new Map(); // dayKey -> { date, items: [] }
  results.forEach((r) => {
    const key = submissionDayKey(r.submittedAt);
    if (!key) return;
    if (!dayGroups.has(key)) dayGroups.set(key, { date: r.submittedAt.toDate(), items: [] });
    dayGroups.get(key).items.push(r);
  });
  const sortedDays = [...dayGroups.values()].sort((a, b) => b.date - a.date);
  sortedDays.forEach((g) => g.items.sort((a, b) => (b.submittedAt?.seconds || 0) - (a.submittedAt?.seconds || 0)));

  totalLabel.textContent = results.length
    ? `${results.length} submission${results.length > 1 ? "s" : ""} across ${sortedDays.length} day${sortedDays.length > 1 ? "s" : ""}`
    : "";

  // Quick-glance summary strip: total submissions, unique students, average score —
  // gives the admin the headline numbers before scanning the day-by-day list.
  if (results.length) {
    const uniqueStudents = new Set(results.map((r) => r.uid)).size;
    const avgPct = Math.round(
      (results.reduce((sum, r) => sum + (r.total ? r.score / r.total : 0), 0) / results.length) * 100
    );
    summaryStrip.innerHTML = `
      <div class="sub-summary-item"><span class="sub-summary-n">${results.length}</span><span class="sub-summary-l">Total Submissions</span></div>
      <div class="sub-summary-item"><span class="sub-summary-n">${uniqueStudents}</span><span class="sub-summary-l">Unique Students</span></div>
      <div class="sub-summary-item"><span class="sub-summary-n">${avgPct}%</span><span class="sub-summary-l">Average Score</span></div>
    `;
    summaryStrip.classList.remove("hidden");
  } else {
    summaryStrip.classList.add("hidden");
    summaryStrip.innerHTML = "";
  }

  if (!sortedDays.length) {
    container.innerHTML = `<div class="empty-state">No exam submissions yet</div>`;
    return;
  }

  container.innerHTML = sortedDays
    .map((g) => {
      const examCounts = {};
      g.items.forEach((r) => {
        const t = r.examTitle || "Untitled Exam";
        examCounts[t] = (examCounts[t] || 0) + 1;
      });
      const examChips = Object.entries(examCounts)
        .sort((a, b) => b[1] - a[1])
        .map(([title, count]) => `<span class="sub-exam-chip">${escapeHtml(title)}${count > 1 ? ` &times; ${count}` : ""}</span>`)
        .join("");
      const rows = g.items
        .map((r) => {
          const pct = r.total ? Math.round((r.score / r.total) * 100) : 0;
          const tier = pct >= 80 ? "high" : pct >= 50 ? "mid" : "low";
          return `
          <div class="sub-item">
            <div class="sub-item-main">
              <span class="sub-item-user">${escapeHtml(usersMap[r.uid]?.displayName || usersMap[r.uid]?.email || "Unknown")}</span>
              <span class="sub-item-exam">${escapeHtml(r.examTitle || "Untitled Exam")}</span>
            </div>
            <div class="sub-item-meta">
              <span class="sub-item-score tier-${tier}">${r.score}/${r.total} <span class="sub-item-pct">${pct}%</span></span>
              <span class="sub-item-time">${submissionClockTime(r.submittedAt)}</span>
            </div>
          </div>`;
        })
        .join("");
      return `
        <div class="sub-day">
          <button type="button" class="sub-day-head">
            <span class="sub-day-date">${formatDate(g.date)}</span>
            <span class="sub-day-right">
              <span class="sub-day-count">${g.items.length} submission${g.items.length > 1 ? "s" : ""}</span>
              <i class="fa-solid fa-chevron-down sub-day-chevron"></i>
            </span>
          </button>
          <div class="sub-day-body">
            <div class="sub-day-body-inner">
              <div class="sub-exam-chips">${examChips}</div>
              <div class="sub-item-list">${rows}</div>
            </div>
          </div>
        </div>`;
    })
    .join("");

  container.querySelectorAll(".sub-day-head").forEach((btn) => {
    btn.addEventListener("click", () => btn.parentElement.classList.toggle("open"));
  });
}

