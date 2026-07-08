import type { DailyCollectionsResult } from "@/lib/ledger/daily-collections";
import type { DoctorWalletSnapshot } from "@/lib/services/balance-topup";
import {
  applyDoctorTopUpToWalletStats,
  type DoctorWalletStats,
} from "@/lib/services/doctor-wallet";

type PendingDoctorWallet = {
  minAvailableBalance: number;
  minWithdrawableLimit: number;
};

const pendingByDoctor = new Map<string, PendingDoctorWallet>();

/** يُسجَّل بعد شحن ناجح — يمنع رجوع الرصيد لقيمة قديمة */
export function registerPendingDoctorWallet(
  doctorId: string,
  wallet: DoctorWalletSnapshot
): void {
  pendingByDoctor.set(doctorId, {
    minAvailableBalance: wallet.availableBalance,
    minWithdrawableLimit: wallet.withdrawableLimit,
  });
}

export function registerPendingDoctorTopUpDelta(
  doctorId: string,
  amount: number,
  current?: DoctorWalletSnapshot
): void {
  const prev = pendingByDoctor.get(doctorId);
  const baseBalance =
    prev?.minAvailableBalance ?? current?.availableBalance ?? 0;
  const baseWithdrawable =
    prev?.minWithdrawableLimit ?? current?.withdrawableLimit ?? 0;
  pendingByDoctor.set(doctorId, {
    minAvailableBalance: roundMoney(baseBalance + amount),
    minWithdrawableLimit: roundMoney(baseWithdrawable + amount),
  });
}

export function reconcilePendingDoctorWallet(
  doctorId: string,
  stats: DoctorWalletStats
): DoctorWalletStats {
  const pending = pendingByDoctor.get(doctorId);
  if (!pending) return stats;

  const balanceOk =
    stats.availableBalance + 0.01 >= pending.minAvailableBalance;
  const limitOk =
    stats.withdrawableLimit + 0.01 >= pending.minWithdrawableLimit;

  if (balanceOk && limitOk) {
    pendingByDoctor.delete(doctorId);
    return stats;
  }

  let next = stats;
  if (!balanceOk) {
    next = applyDoctorTopUpToWalletStats(
      next,
      pending.minAvailableBalance - stats.availableBalance
    );
  }
  if (!limitOk) {
    next = {
      ...next,
      withdrawableLimit: roundMoney(
        Math.max(next.withdrawableLimit, pending.minWithdrawableLimit)
      ),
    };
  }
  return next;
}

export function reconcileDailyCollectionsResult(
  result: DailyCollectionsResult | null
): DailyCollectionsResult | null {
  if (!result) return null;

  return {
    ...result,
    doctors: result.doctors.map((group) => {
      if (
        group.stats.availableBalance == null &&
        group.stats.withdrawableLimit == null
      ) {
        return group;
      }

      const wallet = reconcilePendingDoctorWallet(group.doctorId, {
        totalEarnings: 0,
        totalWithdrawn: 0,
        pendingAmount: 0,
        approvedAmount: 0,
        expenseDeductions: 0,
        payrollDeductions: 0,
        availableBalance: group.stats.availableBalance ?? 0,
        withdrawableLimit: group.stats.withdrawableLimit ?? 0,
        isDebtor: (group.stats.availableBalance ?? 0) < 0,
      });

      return {
        ...group,
        stats: {
          ...group.stats,
          availableBalance: wallet.availableBalance,
          withdrawableLimit: wallet.withdrawableLimit,
        },
      };
    }),
  };
}

export function applyDoctorWalletToCollectionsResult(
  result: DailyCollectionsResult,
  doctorId: string,
  wallet: DoctorWalletSnapshot
): DailyCollectionsResult {
  return {
    ...result,
    doctors: result.doctors.map((group) =>
      group.doctorId === doctorId
        ? {
            ...group,
            stats: {
              ...group.stats,
              availableBalance: wallet.availableBalance,
              withdrawableLimit: wallet.withdrawableLimit,
            },
          }
        : group
    ),
  };
}

function roundMoney(n: number): number {
  return Math.round(n * 100) / 100;
}
