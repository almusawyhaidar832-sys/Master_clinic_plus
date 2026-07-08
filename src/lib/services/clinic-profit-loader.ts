import type { SupabaseClient } from "@supabase/supabase-js";
import type { AuthPortalId } from "@/lib/auth/portal-access";
import { fetchClinicProfitStatsForPeriodViaApi } from "@/lib/services/clinic-stats-api";
import {
  applyClinicTopUpToProfitStats,
  type ClinicProfitStats,
} from "@/lib/services/clinic-stats";
import { clearPendingClinicTopUp } from "@/lib/services/clinic-profit-pending";
import { BALANCE_TOPUP_CLINIC_TYPE } from "@/lib/services/balance-topup";
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

/** يجلب من السيرفر عبر جلسة المحاسب والإدارة — نفس النتيجة */
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

/** يدمج شحن الرصيد من جدول الحركات إن لم يعكسه السيرفر */
async function mergeClientBalanceTopupsIfNeeded(
  supabase: SupabaseClient,
  clinicId: string,
  stats: ClinicProfitStats,
  period: { from: string; to: string }
): Promise<ClinicProfitStats> {
  try {
    const { data } = await supabase
      .from("transactions")
      .select("amount")
      .eq("clinic_id", clinicId)
      .eq("type", BALANCE_TOPUP_CLINIC_TYPE)
      .gt("amount", 0)
      .gte("transaction_date", period.from)
      .lte("transaction_date", period.to);

    const clientTopups =
      Math.round(
        (data ?? []).reduce((s, row) => s + Math.max(0, Number(row.amount ?? 0)), 0) *
          100
      ) / 100;

    if (clientTopups > stats.balanceTopupsTotal + 0.01) {
      const delta = Math.round((clientTopups - stats.balanceTopupsTotal) * 100) / 100;
      return applyClinicTopUpToProfitStats(stats, delta);
    }
  } catch {
    /* RLS — نعتمد على السيرفر */
  }

  return stats;
}

/**
 * مصدر موحّد للإدارة والمحاسب — السيرفر فقط (بدون ذاكرة معلّقة).
 * صافي الربح = حصة العيادة − مصروفات − رواتب + شحن الرصيد
 */
export async function fetchAlignedClinicProfitStats(
  clinicId: string,
  _portal: AuthPortalId = "accountant",
  period: { from: string; to: string } = defaultClinicProfitPeriod()
): Promise<ClinicProfitStats> {
  const { createClientForPortal } = await import("@/lib/supabase/client");

  let stats = await fetchProfitStatsFromServer(period.from, period.to, clinicId);

  for (const portal of ["accountant", "admin"] as const) {
    stats = await mergeClientBalanceTopupsIfNeeded(
      createClientForPortal(portal),
      clinicId,
      stats,
      period
    );
  }

  if (stats.balanceTopupsTotal > 0) {
    clearPendingClinicTopUp(clinicId);
  }

  return stats;
}
