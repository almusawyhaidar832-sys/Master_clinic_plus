import {
  applyClinicTopUpToProfitStats,
  type ClinicProfitStats,
} from "@/lib/services/clinic-stats";

type PendingClinicTopUp = {
  delta: number;
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
  });
  persistPending();
}

/** دمج شحن معلّق فقط إن لم يعكسه السيرفر بعد — بدون جمع مزدوج */
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

  // السيرفر يعكس الشحن بالفعل — لا نضيفه مرة ثانية
  if (stats.balanceTopupsTotal + 0.01 >= pending.delta) {
    pendingByClinic.delete(clinicId);
    persistPending();
    return stats;
  }

  const topupGap = roundMoney(pending.delta - stats.balanceTopupsTotal);
  if (topupGap > 0.01) {
    pendingByClinic.delete(clinicId);
    persistPending();
    return applyClinicTopUpToProfitStats(stats, topupGap);
  }

  return stats;
}

/** تحديث فوري للواجهة بعد شحن ناجح */
export function applyPendingClinicTopUpToProfitStats(
  stats: ClinicProfitStats,
  amount: number
): ClinicProfitStats {
  return applyClinicTopUpToProfitStats(stats, amount);
}
