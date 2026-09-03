// Network-first service worker for the app shell: always try the network so
// dev iteration gets fresh files, fall back to cache when offline so a reload
// in airplane mode still works. Model weights are cached separately by
// transformers.js (Cache API).
const CACHE = "lumine-v1";
const SHELL = ["./", "./index.html", "./app.js", "./pipeline.js", "./embed.js", "./fixture.js"];

self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (e) => {
  const url = new URL(e.request.url);
  if (url.origin !== location.origin) return; // CDN / model fetches pass straight through
  e.respondWith(
    fetch(e.request)
      .then((res) => {
        const copy = res.clone();
        caches.open(CACHE).then((c) => c.put(e.request, copy));
        return res;
      })
      .catch(() => caches.match(e.request).then((hit) => hit || caches.match("./index.html")))
  );
});
