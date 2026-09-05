// ==========================================================================
// admin.js — Full admin panel: courses, lessons/videos, exams, users, homepage
// (entry point — bootstraps the panel; each section's logic lives in its own
// file under js/admin/ so this file stays small and easy to navigate)
// ==========================================================================
import { db } from "./firebase-config.js";
import {
  collection, getDocs,
} from "https://www.gstatic.com/firebasejs/10.13.0/firebase-firestore.js";
import { initNav, requireAdmin } from "./utils.js";
import { initFlashcardsSection, initDiscussionModerationSection } from "./admin-hub.js";

import { loadOverview, bindOverviewRefresh } from "./admin/overview.js";
import { loadAnalyticsSection, bindAnalyticsRefresh } from "./admin/analytics.js";
import { loadNotificationsList } from "./admin/notifications.js";
import { loadHomepageSettings } from "./admin/homepage.js";
import { loadCoursesTable } from "./admin/courses.js";
import { bindLessonsSection } from "./admin/lessons.js";
import { loadExamsTable } from "./admin/exams.js";
import { loadUsersTable } from "./admin/users.js";
import { loadPaymentSettings, loadPurchasesTable } from "./admin/purchases.js";
import { initLeaderboardSection } from "./admin/leaderboard.js";
import { loadCouponsTable } from "./admin/coupons.js";

initNav("admin");

export let me = null;         // { user, profile }
export let courses = [];      // Cached course list

async function init() {
  me = await requireAdmin();
  if (!me) return;
  document.getElementById("admin-gate").classList.add("hidden");
  document.getElementById("admin-shell").classList.remove("hidden");

  bindSidebar();
  document.getElementById("user-detail-back-btn")?.addEventListener("click", () => {
    document.querySelector('.admin-nav-item[data-section="users"]')?.click();
  });
  bindOverviewRefresh();
  bindAnalyticsRefresh();
  await refreshCourses();
  loadOverview();
  loadHomepageSettings();
  loadCoursesTable();
  loadExamsTable();
  loadUsersTable();
  loadPaymentSettings();
  loadPurchasesTable();
  loadCouponsTable();
  bindLessonsSection();
}

/* ---------- Sidebar section switching + mobile drawer ---------- */
function bindSidebar() {
  const sidebar = document.getElementById("admin-sidebar");
  const backdrop = document.getElementById("admin-sidebar-backdrop");
  const drawerToggle = document.getElementById("admin-drawer-toggle");
  const drawerClose = document.getElementById("admin-drawer-close");
  const mobileTitle = document.getElementById("admin-mobile-topbar-title");

  const closeDrawer = () => {
    sidebar?.classList.remove("open");
    backdrop?.classList.remove("open");
  };

  drawerToggle?.addEventListener("click", () => {
    sidebar?.classList.toggle("open");
    backdrop?.classList.toggle("open");
  });
  backdrop?.addEventListener("click", closeDrawer);
  drawerClose?.addEventListener("click", closeDrawer);

  document.querySelectorAll(".admin-nav-item").forEach((btn) => {
    btn.addEventListener("click", () => {
      document.querySelectorAll(".admin-nav-item").forEach((b) => b.classList.remove("active"));
      document.querySelectorAll(".admin-section").forEach((s) => s.classList.remove("active"));
      btn.classList.add("active");
      document.getElementById(`section-${btn.dataset.section}`).classList.add("active");
      if (mobileTitle) mobileTitle.textContent = btn.dataset.label || btn.textContent.trim();
      if (btn.dataset.section === "leaderboard") initLeaderboardSection();
      if (btn.dataset.section === "analytics") loadAnalyticsSection();
      if (btn.dataset.section === "notifications") loadNotificationsList();
      if (btn.dataset.section === "flashcards") initFlashcardsSection(courses);
      if (btn.dataset.section === "discussion") initDiscussionModerationSection();
      closeDrawer();
    });
  });
}

export async function refreshCourses() {
  // Fetched without orderBy() on purpose — see the note in exam.js loadExamList().
  const snap = await getDocs(collection(db, "courses"));
  courses = snap.docs
    .map((d) => ({ id: d.id, ...d.data() }))
    .sort((a, b) => (b.createdAt?.seconds || 0) - (a.createdAt?.seconds || 0));
  return courses;
}

init();
