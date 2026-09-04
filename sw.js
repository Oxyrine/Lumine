// Network-first service worker for the app shell: always try the network so
// dev iteration gets fresh files, fall back to cache when offline so a reload
// in airplane mode still works. Model weights are cached separately by
// transformers.js (Cache API).
// Fonts are listed here deliberately: they are same-origin, so precaching them
// is what makes the offline story hold. A CDN-hosted font would be cross-origin
// and skipped by the fetch handler below.
// addAll is atomic — one bad path fails the install and the worker never
// activates, so every entry must resolve.
const CACHE = "lumine-v2";
const SHELL = [
  "./", "./index.html", "./styles.css",
  "./app.js", "./pipeline.js", "./embed.js", "./fixture.js", "./graph.js",
  "./fonts/SchibstedGrotesk-Variable.woff2",
  "./fonts/IBMPlexMono-Regular.woff2",
  "./fonts/IBMPlexMono-Medium.woff2",
];

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
