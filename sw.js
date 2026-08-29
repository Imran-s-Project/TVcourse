// ==========================================================================
// Tech Verse Course — Service Worker
// Strategy:
//   • SHELL_FILES  → Cache First (app shell, সবসময় অফলাইনে পাওয়া যাবে)
//   • CDN_FILES    → Cache First (Firebase SDK, Fonts, Font Awesome)
//   • নিজের origin → Network First, fallback cache
//   • Firebase API → bypass (firestore.googleapis.com ইত্যাদি cache হয় না,
//                    Firestore নিজেই IndexedDB-তে ডেটা রাখে)
// ==========================================================================

const CACHE_NAME = "techversecourse-v01.00.19";

/* ── নিজের ফাইল (app shell) ── */
const SHELL_FILES = [
  /* HTML */
  "index.html",
  "admin.html",
  "404.html",

  /* CSS */
  "css/base.css",
  "css/auth.css",
  "css/dashboard.css",
  "css/course.css",
  "css/profile.css",
  "css/admin.css",
  "css/error.css",
  "css/static.css",
  "css/hub.css",

  /* JS core */
  "js/app.js",
  "js/router.js",
  "js/firebase-config.js",
  "js/utils.js",
  "js/theme.js",
  "js/footer.js",

  /* JS pages */
  "js/auth.js",
  "js/dashboard.js",
  "js/course.js",
  "js/profile.js",
  "js/hub.js",
  "js/badges.js",
  "js/discussion.js",
  "js/flashcards.js",
  "js/admin.js",
  "js/error.js",

  /* Exam section — its own dedicated folder (CSS + JS modules) */
  "exam/exam.css",
  "exam/exam.js",
  "exam/exam-data.js",
  "exam/exam-engine.js",
  "exam/exam-guard.js",
  "exam/exam-render.js",
  "exam/exam-timer.js",
  "exam/exam-pdf.js",

  /* JS page renderers */
  "js/page-login.js",
  "js/page-signup.js",
  "js/page-profile.js",
  "js/page-forgot-password.js",
  "js/page-about.js",
  "js/page-help.js",
  "js/page-privacy.js",
  "js/page-terms.js",
  "js/page-credits.js",

  /* Manifest */
  "manifest.json",
];

/* ── বাইরের CDN ফাইল (Firebase SDK + Fonts + Icons) ── */
const CDN_FILES = [
  /* Firebase SDK */
  "https://www.gstatic.com/firebasejs/10.13.0/firebase-app.js",
  "https://www.gstatic.com/firebasejs/10.13.0/firebase-auth.js",
  "https://www.gstatic.com/firebasejs/10.13.0/firebase-firestore.js",
  "https://www.gstatic.com/firebasejs/10.13.0/firebase-storage.js",

  /* Font Awesome */
  "https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.5.2/css/all.min.css",

  /* Google Fonts */
  "https://fonts.googleapis.com/css2?family=Noto+Serif+Bengali:wght@400;600;700&family=Hind+Siliguri:wght@400;500;600;700&family=Noto+Sans+Bengali:wght@400;500;600&display=swap",
];

/* Firebase-এর live API গুলো — কখনো cache করব না */
const BYPASS_ORIGINS = [
  "firestore.googleapis.com",
  "identitytoolkit.googleapis.com",
  "securetoken.googleapis.com",
  "firebase.googleapis.com",
  "firebasestorage.googleapis.com",
];

/* ── Install: shell + CDN আগেই cache করে নাও ── */
self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) =>
      Promise.allSettled([
        cache.addAll(SHELL_FILES),
        cache.addAll(CDN_FILES),
      ])
    )
  );
  self.skipWaiting();
});

/* ── Activate: পুরনো cache মুছে দাও ── */
self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k)))
    )
  );
  self.clients.claim();
});

/* ── Fetch: request অনুযায়ী strategy ── */
self.addEventListener("fetch", (event) => {
  const url = new URL(event.request.url);

  /* Firebase live API → bypass, SW হাত দেবে না */
  if (BYPASS_ORIGINS.some((origin) => url.hostname.includes(origin))) return;

  /* CDN ফাইল → Cache First (একবার cache হলে নেট ছাড়াই চলবে) */
  if (url.origin !== self.location.origin) {
    event.respondWith(
      caches.match(event.request).then((cached) => {
        if (cached) return cached;
        return fetch(event.request).then((res) => {
          const clone = res.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(event.request, clone)).catch(() => {});
          return res;
        });
      })
    );
    return;
  }

  /* নিজের origin → Network First, fallback cache */
  event.respondWith(
    fetch(event.request)
      .then((res) => {
        const clone = res.clone();
        caches.open(CACHE_NAME).then((cache) => cache.put(event.request, clone)).catch(() => {});
        return res;
      })
      .catch(() => caches.match(event.request))
  );
});
