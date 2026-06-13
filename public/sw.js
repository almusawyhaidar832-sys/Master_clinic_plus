const CACHE_NAME = "mcp-app-v16-stable-alerts";

const NOTIFICATION_ICON = "/icons/icon-192.png";

/** بناء إشعار مخصص — يُستخدم من Push (السيرفر) ومن React (postMessage) */
function buildCustomNotification(title, payload) {
  const data = payload && typeof payload === "object" ? payload : {};
  const url = data.url || "/doctor/queue";
  const tag = data.tag || "mcp-doctor";

  return {
    title: title || "Master Clinic Plus",
    options: {
      body: data.body || "",
      icon: NOTIFICATION_ICON,
      badge: NOTIFICATION_ICON,
      tag,
      renotify: data.renotify !== false,
      requireInteraction: false,
      silent: data.silent !== false,
      vibrate: data.vibrate || [200, 100, 200, 100, 400],
      data: {
        url,
        kind: data.kind || "custom",
        patientName: data.patientName || null,
      },
    },
  };
}

function showCustomNotification(title, payload) {
  const built = buildCustomNotification(title, payload);
  return self.registration.showNotification(built.title, built.options);
}

const PRECACHE_URLS = [
  "/",
  "/manifest.json",
  "/manifest-doctor.json",
  "/icons/icon-192.png",
  "/icons/icon-512.png",
  "/api/sounds/doctor-chime",
];

function shouldSkipCache(url) {
  if (url.pathname.startsWith("/api/")) return true;
  if (url.pathname.startsWith("/_next/")) return true;
  if (url.pathname === "/login" || url.pathname.startsWith("/login/")) return true;
  if (url.pathname.startsWith("/doctor")) return true;
  if (url.pathname.startsWith("/dashboard")) return true;
  if (url.pathname.startsWith("/admin")) return true;
  if (url.pathname.startsWith("/assistant")) return true;
  if (url.pathname.includes(".")) {
    const ext = url.pathname.split(".").pop() ?? "";
    if (["js", "css", "woff", "woff2", "png", "jpg", "svg", "webp", "ico"].includes(ext)) {
      return false;
    }
  }
  return true;
}

function parsePushPayload(event) {
  try {
    return event.data ? event.data.json() : {};
  } catch {
    return {};
  }
}

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(CACHE_NAME)
      .then((cache) => cache.addAll(PRECACHE_URLS))
      .catch(() => undefined)
      .then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k)))
      )
      .then(() => self.clients.claim())
  );
});

self.addEventListener("push", (event) => {
  const data = parsePushPayload(event);
  event.waitUntil(
    showCustomNotification(data.title || "مراجع جديد", {
      body:
        data.body || "لديك مراجع جديد في الانتظار — افتح التطبيق",
      url: data.url || "/doctor/queue",
      tag: data.tag || "doctor-queue",
      kind: data.kind || "doctor_queue",
      patientName: data.patientName,
      silent: true,
    })
  );
});

/** إشعار من React داخل التطبيق — navigator.serviceWorker.controller.postMessage */
self.addEventListener("message", (event) => {
  const data = event.data;
  if (!data || typeof data !== "object") return;
  if (data.type !== "SHOW_APP_NOTIFICATION" || !data.payload) return;

  const payload = data.payload;
  event.waitUntil(
    showCustomNotification(payload.title, {
      body: payload.body,
      url: payload.url,
      tag: payload.tag,
      kind: payload.kind,
      patientName: payload.patientName,
      silent: payload.silent,
      requireInteraction: payload.requireInteraction,
      renotify: payload.renotify,
    })
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const targetUrl = event.notification.data?.url || "/doctor/queue";
  const absoluteUrl = new URL(targetUrl, self.location.origin).href;
  event.waitUntil(
    self.clients
      .matchAll({ type: "window", includeUncontrolled: true })
      .then(async (clientList) => {
        for (const client of clientList) {
          if (!client.url.startsWith(self.location.origin)) continue;

          client.postMessage({ type: "SW_NAVIGATE", url: targetUrl });

          if ("navigate" in client && typeof client.navigate === "function") {
            try {
              await client.navigate(absoluteUrl);
            } catch {
              /* focus only */
            }
          }

          if ("focus" in client) {
            return client.focus();
          }
        }

        if (self.clients.openWindow) {
          return self.clients.openWindow(absoluteUrl);
        }
        return undefined;
      })
  );
});

self.addEventListener("fetch", (event) => {
  if (event.request.method !== "GET") return;

  const url = new URL(event.request.url);
  if (url.origin !== self.location.origin) return;

  if (event.request.mode === "navigate") {
    event.respondWith(
      fetch(event.request).catch(() =>
        caches.match(event.request).then((cached) => cached || caches.match("/"))
      )
    );
    return;
  }

  if (shouldSkipCache(url)) return;

  event.respondWith(
    fetch(event.request)
      .then((response) => {
        if (response.ok && response.type === "basic") {
          const clone = response.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(event.request, clone));
        }
        return response;
      })
      .catch(() => caches.match(event.request))
  );
});
