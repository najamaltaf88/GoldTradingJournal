const CACHE_NAME = "gold-journal-v30";
const APP_VERSION = "20260630-supabase-v30";

// Never cache runtime config or app code — always fetch fresh from network.
const NETWORK_ONLY_PATHS = [
  "/env-config.js",
  "/app.js",
  "/sw.js"
];

const SHELL_FILES = [
  "./",
  "./index.html",
  `./styles.css?v=${APP_VERSION}`,
  "./manifest.json",
  "./icon.svg"
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then((cache) => cache.addAll(SHELL_FILES))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key))))
      .then(() => self.clients.claim())
  );
});

function isNetworkOnlyRequest(url) {
  if (url.origin !== self.location.origin) return false;
  const path = url.pathname;
  return NETWORK_ONLY_PATHS.some((entry) => path.endsWith(entry.replace(/^\//, "")) || path === entry);
}

self.addEventListener("fetch", (event) => {
  if (event.request.method !== "GET") return;

  const url = new URL(event.request.url);

  // Supabase API, auth, storage, and third-party scripts: browser handles directly.
  if (url.origin !== self.location.origin) return;

  if (isNetworkOnlyRequest(url)) {
    event.respondWith(fetch(event.request));
    return;
  }

  if (event.request.mode === "navigate") {
    event.respondWith(
      fetch(event.request)
        .then((response) => {
          if (response && response.ok) return response;
          return caches.match("./index.html");
        })
        .catch(() => caches.match("./index.html"))
    );
    return;
  }

  event.respondWith(
    fetch(event.request)
      .then((response) => {
        if (response && response.ok && response.type === "basic") {
          const copy = response.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(event.request, copy));
        }
        return response;
      })
      .catch(() => caches.match(event.request).then((cached) => cached || caches.match("./index.html")))
  );
});
