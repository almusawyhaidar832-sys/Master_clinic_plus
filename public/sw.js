const CACHE_NAME = "mcp-app-v4-push-alerts";
const SHELL_URLS = ["/login", "/doctor", "/admin"];

function shouldSkipCache(url) {
  if (url.pathname.startsWith("/api/")) return true;
  if (url.pathname.startsWith("/_next/")) return true;
  if (url.pathname.includes(".")) {
    const ext = url.pathname.split(".").pop() ?? "";
    if (["js", "css", "woff", "woff2", "png", "jpg", "svg", "webp"].includes(ext)) {
      return false;
    }
  }
  return false;
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
    caches.open(CACHE_NAME).then((cache) => cache.addAll(SHELL_URLS))
  );
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(
        keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k))
      )
    )
  );
  self.clients.claim();
});

self.addEventListener("push", (event) => {
  const data = parsePushPayload(event);
  const title = data.title || "مراجع جديد 🔔";
  const body =
    data.body || "لديك مراجع جديد في الانتظار — افتح التطبيق";
  const url = data.url || "/doctor/queue";
  const tag = data.tag || "doctor-queue";

  const options = {
    body,
    icon: "/favicon.ico",
    badge: "/favicon.ico",
    tag,
    renotify: true,
    requireInteraction: true,
    vibrate: [180, 80, 180, 80, 320],
    data: { url, patientName: data.patientName, kind: data.kind },
  };

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

  event.waitUntil(
    self.clients
      .matchAll({ type: "window", includeUncontrolled: true })
      .then((clientList) => {
        for (const client of clientList) {
          if (client.url.startsWith(self.location.origin) && "focus" in client) {
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
      .catch(() =>
        caches.match(event.request).then((cached) => cached ?? caches.match("/login"))
      )
  );
});
