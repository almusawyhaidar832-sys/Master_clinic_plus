import type { AuthPortalId } from "@/lib/auth/portal-access";
import { fetchClinicProfitStatsForPeriodViaApi } from "@/lib/services/clinic-stats-api";
import type { ClinicProfitStats } from "@/lib/services/clinic-stats";
import { reconcilePendingClinicProfitStats } from "@/lib/services/clinic-profit-pending";
import { currentMonthYear, monthDateRange } from "@/lib/utils";

/** نفس فترة اللوحة التنفيذية — من أول الشهر حتى آخر يوم فيه */
export function defaultClinicProfitPeriod(): { from: string; to: string } {
  return monthDateRange(currentMonthYear());
}

/** تحميل ربح العيادة مع دمج أي شحن رصيد معلّق — مصدر موحّد للمحاسب والإدارة */
export async function fetchAlignedClinicProfitStats(
  clinicId: string,
  portal: AuthPortalId,
  period: { from: string; to: string } = defaultClinicProfitPeriod()
): Promise<ClinicProfitStats> {
  const stats = await fetchClinicProfitStatsForPeriodViaApi(
    period.from,
    period.to,
    portal
  );
  return reconcilePendingClinicProfitStats(clinicId, stats, period);
}
