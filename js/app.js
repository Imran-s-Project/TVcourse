// ==========================================================================
// app.js — SPA entry point for Tech Verse Course
// Orchestrates routing between the home/dashboard page, the course page,
// the profile page, and the static content routes
// (about/credits/help/privacy/terms).
// URL scheme:  mydomain.com/           → home (dashboard)
//              mydomain.com/#/course?id=xxx   → course page (no reload)
//              mydomain.com/#/exam             → exam list (no exam.html file)
//              mydomain.com/#/exam?id=xxx      → take a specific exam
//              mydomain.com/#/home            → home (explicit)
//              mydomain.com/#/profile          → profile page
//              mydomain.com/#/about (etc.)     → static content page
//              mydomain.com/#/login            → login (no login.html file)
//              mydomain.com/#/signup           → signup (no signup.html file)
// ==========================================================================

import { Router, parseHash, courseUrl } from "./router.js";
import { initDashboard } from "./dashboard.js";
import { initCoursePage } from "./course.js";
import { initExamPage } from "./exam.js";
import { initProfilePage, activateTab } from "./profile.js";
import * as pageHub from "./hub.js";
import { initNav } from "./utils.js";
import * as pageAbout from "./page-about.js";
import * as pageCredits from "./page-credits.js";
import * as pageHelp from "./page-help.js";
import * as pagePrivacy from "./page-privacy.js";
import * as pageTerms from "./page-terms.js";
import * as pageProfile from "./page-profile.js";
import * as pageLogin from "./page-login.js";
import * as pageSignup from "./page-signup.js";
import * as pageForgotPassword from "./page-forgot-password.js";
import { initLoginPage, initSignupPage, initForgotPasswordPage } from "./auth.js";

// ── DOM refs for the page shells ────────────────────────────────────────
const pageHome     = document.getElementById("page-home");
const pageCourse   = document.getElementById("page-course");
const pageExam     = document.getElementById("page-exam");
const pageStatic   = document.getElementById("page-static");
const staticMount  = document.getElementById("static-page-content");
const pageProfileEl = document.getElementById("page-profile");
const profileMount = document.getElementById("profile-page-content");
const pageHubEl = document.getElementById("page-hub");
const hubMount = document.getElementById("hub-page-content");

// ── Helpers ───────────────────────────────────────────────────────────────

function showHome() {
  pageHome.classList.remove("hidden");
  pageCourse.classList.add("hidden");
  pageExam.classList.add("hidden");
  pageStatic.classList.add("hidden");
  pageProfileEl.classList.add("hidden");
  pageHubEl.classList.add("hidden");
  document.title = "Tech Verse Course — A New Destination for Learning";
}

function showCourse() {
  pageHome.classList.add("hidden");
  pageCourse.classList.remove("hidden");
  pageExam.classList.add("hidden");
  pageStatic.classList.add("hidden");
  pageProfileEl.classList.add("hidden");
  pageHubEl.classList.add("hidden");
}

function showExam() {
  pageHome.classList.add("hidden");
  pageCourse.classList.add("hidden");
  pageExam.classList.remove("hidden");
  pageStatic.classList.add("hidden");
  pageProfileEl.classList.add("hidden");
  pageHubEl.classList.add("hidden");
  document.title = "Exam — Tech Verse Course";
}

function showStatic() {
  pageHome.classList.add("hidden");
  pageCourse.classList.add("hidden");
  pageExam.classList.add("hidden");
  pageStatic.classList.remove("hidden");
  pageProfileEl.classList.add("hidden");
  pageHubEl.classList.add("hidden");
}

function showProfile() {
  pageHome.classList.add("hidden");
  pageCourse.classList.add("hidden");
  pageExam.classList.add("hidden");
  pageStatic.classList.add("hidden");
  pageProfileEl.classList.remove("hidden");
  pageHubEl.classList.add("hidden");
}

function showHub() {
  pageHome.classList.add("hidden");
  pageCourse.classList.add("hidden");
  pageExam.classList.add("hidden");
  pageStatic.classList.add("hidden");
  pageProfileEl.classList.add("hidden");
  pageHubEl.classList.remove("hidden");
}

// ── Route handlers ────────────────────────────────────────────────────────

let dashboardBooted = false;

async function homeRoute(_params) {
  showHome();
  // Dashboard only needs to boot once; subsequent visits reuse the same DOM.
  if (!dashboardBooted) {
    dashboardBooted = true;
    await initDashboard();
  }
}

