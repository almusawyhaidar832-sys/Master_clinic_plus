/** Ensure `/sw.js` is registered before Push subscribe (Android + iOS PWA). */

export async function ensureServiceWorkerRegistration(): Promise<ServiceWorkerRegistration | null> {
  if (typeof navigator === "undefined" || !("serviceWorker" in navigator)) {
    return null;
  }

  try {
    let registration = await navigator.serviceWorker.getRegistration("/");
    if (!registration) {
      registration = await navigator.serviceWorker.register("/sw.js", {
        scope: "/",
      });
    }
    return await navigator.serviceWorker.ready;
  } catch {
    return null;
  }
}
