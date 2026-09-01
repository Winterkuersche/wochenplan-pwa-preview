importScripts("./version.js");

const CACHE_NAME = APP_META.cacheName;

// Nur same-origin Startup-Dateien precachen.
// Externe CDN-Assets (z. B. html2canvas/jsPDF/GSI) bleiben bewusst draußen,
// damit addAll nicht an CORS/offline-Problemen scheitert.
const APP_FILES = [
  "./",
  "./index.html",
  "./manifest.webmanifest",
  "./styles.css",
  "./version.js",
  "./holidays.js",
  "./time-utils.js",
  "./employee-availability.js",
  "./shift-rules.js",
  "./date-utils.js",
  "./shift-utils.js",
  "./status-utils.js",
  "./contract-models.js",
  "./absences.js",
  "./planning2-domain-helpers.js",
  "./planning2-targeted-suggestions.js",
  "./vacation-utils.js",
  "./day-resolution.js",
  "./month-engine.js",
  "./day-view.js",
  "./week-view.js",
  "./mep-view.js",
  "./month-view.js",
  "./balance-utils.js",
  "./monthly-plan-baselines.js",
  "./backup-utils.js",
  "./manual-month-utils.js",
  "./pdf-export.js",
  "./app-orchestration.js",
  "./planning2-playground-state.js",
  "./planning2-playground-workflow.js",
  "./planning2-optimization-history.js",
  "./planning2-playground-acceptance.js",
  "./planning2-playground-ui.js",
  "./app.js"
];

// Optionale Assets (z. B. Manifest-Icons):
// werden versucht, dürfen die SW-Installation aber nicht abbrechen.
const OPTIONAL_APP_FILES = [
  "./icons/icon-192.png",
  "./icons/icon-512.png"
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then(async (cache) => {
      await cache.addAll(APP_FILES);

      const optionalResults = await Promise.allSettled(
        OPTIONAL_APP_FILES.map((file) => cache.add(file))
      );

      optionalResults.forEach((result, index) => {
        if (result.status === "rejected") {
          console.warn("Optionales Precache-Asset nicht verfügbar:", OPTIONAL_APP_FILES[index]);
        }
      });
    })
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(
        keys.map((key) => {
          if (key !== CACHE_NAME) {
            return caches.delete(key);
          }
        })
      )
    ).then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (event) => {
  if (event.request.method !== "GET") return;
  const requestUrl = new URL(event.request.url);
  const isSameOrigin = requestUrl.origin === self.location.origin;
  const isNavigationRequest = event.request.mode === "navigate";
  const isStaticAssetRequest = isSameOrigin && ["script", "style", "image", "font"].includes(event.request.destination);

  event.respondWith(
    fetch(event.request)
      .then((networkResponse) => {
        // Fremde Origins (CDN) bewusst nicht im App-Cache persistieren.
        if (!isSameOrigin) return networkResponse;

        const responseClone = networkResponse.clone();

        caches.open(CACHE_NAME).then((cache) => {
          cache.put(event.request, responseClone);
        });

        return networkResponse;
      })
      .catch(() => {
        if (isNavigationRequest) {
          return caches.match("./index.html", { ignoreSearch: true });
        }

        if (isStaticAssetRequest) {
          return caches.match(event.request, { ignoreSearch: true });
        }

        return caches.match(event.request);
      })
  );
});

self.addEventListener("message", (event) => {
  if (event.data && event.data.type === "SKIP_WAITING") {
    self.skipWaiting();
  }
});
