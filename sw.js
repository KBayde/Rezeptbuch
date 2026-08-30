// Sehr einfacher Service Worker: cached nur die App-Huelle (HTML/CSS/JS),
// damit die App auch bei wackligem Netz schnell startet. Rezeptdaten selbst
// kommen immer live von Supabase (kein Offline-Datenzugriff in Phase 1).
const CACHE_NAME = "clevulo-shell-v30";
const SHELL_FILES = [
  "./",
  "./index.html",
  "./styles.css",
  "./app.js",
  "./router.js",
  "./db.js",
  "./utils.js",
  "./config.js",
  "./supabaseClient.js",
  "./login.js",
  "./recipeList.js",
  "./recipeForm.js",
  "./recipeDetail.js",
  "./mealPlan.js",
  "./shoppingList.js",
  "./photoImport.js",
  "./youtubeImport.js",
  "./linkImport.js",
  "./inventory.js",
"./inventoryPhotoImport.js",
  "./costs.js",
    "./receiptImport.js",
  "./settings.js",
  "./manifest.json",
  "./logo-mascot.png",
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
                      // laufen immer direkt uebers Netz. API-Routen (z. B. Foto-Erkennung) sind
                      // dynamisch und duerfen nie aus dem Cache beantwortet werden.
                      if (url.origin !== self.location.origin) return;
  if (url.pathname.startsWith("/api/")) return;

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
