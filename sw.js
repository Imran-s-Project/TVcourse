const CACHE_NAME = "techversecourse-v24";
const SHELL_FILES = [
  /* ── HTML ── */
  "index.html",
  "admin.html",
  "404.html",

  /* ── CSS ── */
  "css/base.css",
  "css/auth.css",
  "css/dashboard.css",
  "css/course.css",
  "css/exam.css",
  "css/profile.css",
  "css/admin.css",
  "css/error.css",
  "css/static.css",

  /* ── JS core ── */
  "js/app.js",
  "js/router.js",
  "js/firebase-config.js",
  "js/utils.js",
  "js/theme.js",
  "js/footer.js",

  /* ── JS pages ── */
  "js/auth.js",
  "js/dashboard.js",
  "js/course.js",
  "js/exam.js",
  "js/profile.js",
  "js/admin.js",
  "js/error.js",

  /* ── JS page renderers ── */
  "js/page-login.js",
  "js/page-signup.js",
  "js/page-profile.js",
  "js/page-forgot-password.js",
  "js/page-about.js",
  "js/page-help.js",
  "js/page-privacy.js",
  "js/page-terms.js",
  "js/page-credits.js",

  /* ── Manifest ── */
  "manifest.json",
];

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(CACHE_NAME).then((cache) => cache.addAll(SHELL_FILES)).catch(() => {}));
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k))))
  );
  self.clients.claim();
});

/* নেটওয়ার্ক-ফার্স্ট, ফলব্যাক ক্যাশ — Firebase/API কল ক্যাশ করা হয় না */
self.addEventListener("fetch", (event) => {
  const url = new URL(event.request.url);
  if (url.origin !== self.location.origin) return;
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
