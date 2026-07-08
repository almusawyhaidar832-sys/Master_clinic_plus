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

function roundMoney(n: number): number {
  return Math.round(n * 100) / 100;
}

function persistPending(): void {
  if (typeof window === "undefined") return;
  try {
    const payload = Object.fromEntries(pendingByClinic.entries());
    if (Object.keys(payload).length === 0) {
      sessionStorage.removeItem(STORAGE_KEY);
      return;
    }
    sessionStorage.setItem(STORAGE_KEY, JSON.stringify(payload));
  } catch {
    /* ignore */
  }
}

function hydratePending(): void {
  if (typeof window === "undefined" || pendingByClinic.size > 0) return;
  try {
    const raw = sessionStorage.getItem(STORAGE_KEY);
    if (!raw) return;
    const parsed = JSON.parse(raw) as Record<string, PendingClinicTopUp>;
    for (const [clinicId, pending] of Object.entries(parsed)) {
      if (pending?.delta > 0) {
        pendingByClinic.set(clinicId, pending);
      }
    }
  } catch {
    sessionStorage.removeItem(STORAGE_KEY);
  }
}

if (typeof window !== "undefined") {
  hydratePending();
}

/** يُسجَّل بعد شحن رصيد العيادة — يُشارَك بين المحاسب والإدارة */
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
    minTopups: prev?.minTopups,
    minNetProfit: prev?.minNetProfit,
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

  let targets = pending;
  if (targets.minTopups == null || targets.minNetProfit == null) {
    targets = {
      ...pending,
      minTopups: roundMoney(stats.balanceTopupsTotal + pending.delta),
      minNetProfit: roundMoney(stats.netProfit + pending.delta),
    };
    pendingByClinic.set(clinicId, targets);
    persistPending();
  }

  const result = reconcilePendingClinicTopUpInProfitStats(stats, {
    minTopups: targets.minTopups!,
    minNetProfit: targets.minNetProfit!,
  });

  if (result.resolved) {
    pendingByClinic.delete(clinicId);
    persistPending();
  } else {
    pendingByClinic.set(clinicId, {
      ...targets,
      minTopups: result.stats.balanceTopupsTotal,
      minNetProfit: result.stats.netProfit,
    });
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
