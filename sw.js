// Sehr einfacher Service Worker: cached nur die App-Hülle (HTML/CSS/JS),
// damit die App auch bei wackligem Netz schnell startet. Rezeptdaten selbst
// kommen immer live von Supabase (kein Offline-Datenzugriff in Phase 1).
const CACHE_NAME = "rezeptbuch-shell-v1";
const SHELL_FILES = [
  "./",
  "./index.html",
  "./css/styles.css",
  "./js/app.js",
  "./js/router.js",
  "./js/db.js",
  "./js/utils.js",
  "./js/config.js",
  "./js/supabaseClient.js",
  "./js/views/login.js",
  "./js/views/recipeList.js",
  "./js/views/recipeForm.js",
  "./js/views/recipeDetail.js",
  "./manifest.json",
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(SHELL_FILES)).catch(() => {})
  );
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k)))
    )
  );
  self.clients.claim();
});

self.addEventListener("fetch", (event) => {
  const url = new URL(event.request.url);

  // Nur eigene, statische Dateien cachen. Supabase-Aufrufe (andere Domain)
  // laufen immer direkt übers Netz.
  if (url.origin !== self.location.origin) return;

  event.respondWith(
    caches.match(event.request).then((cached) => {
      const network = fetch(event.request)
        .then((response) => {
          if (response.ok) {
            const clone = response.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put(event.request, clone));
          }
          return response;
        })
        .catch(() => cached);
      return cached || network;
    })
  );
});
