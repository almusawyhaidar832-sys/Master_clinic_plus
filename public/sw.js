const CACHE_NAME = "mcp-app-v13-background-push";

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

function notifyOpenClients(payload) {
  return self.clients
    .matchAll({ type: "window", includeUncontrolled: true })
    .then((clientList) => {
      clientList.forEach((client) => {
        client.postMessage({ type: "QUEUE_PUSH_ALERT", payload });
      });
    });
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
  const title = data.title || "مراجع جديد 🔔";
  const body =
    data.body || "لديك مراجع جديد في الانتظار — افتح التطبيق";
  const url = data.url || "/doctor/queue";
  const tag = data.tag || "doctor-queue";
  const audioUrl = data.audioUrl || null;
  const chimeUrl = new URL("/api/sounds/doctor-chime", self.location.origin).href;

  const options = {
    body,
    icon: "/icons/icon-192.png",
    badge: "/icons/icon-192.png",
    tag,
    renotify: true,
    requireInteraction: true,
    silent: false,
    vibrate: [200, 100, 200, 100, 400],
    data: { url, patientName: data.patientName, kind: data.kind, audioUrl },
  };

  try {
    options.sound = audioUrl
      ? new URL(audioUrl, self.location.origin).href
      : chimeUrl;
  } catch {
    options.sound = chimeUrl;
  }

  event.waitUntil(
    Promise.all([
      self.registration.showNotification(title, options),
      notifyOpenClients(data),
    ])
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const targetUrl = event.notification.data?.url || "/doctor/queue";
  const absoluteUrl = new URL(targetUrl, self.location.origin).href;
  const alertPayload = {
    url: targetUrl,
    kind: event.notification.data?.kind,
    patientName: event.notification.data?.patientName,
    audioUrl: event.notification.data?.audioUrl,
  };

  event.waitUntil(
    self.clients
      .matchAll({ type: "window", includeUncontrolled: true })
      .then(async (clientList) => {
        for (const client of clientList) {
          if (!client.url.startsWith(self.location.origin)) continue;

          client.postMessage({ type: "SW_NAVIGATE", url: targetUrl });
          client.postMessage({ type: "QUEUE_PUSH_ALERT", payload: alertPayload });

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
