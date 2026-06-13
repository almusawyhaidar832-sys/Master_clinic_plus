/** Ensure `/sw.js` is registered before Push subscribe (Android + iOS PWA). */

const SW_READY_TIMEOUT_MS = 12_000;

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T | null> {
  return Promise.race([
    promise,
    new Promise<null>((resolve) => window.setTimeout(() => resolve(null), ms)),
  ]);
}

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

    const ready = await withTimeout(
      navigator.serviceWorker.ready.then(() => true),
      SW_READY_TIMEOUT_MS
    );

    if (!ready) {
      console.warn("[PWA] Service worker ready timed out — continuing with registration");
    }

    return registration;
  } catch (error) {
    console.error("[PWA] Service worker registration failed:", error);
    try {
      return (await navigator.serviceWorker.getRegistration("/")) ?? null;
    } catch {
      return null;
    }
  }
}

/** Wait until SW is active — used after permission grant, with timeout. */
export async function waitForServiceWorkerReady(
  timeoutMs = SW_READY_TIMEOUT_MS
): Promise<boolean> {
  if (typeof navigator === "undefined" || !("serviceWorker" in navigator)) {
    return false;
  }

  try {
    await ensureServiceWorkerRegistration();
    const ready = await withTimeout(
      navigator.serviceWorker.ready.then(() => true),
      timeoutMs
    );
    return ready === true;
  } catch {
    return false;
  }
}
