import type { SupabaseClient } from "@supabase/supabase-js";
import type { AuthPortalId } from "@/lib/auth/portal-access";
import { fetchClinicProfitStatsForPeriodViaApi } from "@/lib/services/clinic-stats-api";
import {
  alignClinicProfitStatsWithFinancialSnapshot,
  applyClinicTopUpToProfitStats,
  clinicProfitStatsFromFinancialSnapshot,
  fetchClinicFinancialSnapshotRpc,
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
    /* RLS أو اتصال — نعتمد على المصادر الأخرى */
  }

  return stats;
}

/** يطابق لوحة المحاسب — RPC + API + شحن معلّق */
async function mergeFinancialSnapshotRpc(
  supabase: SupabaseClient,
  clinicId: string,
  stats: ClinicProfitStats | null,
  period: { from: string; to: string }
): Promise<ClinicProfitStats> {
  const snap = await fetchClinicFinancialSnapshotRpc(
    supabase,
    clinicId,
    period.from,
    period.to
  );

  if (!snap) {
    return stats ?? clinicProfitStatsFromFinancialSnapshot({
      netProfit: 0,
      balanceTopups: 0,
      collected: 0,
      clinicShares: 0,
      reviewFees: 0,
      expenses: 0,
      salariesPaid: 0,
      doctorShares: 0,
      debt: 0,
    });
  }

  if (!stats) {
    return clinicProfitStatsFromFinancialSnapshot(snap);
  }

  return alignClinicProfitStatsWithFinancialSnapshot(stats, snap);
}

/** تحميل ربح العيادة مع دمج أي شحن رصيد معلّق — مصدر موحّد للمحاسب والإدارة */
export async function fetchAlignedClinicProfitStats(
  clinicId: string,
  _portal: AuthPortalId = "accountant",
  period: { from: string; to: string } = defaultClinicProfitPeriod()
): Promise<ClinicProfitStats> {
  const { createClient } = await import("@/lib/supabase/client");
  const supabase = createClient();

  let stats: ClinicProfitStats | null = null;
  try {
    stats = await fetchProfitStatsWithPortalFallback(
      period.from,
      period.to,
      clinicId
    );
  } catch {
    stats = null;
  }

  if (stats) {
    stats = await mergeClientBalanceTopupsIfNeeded(
      supabase,
      clinicId,
      stats,
      period
    );
  }

  stats = await mergeFinancialSnapshotRpc(supabase, clinicId, stats, period);
  return reconcilePendingClinicProfitStats(clinicId, stats, period);
}
