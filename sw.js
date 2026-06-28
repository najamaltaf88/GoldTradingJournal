const CACHE_NAME = "gold-journal-v27";
const APP_FILES = [
  "./",
  "./styles.css?v=20260628-supabase-only-v27",
  "./app.js?v=20260628-supabase-only-v27",
  "./manifest.json",
  "./icon.svg",
  "./auth/callback/index.html"
];

const STATIC_EXTENSIONS = [".js", ".css", ".html", ".json", ".svg", ".png", ".jpg", ".jpeg", ".webp", ".ico", ".woff", ".woff2"];

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
  // Ignore external Supabase, Google, or other API calls
  if (url.origin !== self.location.origin) return false;
  return STATIC_EXTENSIONS.some((ext) => url.pathname.endsWith(ext)) || url.pathname === "/";
}

self.addEventListener("fetch", (event) => {
  if (event.request.method !== "GET") return;

  const url = new URL(event.request.url);

  // Supabase requests should go straight to network, do not cache
  if (url.hostname.includes("supabase.co")) {
    return;
  }

  if (event.request.mode === "navigate") {
    // Network-first for navigation, fallback to shell
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
        if (!response || response.status !== 200 || response.type !== "basic") {
          return response;
        }
        const copy = response.clone();
        caches.open(CACHE_NAME).then((cache) => cache.put(event.request, copy));
        return response;
      }).catch(() => caches.match("./"))
    )
  );
});
