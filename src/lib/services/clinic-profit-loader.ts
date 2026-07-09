import type { AuthPortalId } from "@/lib/auth/portal-access";
import { fetchClinicProfitStatsForPeriodViaApi } from "@/lib/services/clinic-stats-api";
import type { ClinicProfitStats } from "@/lib/services/clinic-stats";
import { applyOptimisticClinicTopUp } from "@/lib/services/clinic-profit-pending";
import { currentMonthYear, monthDateRange } from "@/lib/utils";

/** نفس فترة اللوحة التنفيذية — من أول الشهر حتى آخر يوم فيه */
export function defaultClinicProfitPeriod(): { from: string; to: string } {
  return monthDateRange(currentMonthYear());
}

/** يختار النتيجة التي فيها شحن رصيد — ثم أعلى صافي ربح */
function pickBestProfitStats(candidates: ClinicProfitStats[]): ClinicProfitStats {
  if (candidates.length === 0) {
    throw new Error("تعذر تحميل بيانات الأرباح");
  }

  return candidates.reduce((best, cur) => {
    if (cur.balanceTopupsTotal > best.balanceTopupsTotal + 0.01) return cur;
    if (best.balanceTopupsTotal > cur.balanceTopupsTotal + 0.01) return best;
    if (cur.netProfit > best.netProfit + 0.01) return cur;
    return best;
  });
}

/** السيرفر فقط — بدون دمج RLS من المتصفح (كان يسبب فرقاً بين المحاسب والإدارة) */
async function fetchProfitStatsFromServer(
  from: string,
  to: string,
  clinicId: string
): Promise<ClinicProfitStats> {
  const results = await Promise.all(
    (["accountant", "admin"] as const).map((portal) =>
      fetchClinicProfitStatsForPeriodViaApi(from, to, portal, clinicId).catch(
        () => null
      )
    )
  );

  const ok = results.filter((r): r is ClinicProfitStats => r !== null);
  if (ok.length === 0) {
    throw new Error("تعذر تحميل بيانات الأرباح");
  }

  return pickBestProfitStats(ok);
}

/**
 * مصدر موحّد للإدارة والمحاسب.
 * صافي الربح = حصة العيادة − مصروفات − رواتب + شحن الرصيد
 */
export async function fetchAlignedClinicProfitStats(
  clinicId: string,
  _portal: AuthPortalId = "accountant",
  period: { from: string; to: string } = defaultClinicProfitPeriod()
): Promise<ClinicProfitStats> {
  const stats = await fetchProfitStatsFromServer(period.from, period.to, clinicId);
  return applyOptimisticClinicTopUp(clinicId, stats, period);
}
