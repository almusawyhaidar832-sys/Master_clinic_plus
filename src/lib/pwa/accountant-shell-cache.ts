/**
 * يحمّل صفحات المحاسب الأساسية في كاش Service Worker (نفس اسم الكاش في sw.js)
 * حتى تفتح بدون نت بعد أول زيارة مع اتصال — دون تعديل sw.js.
 */

/** يجب أن يطابق CACHE_NAME في public/sw.js */
const SERVICE_WORKER_CACHE_NAME = "mcp-app-v19-exam-autosave";

export const ACCOUNTANT_OFFLINE_PAGES = [
  "/dashboard",
  "/dashboard/ledger",
  "/dashboard/patients",
  "/dashboard/queue",
] as const;

let warmInFlight = false;

export async function warmAccountantShellCache(): Promise<void> {
  if (typeof window === "undefined" || !("caches" in window)) return;
  if (!navigator.onLine || warmInFlight) return;

  warmInFlight = true;
  try {
    const cache = await caches.open(SERVICE_WORKER_CACHE_NAME);
    await Promise.all(
      ACCOUNTANT_OFFLINE_PAGES.map(async (path) => {
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
