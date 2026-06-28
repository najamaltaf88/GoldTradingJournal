const CACHE_NAME = "gold-journal-v25";
const APP_FILES = [
  "./",
  "./styles.css?v=20260628-auth-fix-v25",
  "./app.js?v=20260628-auth-fix-v25",
  "./manifest.json",
  "./icon.svg",
  "./env-config.js",
  "./auth/callback/index.html"
];

const STATIC_EXTENSIONS = [".js", ".css", ".html", ".json", ".svg", ".png", ".jpg", ".jpeg", ".webp", ".ico", ".woff", ".woff2"];

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(CACHE_NAME).then((cache) => cache.addAll(APP_FILES)));
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key)))
    )
  );
  self.clients.claim();
});

function isSameOriginStatic(url) {
  return url.origin === self.location.origin && STATIC_EXTENSIONS.some((ext) => url.pathname.endsWith(ext));
}

self.addEventListener("fetch", (event) => {
  if (event.request.method !== "GET") return;

  const url = new URL(event.request.url);

  if (event.request.mode === "navigate") {
    event.respondWith(
      fetch(event.request).catch(() => caches.match("./"))
    );
    return;
  }

  if (!isSameOriginStatic(url)) {
    event.respondWith(fetch(event.request));
    return;
  }

  event.respondWith(
    caches.match(event.request).then((cached) =>
      cached || fetch(event.request).then((response) => {
        const copy = response.clone();
        caches.open(CACHE_NAME).then((cache) => cache.put(event.request, copy));
        return response;
      }).catch(() => caches.match("./"))
    )
  );
});