let courseCleanup = null;  // function returned by initCoursePage to teardown listeners

async function courseRoute(params) {
  const id = params.get("id");
  if (!id) {
    window.location.hash = "#/home";
    return;
  }
  showCourse();

  // Tear down any previous course session (marquee RAF, event listeners, etc.)
  if (typeof courseCleanup === "function") {
    courseCleanup();
    courseCleanup = null;
  }

  courseCleanup = await initCoursePage(id, params);
}

let examCleanup = null; // function returned by initExamPage to teardown listeners (exam timer)

async function examRoute(params) {
  showExam();

  // Tear down any previous exam session (running countdown timer, etc.)
  // before starting the next one — same reasoning as courseCleanup above.
  if (typeof examCleanup === "function") {
    examCleanup();
    examCleanup = null;
  }

  examCleanup = await initExamPage(params);
}

// Static content routes (about/credits/help/privacy/terms) all share one
// shape: render the page module's markup into the mount point, show the
// shell, set the tab title, and (re)draw the navbar for this route.
function staticRoute(pageModule) {
  return async function (_params) {
    showStatic();
    staticMount.innerHTML = pageModule.render();
    document.title = pageModule.title;
    initNav("");
  };
}

// #/login and #/signup share the exact same shell as the static content
// routes above (nav + footer, single mount point, full re-render on every
// visit). The only difference is that after mounting the markup, the form
// and Google button need to be wired up — that's initFn, exported by
// js/auth.js as initLoginPage()/initSignupPage(). Since the mount point's
// innerHTML is fully replaced on every visit, re-binding on each visit
// never double-binds onto stale elements.
function authRoute(pageModule, initFn) {
  return async function (_params) {
    showStatic();
    staticMount.innerHTML = pageModule.render();
    document.title = pageModule.title;
    initNav("");
    await initFn();
  };
}

let profileBooted = false;

async function profileRoute(params) {
  showProfile();
  document.title = pageProfile.title;
  const tab = params.get("tab");
  // Highlight "My Courses" in the navbar specifically when that's how the
  // user got here, rather than always highlighting the generic Profile link.
  initNav(tab === "courses" ? "mycourses" : "profile");
  // The profile markup is mounted once, and profile.js binds its tab/form/
  // account listeners onto it once — re-mounting on every visit would wipe
  // out those listeners (or double-bind them if we re-ran init() too),
  // exactly like the dashboard's one-time boot in homeRoute above.
  if (!profileBooted) {
    profileBooted = true;
    profileMount.innerHTML = pageProfile.render();
    await initProfilePage();
  }
  // Honors ?tab=xxx on the hash (e.g. the navbar's "My Courses" link goes to
  // #/profile?tab=courses) so it always opens on the right tab, even on a
  // repeat visit where the user had switched to a different tab before.
  if (tab) activateTab(tab);
}

let hubBooted = false;

async function hubRoute(_params) {
  showHub();
  document.title = pageHub.title;
  initNav("hub");
  // Same one-time-mount reasoning as profileRoute above — hub.js's tab
  // click listeners must only ever be bound once.
  if (!hubBooted) {
    hubBooted = true;
    hubMount.innerHTML = pageHub.render();
    await pageHub.initHubPage();
  }
}

// ── Boot ──────────────────────────────────────────────────────────────────

const router = new Router(
  {
    home:    homeRoute,
    course:  courseRoute,
    exam:    examRoute,
    profile: profileRoute,
    hub:     hubRoute,
    about:   staticRoute(pageAbout),
    credits: staticRoute(pageCredits),
    help:    staticRoute(pageHelp),
    privacy: staticRoute(pagePrivacy),
    terms:   staticRoute(pageTerms),
    login:   authRoute(pageLogin, initLoginPage),
    signup:  authRoute(pageSignup, initSignupPage),
    "forgot-password": authRoute(pageForgotPassword, initForgotPasswordPage),
    // Any unknown hash → go home
    "404":   homeRoute,
  },
  document.body   // container (not used for injection here; pages are pre-rendered shells)
);

// If the page loads with no hash, default to #/home
if (!window.location.hash || window.location.hash === "#") {
  window.location.hash = "#/home";
}

// router.start() reads the current hash itself, so this must run exactly
// once — calling it twice was double-registering the hashchange listener,
// which made every navigation fire its route handler twice concurrently.
router.start();
