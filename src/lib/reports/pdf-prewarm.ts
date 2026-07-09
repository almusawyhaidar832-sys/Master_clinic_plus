let prewarmed = false;
let prewarmPromise: Promise<void> | null = null;

export function isPdfEnginePrewarmed(): boolean {
  return prewarmed;
}

/** يحمّل html2canvas و jspdf مرة واحدة لتصدير PDF بدون نت لاحقاً */
export function prewarmPdfEngine(): Promise<void> {
  if (typeof window === "undefined") return Promise.resolve();
  if (prewarmed) return Promise.resolve();
  if (prewarmPromise) return prewarmPromise;

  prewarmPromise = Promise.all([import("html2canvas"), import("jspdf")])
    .then(() => {
      prewarmed = true;
    })
    .catch(() => {
      prewarmPromise = null;
    });

  return prewarmPromise;
}
