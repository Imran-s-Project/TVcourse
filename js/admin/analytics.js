// ==========================================================================
// admin/analytics.js — Analytics tab: revenue, top courses, monthly trends
// (all computed client-side from purchaseRequests/users — no billing plan,
// no Cloud Functions, 100% free)
// ==========================================================================
import { db } from "../firebase-config.js";
import {
  collection, getDocs,
} from "https://www.gstatic.com/firebasejs/10.13.0/firebase-firestore.js";
import { escapeHtml } from "../utils.js";

/* ==========================================================================
   Analytics — revenue, top courses, monthly trends
   (all computed client-side from purchaseRequests/users — no billing plan,
   no Cloud Functions, 100% free)
   ========================================================================== */
let analyticsLoaded = false;

export function monthKey(ts) {
  const d = ts?.toDate ? ts.toDate() : ts instanceof Date ? ts : null;
  if (!d) return null;
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}
function monthLabel(key) {
  const [y, m] = key.split("-");
  return new Date(Number(y), Number(m) - 1, 1).toLocaleDateString("en-US", { month: "short", year: "2-digit" });
}
function lastNMonthKeys(n) {
  const out = [];
  const now = new Date();
  for (let i = n - 1; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    out.push(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`);
  }
  return out;
}
function barListHtml(rows, { valuePrefix = "", maxBars = 8 } = {}) {
  const top = rows.slice(0, maxBars);
  const max = Math.max(1, ...top.map((r) => r.value));
  if (!top.length) return `<div class="empty-state">No data yet</div>`;
  return `<div class="analytics-bars">${top
    .map(
      (r) => `
      <div class="analytics-bar-row">
        <div class="analytics-bar-label" title="${escapeHtml(r.label)}">${escapeHtml(r.label)}</div>
        <div class="analytics-bar-track"><div class="analytics-bar-fill" style="width:${Math.max(4, (r.value / max) * 100)}%"></div></div>
        <div class="analytics-bar-value">${valuePrefix}${r.value.toLocaleString()}</div>
      </div>`
    )
    .join("")}</div>`;
}

export async function loadAnalyticsSection() {
  const statGrid = document.getElementById("analytics-stat-grid");
  const topCoursesEl = document.getElementById("analytics-top-courses");
  const monthlyRevEl = document.getElementById("analytics-monthly-revenue");
  const monthlySignupsEl = document.getElementById("analytics-monthly-signups");
  if (analyticsLoaded) return; // static-ish data — re-open the tab any time to force a refresh via loadOverview flows elsewhere
  analyticsLoaded = true;

  try {
    const [purchasesSnap, usersSnap] = await Promise.all([
      getDocs(collection(db, "purchaseRequests")),
      getDocs(collection(db, "users")),
    ]);
    const purchases = purchasesSnap.docs.map((d) => d.data());
    const users = usersSnap.docs.map((d) => d.data());
    const approved = purchases.filter((p) => p.status === "approved");

    const totalRevenue = approved.reduce((sum, p) => sum + (Number(p.amount) || 0), 0);
    const thisMonthKey = monthKey(new Date());
    const thisMonthRevenue = approved
      .filter((p) => monthKey(p.reviewedAt || p.createdAt) === thisMonthKey)
      .reduce((sum, p) => sum + (Number(p.amount) || 0), 0);
    const avgOrder = approved.length ? Math.round(totalRevenue / approved.length) : 0;

    statGrid.innerHTML = [
      { n: `৳${totalRevenue.toLocaleString()}`, l: "Total Revenue" },
      { n: `৳${thisMonthRevenue.toLocaleString()}`, l: "This Month" },
      { n: approved.length, l: "Paid Enrollments" },
      { n: `৳${avgOrder.toLocaleString()}`, l: "Avg. Order Value" },
      { n: purchases.filter((p) => p.status === "pending").length, l: "Pending Requests" },
    ]
      .map((s) => `<div class="stat-card"><div class="n">${s.n}</div><div class="l">${s.l}</div></div>`)
      .join("");

    // Top courses by revenue (falls back to purchase count if no amount data)
    const byCourse = {};
    approved.forEach((p) => {
      const key = p.courseId || p.courseTitle || "unknown";
      if (!byCourse[key]) byCourse[key] = { label: p.courseTitle || "Untitled", value: 0, count: 0 };
      byCourse[key].value += Number(p.amount) || 0;
      byCourse[key].count += 1;
    });
    const topCourseRows = Object.values(byCourse).sort((a, b) => b.value - a.value);
    topCoursesEl.innerHTML = barListHtml(topCourseRows, { valuePrefix: "৳" });

    // Monthly revenue trend — last 6 months
    const months = lastNMonthKeys(6);
    const revByMonth = {};
    months.forEach((m) => (revByMonth[m] = 0));
    approved.forEach((p) => {
      const k = monthKey(p.reviewedAt || p.createdAt);
      if (k && k in revByMonth) revByMonth[k] += Number(p.amount) || 0;
    });
    monthlyRevEl.innerHTML = barListHtml(
      months.map((m) => ({ label: monthLabel(m), value: revByMonth[m] })),
      { valuePrefix: "৳", maxBars: 6 }
    );

    // New signups trend — last 6 months
    const signupsByMonth = {};
    months.forEach((m) => (signupsByMonth[m] = 0));
    users.forEach((u) => {
      const k = monthKey(u.createdAt);
      if (k && k in signupsByMonth) signupsByMonth[k] += 1;
    });
    monthlySignupsEl.innerHTML = barListHtml(
      months.map((m) => ({ label: monthLabel(m), value: signupsByMonth[m] })),
      { maxBars: 6 }
    );
  } catch (err) {
    statGrid.innerHTML = `<div class="empty-state"><p>Could not load analytics</p></div>`;
    analyticsLoaded = false;
  }
}

