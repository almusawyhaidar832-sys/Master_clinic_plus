import {
  applyClinicTopUpToProfitStats,
  type ClinicProfitStats,
} from "@/lib/services/clinic-stats";

const NET_PROFIT_LABEL = "صافي ربح العيادة";
const BROADCAST_KEY = "mc-clinic-profit-broadcast";
const BROADCAST_EVENT = "mc-clinic-profit-broadcast-changed";

export type ClinicProfitBroadcast = {
  clinicId: string;
  periodFrom: string;
  periodTo: string;
  netProfit: number;
  balanceTopupsTotal: number;
  updatedAt: string;
  /** بعد حذف الشحنات — لا ترفع الربح من الذاكرة */
  reset?: boolean;
};

function roundMoney(n: number): number {
  return Math.round(n * 100) / 100;
}

function readBroadcast(): ClinicProfitBroadcast | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = localStorage.getItem(BROADCAST_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as ClinicProfitBroadcast;
    if (!parsed?.clinicId || !parsed.periodFrom || !parsed.periodTo) return null;
    return parsed;
  } catch {
    localStorage.removeItem(BROADCAST_KEY);
    return null;
  }
}

/** يُبث بين التبويبات (محاسب ↔ إدارة) — يعمل عبر localStorage */
export function publishClinicProfitBroadcast(
  snap: Omit<ClinicProfitBroadcast, "updatedAt" | "reset"> & { reset?: boolean }
): void {
  if (typeof window === "undefined") return;
  try {
    const payload: ClinicProfitBroadcast = {
      clinicId: snap.clinicId,
      periodFrom: snap.periodFrom,
      periodTo: snap.periodTo,
      netProfit: roundMoney(snap.netProfit),
      balanceTopupsTotal: roundMoney(snap.balanceTopupsTotal),
      updatedAt: new Date().toISOString(),
      reset: snap.reset === true,
    };
    localStorage.setItem(BROADCAST_KEY, JSON.stringify(payload));
    window.dispatchEvent(new CustomEvent(BROADCAST_EVENT));
  } catch {
    /* ignore */
  }
}

/** بعد حذف الشحنات — يُصفّر الذاكرة عند كل التبويبات */
export function publishClinicProfitReset(
  snap: Omit<ClinicProfitBroadcast, "updatedAt" | "reset">
): void {
  publishClinicProfitBroadcast({ ...snap, reset: true });
}

export function clearClinicProfitBroadcast(): void {
  if (typeof window === "undefined") return;
  try {
    localStorage.removeItem(BROADCAST_KEY);
    window.dispatchEvent(new CustomEvent(BROADCAST_EVENT));
  } catch {
    /* ignore */
  }
}

export function subscribeClinicProfitBroadcast(handler: () => void): () => void {
  if (typeof window === "undefined") return () => {};

  const onCustom = () => handler();
  const onStorage = (event: StorageEvent) => {
    if (event.key === BROADCAST_KEY) handler();
  };

  window.addEventListener(BROADCAST_EVENT, onCustom);
  window.addEventListener("storage", onStorage);
  return () => {
    window.removeEventListener(BROADCAST_EVENT, onCustom);
    window.removeEventListener("storage", onStorage);
  };
}

/** يدمج آخر ربح مُعلَن إن كان السيرفر متأخراً */
export function applyClinicProfitBroadcast(
  clinicId: string,
  period: { from: string; to: string },
  stats: ClinicProfitStats
): ClinicProfitStats {
  const snap = readBroadcast();
  if (!snap || snap.clinicId !== clinicId) return stats;
  if (snap.periodFrom !== period.from || snap.periodTo !== period.to) return stats;

  if (snap.reset) {
    clearClinicProfitBroadcast();
    return stats;
  }

  const serverNet = roundMoney(stats.netProfit);
  const serverTopups = roundMoney(stats.balanceTopupsTotal);
  const targetNet = roundMoney(snap.netProfit);
  const targetTopups = roundMoney(snap.balanceTopupsTotal);

  if (
    serverNet + 0.01 >= targetNet &&
    serverTopups + 0.01 >= targetTopups
  ) {
    clearClinicProfitBroadcast();
    return stats;
  }

  let next = stats;
  const topupGap = roundMoney(targetTopups - serverTopups);
  if (topupGap > 0.01) {
    next = applyClinicTopUpToProfitStats(next, topupGap);
  }

  if (targetNet > next.netProfit + 0.01) {
    next = {
      ...next,
      netProfit: targetNet,
      breakdown: next.breakdown.map((row) =>
        row.label === NET_PROFIT_LABEL ? { ...row, amount: targetNet } : row
      ),
    };
  }

  return next;
}

/** بعد شحن ناجح — من baseline قبل الشحن */
export function buildExpectedProfitAfterTopUp(
  baseline: ClinicProfitStats | null,
  toppedAmount: number
): Pick<ClinicProfitStats, "netProfit" | "balanceTopupsTotal"> {
  const base =
    baseline ??
    ({
      netProfit: 0,
      balanceTopupsTotal: 0,
      cashInflow: 0,
      outstandingDebts: 0,
      totalRefunds: 0,
      clinicShareTotal: 0,
      doctorShareTotal: 0,
      reviewFeesTotal: 0,
      totalExpenses: 0,
      totalSalariesPaid: 0,
      breakdown: [],
    } satisfies ClinicProfitStats);

  const merged = applyClinicTopUpToProfitStats(base, toppedAmount);
  return {
    netProfit: merged.netProfit,
    balanceTopupsTotal: merged.balanceTopupsTotal,
  };
}
