const CACHE_NAME = "mcp-app-v18-assistant-portal";

const NOTIFICATION_ICON = "/icons/icon-192.png";

/** App shell — يُخزَّن عند install */
const APP_SHELL_URLS = [
  "/",
  "/doctor",
  "/doctor/queue",
  "/assistant",
  "/assistant/dashboard",
  "/assistant/queue",
  "/login",
  "/manifest.json",
  "/manifest-doctor.json",
  "/manifest-assistant.json",
  "/icons/icon-192.png",
  "/icons/icon-512.png",
];

const STATIC_EXTENSIONS = new Set([
  "js",
  "css",
  "woff",
  "woff2",
  "png",
  "jpg",
  "jpeg",
  "svg",
  "webp",
  "ico",
  "gif",
]);

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

function isApiRequest(url) {
  return url.pathname.startsWith("/api/");
}

function isStaticAsset(url) {
  if (url.pathname.startsWith("/_next/static/")) return true;
  if (url.pathname.startsWith("/icons/")) return true;
  const parts = url.pathname.split(".");
  if (parts.length < 2) return false;
  const ext = parts.pop()?.toLowerCase() ?? "";
  return STATIC_EXTENSIONS.has(ext);
}

function isNavigationRequest(request) {
  return request.mode === "navigate";
}

function navigationFallback(url) {
  if (url.pathname.startsWith("/doctor")) return "/doctor";
  if (url.pathname.startsWith("/dashboard")) return "/dashboard";
  if (url.pathname.startsWith("/assistant")) return "/assistant";
  if (url.pathname.startsWith("/admin")) return "/admin";
  return "/";
}

async function putInCache(request, response) {
  if (!response || !response.ok || response.type !== "basic") return;
  const cache = await caches.open(CACHE_NAME);
  await cache.put(request, response.clone());
}

/** Cache-First: الكاش أولاً، ثم الشبكة، مع تحديث بالخلفية إن وُجد كاش */
async function cacheFirst(request, options) {
  const cache = await caches.open(CACHE_NAME);
  const cached = await cache.match(request);

  const networkPromise = fetch(request)
    .then(async (response) => {
      await putInCache(request, response);
      return response;
    })
    .catch(() => null);

  if (cached) {
    void networkPromise;
    return cached;
  }

  const networkResponse = await networkPromise;
  if (networkResponse) return networkResponse;

  const fallbackUrl = options?.fallbackUrl;
  if (fallbackUrl) {
    const fallback = await cache.match(fallbackUrl);
    if (fallback) return fallback;
  }

  const root = await cache.match("/");
  if (root) return root;

  return Response.error();
}

async function precacheAppShell() {
  const cache = await caches.open(CACHE_NAME);
  await Promise.all(
    APP_SHELL_URLS.map(async (url) => {
      try {
        const response = await fetch(url, { credentials: "same-origin" });
        if (response.ok) {
          await cache.put(url, response);
        }
      } catch {
        /* offline during install — skip */
      }
    })
  );
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
    precacheAppShell()
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

  if (isApiRequest(url)) return;

  if (isNavigationRequest(event.request)) {
    event.respondWith(
      cacheFirst(event.request, { fallbackUrl: navigationFallback(url) })
    );
    return;
  }

  if (isStaticAsset(url)) {
    event.respondWith(cacheFirst(event.request));
    return;
  }

  event.respondWith(cacheFirst(event.request, { fallbackUrl: "/" }));
});
