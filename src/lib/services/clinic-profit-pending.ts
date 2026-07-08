import {
  applyClinicTopUpToProfitStats,
  reconcilePendingClinicTopUpInProfitStats,
  type ClinicProfitStats,
} from "@/lib/services/clinic-stats";

type PendingClinicTopUp = {
  delta: number;
  transactionDate: string;
  minTopups?: number;
  minNetProfit?: number;
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

function hydratePending(): void {
  if (typeof window === "undefined") return;
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return;
    const parsed = JSON.parse(raw) as Record<string, PendingClinicTopUp>;
    for (const [clinicId, pending] of Object.entries(parsed)) {
      if (pending?.delta > 0) {
        pendingByClinic.set(clinicId, pending);
      }
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

/** يُسجَّل بعد شحن رصيد العيادة — يُشارَك بين المحاسب والإدارة (كل التبويبات) */
export function registerPendingClinicTopUp(
  clinicId: string,
  amount: number,
  transactionDate: string
): void {
  if (!clinicId || amount <= 0) return;
  hydratePending();

  const prev = pendingByClinic.get(clinicId);
  pendingByClinic.set(clinicId, {
    delta: roundMoney((prev?.delta ?? 0) + amount),
    transactionDate: transactionDate.slice(0, 10),
    minTopups: undefined,
    minNetProfit: undefined,
  });
  persistPending();
}

/** دمج شحن معلّق — يُستخدم في المحاسب والإدارة */
export function reconcilePendingClinicProfitStats(
  clinicId: string,
  stats: ClinicProfitStats,
  period: { from: string; to: string }
): ClinicProfitStats {
  hydratePending();

  const pending = pendingByClinic.get(clinicId);
  if (!pending || pending.delta <= 0) return stats;

  if (
    pending.transactionDate < period.from ||
    pending.transactionDate > period.to
  ) {
    return stats;
  }

  const expectedTopups = roundMoney(stats.balanceTopupsTotal + pending.delta);
  const expectedNet = roundMoney(stats.netProfit + pending.delta);

  if (
    stats.balanceTopupsTotal + 0.01 >= expectedTopups &&
    stats.netProfit + 0.01 >= expectedNet
  ) {
    pendingByClinic.delete(clinicId);
    persistPending();
    return stats;
  }

  const result = reconcilePendingClinicTopUpInProfitStats(stats, {
    minTopups: expectedTopups,
    minNetProfit: expectedNet,
  });

  if (result.resolved) {
    pendingByClinic.delete(clinicId);
    persistPending();
  }

  return result.stats;
}

/** تحديث فوري للواجهة بعد شحن ناجح */
export function applyPendingClinicTopUpToProfitStats(
  stats: ClinicProfitStats,
  amount: number
): ClinicProfitStats {
  return applyClinicTopUpToProfitStats(stats, amount);
}
