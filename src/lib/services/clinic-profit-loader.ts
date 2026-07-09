import type { AuthPortalId } from "@/lib/auth/portal-access";
import { fetchClinicProfitStatsForPeriodViaApi } from "@/lib/services/clinic-stats-api";
import type { ClinicProfitStats } from "@/lib/services/clinic-stats";
import { applyOptimisticClinicTopUp } from "@/lib/services/clinic-profit-pending";
import { applyClinicProfitBroadcast } from "@/lib/services/clinic-profit-broadcast";
import { currentMonthYear, monthDateRange } from "@/lib/utils";

/** نفس فترة اللوحة التنفيذية — من أول الشهر حتى آخر يوم فيه */
export function defaultClinicProfitPeriod(): { from: string; to: string } {
  return monthDateRange(currentMonthYear());
}

/**
 * مصدر موحّد للإدارة والمحاسب — السيرفر أولاً ثم ذاكرة الشحن كاحتياط.
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
  return applyOptimisticClinicTopUp(clinicId, withBroadcast, period);
}
