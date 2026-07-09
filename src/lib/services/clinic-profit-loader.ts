import type { AuthPortalId } from "@/lib/auth/portal-access";
import { createClient } from "@/lib/supabase/client";
import { fetchClinicProfitStatsForPeriodViaApi } from "@/lib/services/clinic-stats-api";
import type { ClinicProfitStats } from "@/lib/services/clinic-stats";
import {
  alignClinicProfitStatsWithFinancialSnapshot,
  applyClinicTopUpToProfitStats,
  fetchClinicFinancialSnapshotRpc,
} from "@/lib/services/clinic-stats";
import { fetchClinicBalanceTopupsAuthoritative } from "@/lib/services/balance-topup";
import { applyOptimisticClinicTopUp } from "@/lib/services/clinic-profit-pending";
import { applyClinicProfitBroadcast } from "@/lib/services/clinic-profit-broadcast";
import { currentMonthYear, monthDateRange } from "@/lib/utils";

/** نفس فترة اللوحة التنفيذية — من أول الشهر حتى آخر يوم فيه */
export function defaultClinicProfitPeriod(): { from: string; to: string } {
  return monthDateRange(currentMonthYear());
}

/** يدمج شحن الرصيد مباشرة من قاعدة البيانات — ضروري للإدارة على جهاز مختلف */
async function enrichClinicProfitWithLiveTopups(
  clinicId: string,
  period: { from: string; to: string },
  stats: ClinicProfitStats
): Promise<ClinicProfitStats> {
  if (typeof window === "undefined") return stats;

  const supabase = createClient();
  const [authoritativeTopups, rpcSnap] = await Promise.all([
    fetchClinicBalanceTopupsAuthoritative(
      supabase,
      clinicId,
      period.from,
      period.to
    ),
    fetchClinicFinancialSnapshotRpc(supabase, clinicId, period.from, period.to),
  ]);

  let next = stats;
  if (authoritativeTopups > next.balanceTopupsTotal + 0.01) {
    next = applyClinicTopUpToProfitStats(
      next,
      authoritativeTopups - next.balanceTopupsTotal
    );
  }
  if (rpcSnap) {
    next = alignClinicProfitStatsWithFinancialSnapshot(next, rpcSnap);
  }
  return next;
}

/**
 * مصدر موحّد للإدارة والمحاسب — السيرفر أولاً ثم قاعدة البيانات ثم الذاكرة.
 * صافي الربح = حصة العيادة − مصروفات − رواتب + شحن الرصيد
 */
export async function fetchAlignedClinicProfitStats(
  clinicId: string,
  portal: AuthPortalId = "accountant",
  period: { from: string; to: string } = defaultClinicProfitPeriod()
): Promise<ClinicProfitStats> {
  const stats = await fetchClinicProfitStatsForPeriodViaApi(
    period.from,
    period.to,
    portal,
    clinicId
  );
  const withBroadcast = applyClinicProfitBroadcast(clinicId, period, stats);
  const withPending = applyOptimisticClinicTopUp(clinicId, withBroadcast, period);

  if (portal === "admin") {
    return enrichClinicProfitWithLiveTopups(clinicId, period, withPending);
  }

  return withPending;
}
