import {
  applyClinicTopUpToProfitStats,
  reconcilePendingClinicTopUpInProfitStats,
  type ClinicProfitStats,
  type PendingClinicTopUpProfit,
} from "@/lib/services/clinic-stats";

type PendingClinicTopUp = PendingClinicTopUpProfit & {
  transactionDate: string;
};

const pendingByClinic = new Map<string, PendingClinicTopUp>();
const STORAGE_KEY = "mc-pending-clinic-topup";
const STORAGE_EVENT = "mc-pending-clinic-topup-changed";

function roundMoney(n: number): number {
  return Math.round(n * 100) / 100;
}

function persistPending(): void {
  if (typeof window === "undefined") return;
  try {
    const payload = Object.fromEntries(pendingByClinic.entries());
    if (Object.keys(payload).length === 0) {
      localStorage.removeItem(STORAGE_KEY);
      return;
    }
    localStorage.setItem(STORAGE_KEY, JSON.stringify(payload));
    window.dispatchEvent(new CustomEvent(STORAGE_EVENT));
  } catch {
    /* ignore */
  }
}

function normalizeStoredPending(
  raw: Partial<PendingClinicTopUp> & { amount?: number; delta?: number }
): PendingClinicTopUp | null {
  const transactionDate = raw.transactionDate?.slice(0, 10) ?? "";
  if (!transactionDate) return null;

  const minTopups = roundMoney(Number(raw.minTopups ?? 0));
  const minNetProfit = roundMoney(Number(raw.minNetProfit ?? 0));
  if (minTopups > 0 && minNetProfit > 0) {
    return { minTopups, minNetProfit, transactionDate };
  }

  const legacyDelta = roundMoney(
    Number(raw.amount ?? raw.delta ?? raw.minTopups ?? 0)
  );
  if (legacyDelta <= 0) return null;

  return {
    minTopups: legacyDelta,
    minNetProfit: 0,
    transactionDate,
  };
}

function hydratePending(): void {
  if (typeof window === "undefined") return;
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return;
    const parsed = JSON.parse(raw) as Record<
      string,
      Partial<PendingClinicTopUp> & { amount?: number; delta?: number }
    >;
    for (const [clinicId, pending] of Object.entries(parsed)) {
      const normalized = normalizeStoredPending(pending ?? {});
      if (normalized) pendingByClinic.set(clinicId, normalized);
    }
  } catch {
    localStorage.removeItem(STORAGE_KEY);
  }
}

if (typeof window !== "undefined") {
  hydratePending();
}

/** اشتراك لتحديث لوحة الإدارة عند الشحن من تبويب المحاسب */
export function subscribePendingClinicTopUpChanges(
  handler: () => void
): () => void {
  if (typeof window === "undefined") return () => {};

  const onCustom = () => handler();
  const onStorage = (event: StorageEvent) => {
    if (event.key === STORAGE_KEY) handler();
  };

  window.addEventListener(STORAGE_EVENT, onCustom);
  window.addEventListener("storage", onStorage);
  return () => {
    window.removeEventListener(STORAGE_EVENT, onCustom);
    window.removeEventListener("storage", onStorage);
  };
}

export function clearPendingClinicTopUp(clinicId: string): void {
  if (!clinicId) return;
  hydratePending();
  if (!pendingByClinic.has(clinicId)) return;
  pendingByClinic.delete(clinicId);
  persistPending();
}

/** يمسح كل الشحنات المعلّقة (بعد حذف الشحنات من السيرفر) */
export function clearAllPendingClinicTopUps(): void {
  if (typeof window === "undefined") return;
  pendingByClinic.clear();
  try {
    localStorage.removeItem(STORAGE_KEY);
    window.dispatchEvent(new CustomEvent(STORAGE_EVENT));
  } catch {
    /* ignore */
  }
}

/**
 * يُسجَّل بعد شحن ناجح — آخر شحن فقط (لا يُجمع المحاولات).
 * minNetProfit = صافي الربح المتوقع بعد هذا الشحن (مثلاً 1,156,500).
 */
export function registerPendingClinicTopUp(
  clinicId: string,
  delta: number,
  transactionDate: string,
  baseline?: Pick<ClinicProfitStats, "netProfit" | "balanceTopupsTotal">
): void {
  if (!clinicId || delta <= 0) return;
  hydratePending();

  const roundedDelta = roundMoney(delta);
  const serverTopups = roundMoney(baseline?.balanceTopupsTotal ?? 0);
  const serverNet = roundMoney(baseline?.netProfit ?? 0);

  pendingByClinic.set(clinicId, {
    minTopups: baseline
      ? roundMoney(serverTopups + roundedDelta)
      : roundedDelta,
    minNetProfit: baseline ? roundMoney(serverNet + roundedDelta) : 0,
    transactionDate: transactionDate.slice(0, 10),
  });
  persistPending();
}

/** يدمج شحناً معلّقاً حتى يعكسه السيرفر في الصافي والشحن معاً */
export function applyOptimisticClinicTopUp(
  clinicId: string,
  stats: ClinicProfitStats,
  period: { from: string; to: string }
): ClinicProfitStats {
  hydratePending();
  const pending = pendingByClinic.get(clinicId);
  if (!pending) return stats;

  if (
    pending.transactionDate < period.from ||
    pending.transactionDate > period.to
  ) {
    return stats;
  }

  const target: PendingClinicTopUpProfit = {
    minTopups: pending.minTopups,
    minNetProfit:
      pending.minNetProfit > 0
        ? pending.minNetProfit
        : roundMoney(
            stats.netProfit +
              Math.max(0, pending.minTopups - stats.balanceTopupsTotal)
          ),
  };

  const { stats: merged, resolved } = reconcilePendingClinicTopUpInProfitStats(
    stats,
    target
  );

  if (resolved) {
    clearPendingClinicTopUp(clinicId);
  }

  return merged;
}

/** @deprecated استخدم applyOptimisticClinicTopUp */
export function reconcilePendingClinicProfitStats(
  clinicId: string,
  stats: ClinicProfitStats,
  period: { from: string; to: string }
): ClinicProfitStats {
  return applyOptimisticClinicTopUp(clinicId, stats, period);
}

export function applyPendingClinicTopUpToProfitStats(
  stats: ClinicProfitStats,
  amount: number
): ClinicProfitStats {
  return applyClinicTopUpToProfitStats(stats, amount);
}
