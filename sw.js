const CACHE_NAME = "gold-journal-v28";
const APP_VERSION = "20260629-supabase-v28";
const APP_FILES = [
  "./",
  `./index.html`,
  `./styles.css?v=${APP_VERSION}`,
  `./app.js?v=${APP_VERSION}`,
  `./env-config.js`,
  `./manifest.json`,
  `./icon.svg`,
  "./auth/callback/index.html"
];

const STATIC_EXTENSIONS = [".js", ".css", ".html", ".json", ".svg", ".png", ".jpg", ".jpeg", ".webp", ".ico", ".woff", ".woff2"];

const NETWORK_ONLY_HOSTS = ["supabase.co", "openrouter.ai"];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then((cache) => cache.addAll(APP_FILES))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(
        keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key))
      )
    ).then(() => self.clients.claim())
  );
});

function isSameOriginStatic(url) {
  if (url.origin !== self.location.origin) return false;
  return STATIC_EXTENSIONS.some((ext) => url.pathname.endsWith(ext)) || url.pathname === "/";
}

function isNetworkOnly(url) {
  return NETWORK_ONLY_HOSTS.some((host) => url.hostname.includes(host));
}

self.addEventListener("fetch", (event) => {
  if (event.request.method !== "GET") return;

  const url = new URL(event.request.url);

  if (isNetworkOnly(url)) {
    return;
  }

  if (event.request.mode === "navigate") {
    event.respondWith(
      fetch(event.request).catch(() => caches.match("./index.html").then((cached) => cached || caches.match("./")))
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
        if (!response || response.status !== 200 || response.type !== "basic") {
          return response;
        }
        const copy = response.clone();
        caches.open(CACHE_NAME).then((cache) => cache.put(event.request, copy));
        return response;
      }).catch(() => caches.match("./index.html").then((cached) => cached || caches.match("./")))
    )
  );
});
