/* Minimal offline app-shell cache for the Device Finder PWA. */
const CACHE = "device-finder-v1";
const SHELL = [
  "./",
  "./index.html",
  "./app.js",
  "./geo.js",
  "./style.css",
  "./manifest.webmanifest",
  "./icon.svg",
];

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (event) => {
  const { request } = event;
  if (request.method !== "GET") return;
  const url = new URL(request.url);

  // Never cache the live location/building/elevation APIs.
  if (
    url.hostname.includes("open-meteo.com") ||
    url.hostname.includes("overpass-api.de")
  ) {
    return;
  }

  // Cache-first for the app shell and CDN modules; fall back to network.
  event.respondWith(
    caches.match(request).then((cached) => {
      if (cached) return cached;
      return fetch(request)
        .then((res) => {
          if (res.ok && (url.origin === self.location.origin || url.hostname.includes("unpkg.com"))) {
            const copy = res.clone();
            caches.open(CACHE).then((c) => c.put(request, copy));
          }
          return res;
        })
        .catch(() => cached);
    })
  );
});
