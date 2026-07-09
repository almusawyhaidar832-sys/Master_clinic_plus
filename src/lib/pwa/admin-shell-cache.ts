import { SERVICE_WORKER_CACHE_NAME } from "@/lib/pwa/cache-name";

export const ADMIN_OFFLINE_PAGES = [
  "/admin",
  "/admin/daily-collections",
  "/admin/doctors",
] as const;

let warmInFlight = false;

export async function warmAdminShellCache(): Promise<void> {
  if (typeof window === "undefined" || !("caches" in window)) return;
  if (!navigator.onLine || warmInFlight) return;

  warmInFlight = true;
  try {
    const cache = await caches.open(SERVICE_WORKER_CACHE_NAME);
    await Promise.all(
      ADMIN_OFFLINE_PAGES.map(async (path) => {
        const existing = await cache.match(path);
        if (existing) return;
        try {
          const response = await fetch(path, { credentials: "same-origin" });
          if (response.ok && response.type === "basic") {
            await cache.put(path, response.clone());
          }
        } catch {
          /* offline أو تعذر التحميل */
        }
      })
    );
  } finally {
    warmInFlight = false;
  }
}
