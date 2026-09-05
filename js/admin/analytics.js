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

   Refresh strategy (mirrors the Overview tab's own refresh-button pattern —
   see admin/overview.js's bindOverviewRefresh/loadOverview):
     - Opening the tab reuses the last-loaded numbers instead of re-reading
       both collections every single click, since that's needless Firestore
       reads for data that doesn't change every second.
     - Whenever a purchase is actually approved/rejected (js/admin/purchases.js
       calls invalidateAnalyticsCache() right after), the cache is marked
       stale, so the *next* time the tab is opened it transparently re-fetches
       instead of showing stale revenue/enrollment numbers.
     - A manual Refresh button (bindAnalyticsRefresh, wired the same way as
       Overview's) lets the admin force a re-fetch any time regardless —
       e.g. to pick up a brand-new signup, which nothing above invalidates
       for automatically.
     - A "Last updated" timestamp is shown so it's always visible whether
       what's on screen is fresh or reused.
   ========================================================================== */
let analyticsLoaded = false;
let analyticsLoading = false;
let lastLoadedAt = null;

/* Called by js/admin/purchases.js after an approve/reject actually changes
   purchaseRequests data, so the next tab-open (or refresh click) is forced
   to re-read instead of silently reusing the now-outdated numbers. */
export function invalidateAnalyticsCache() {
  analyticsLoaded = false;
}

function updateLastUpdatedLabel() {
  const el = document.getElementById("analytics-updated-label");
  if (!el) return;
  el.textContent = lastLoadedAt
    ? `Last updated: ${lastLoadedAt.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" })}`
    : "";
}

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

export async function loadAnalyticsSection(force = false) {
  const statGrid = document.getElementById("analytics-stat-grid");
  const topCoursesEl = document.getElementById("analytics-top-courses");
  const monthlyRevEl = document.getElementById("analytics-monthly-revenue");
  const monthlySignupsEl = document.getElementById("analytics-monthly-signups");
  if (analyticsLoaded && !force) return; // still fresh — see refresh-strategy note above
  if (analyticsLoading) return; // a load (tab-open or refresh click) is already in flight
  analyticsLoading = true;
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

    lastLoadedAt = new Date();
    updateLastUpdatedLabel();
  } catch (err) {
    statGrid.innerHTML = `<div class="empty-state"><p>Could not load analytics</p></div>`;
    analyticsLoaded = false;
  } finally {
    analyticsLoading = false;
  }
}

/* ---------- Manual refresh button — same click/spin/disable pattern as
   Overview's bindOverviewRefresh (see admin/overview.js). Bound once from
   admin.js's init, same as that one. ---------- */
export function bindAnalyticsRefresh() {
  const btn = document.getElementById("analytics-refresh-btn");
  btn?.addEventListener("click", () => {
    if (analyticsLoading) return;
    btn.disabled = true;
    const icon = btn.querySelector("i");
    icon?.classList.add("fa-spin");
    loadAnalyticsSection(true).finally(() => {
      btn.disabled = false;
      icon?.classList.remove("fa-spin");
    });
  });
}

