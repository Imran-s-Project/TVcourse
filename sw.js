const CACHE_NAME = "techversecourse-v23";
const SHELL_FILES = [
  "index.html",
  "admin.html",
  "404.html",
  "css/base.css",
  "css/auth.css",
  "css/dashboard.css",
  "css/course.css",
  "css/exam.css",
  "css/profile.css",
  "css/admin.css",
  "css/error.css",
  "manifest.json",
  "js/app.js",
  "js/router.js",
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
