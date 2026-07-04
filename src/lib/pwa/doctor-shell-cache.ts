/**
 * يحمّل صفحات الطبيب الأساسية في كاش Service Worker
 * حتى تفتح بدون نت بعد أول زيارة مع اتصال.
 */

/** يجب أن يطابق CACHE_NAME في public/sw.js */
const SERVICE_WORKER_CACHE_NAME = "mcp-app-v21-doctor-push";

export const DOCTOR_OFFLINE_PAGES = [
  "/doctor",
  "/doctor/queue",
  "/doctor/patients",
] as const;

let warmInFlight = false;

export async function warmDoctorShellCache(): Promise<void> {
  if (typeof window === "undefined" || !("caches" in window)) return;
  if (!navigator.onLine || warmInFlight) return;

  warmInFlight = true;
  try {
    const cache = await caches.open(SERVICE_WORKER_CACHE_NAME);
    await Promise.all(
      DOCTOR_OFFLINE_PAGES.map(async (path) => {
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
