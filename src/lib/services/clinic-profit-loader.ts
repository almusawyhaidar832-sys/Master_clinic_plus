import type { AuthPortalId } from "@/lib/auth/portal-access";
import { fetchClinicProfitStatsForPeriodViaApi } from "@/lib/services/clinic-stats-api";
import {
  applyClinicTopUpToProfitStats,
  type ClinicProfitStats,
} from "@/lib/services/clinic-stats";
import { reconcilePendingClinicProfitStats } from "@/lib/services/clinic-profit-pending";
import { BALANCE_TOPUP_CLINIC_TYPE } from "@/lib/services/balance-topup";
import { currentMonthYear, monthDateRange } from "@/lib/utils";

/** نفس فترة اللوحة التنفيذية — من أول الشهر حتى آخر يوم فيه */
export function defaultClinicProfitPeriod(): { from: string; to: string } {
  return monthDateRange(currentMonthYear());
}

async function fetchProfitStatsWithPortalFallback(
  from: string,
  to: string,
  clinicId: string
): Promise<ClinicProfitStats> {
  const portals: AuthPortalId[] = ["accountant", "admin"];

  let lastError: Error | null = null;
  for (const portal of portals) {
    try {
      return await fetchClinicProfitStatsForPeriodViaApi(
        from,
        to,
        portal,
        clinicId
      );
    } catch (err) {
      lastError = err instanceof Error ? err : new Error(String(err));
    }
  }

  throw lastError ?? new Error("تعذر تحميل بيانات الأرباح");
}

/** يدمج شحن الرصيد من جدول الحركات إن لم يعكسه الـ API */
async function mergeClientBalanceTopupsIfNeeded(
  clinicId: string,
  stats: ClinicProfitStats,
  period: { from: string; to: string }
): Promise<ClinicProfitStats> {
  if (typeof window === "undefined") return stats;

  try {
    const { createClient } = await import("@/lib/supabase/client");
    const supabase = createClient();
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
    /* RLS أو اتصال — نعتمد على الـ API */
  }

  return stats;
}

/** تحميل ربح العيادة مع دمج أي شحن رصيد معلّق — مصدر موحّد للمحاسب والإدارة */
export async function fetchAlignedClinicProfitStats(
  clinicId: string,
  _portal: AuthPortalId = "accountant",
  period: { from: string; to: string } = defaultClinicProfitPeriod()
): Promise<ClinicProfitStats> {
  let stats = await fetchProfitStatsWithPortalFallback(
    period.from,
    period.to,
    clinicId
  );
  stats = await mergeClientBalanceTopupsIfNeeded(clinicId, stats, period);
  return reconcilePendingClinicProfitStats(clinicId, stats, period);
}
