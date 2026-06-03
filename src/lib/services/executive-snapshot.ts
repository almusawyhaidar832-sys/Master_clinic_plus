import type { SupabaseClient } from "@supabase/supabase-js";
import { fetchClosedPayrollMonths } from "@/lib/services/salary-payroll";

/** YYYY-MM from ISO date YYYY-MM-DD */
function monthKeysBetween(from: string, to: string): Set<string> {
  const keys = new Set<string>();
  const start = new Date(`${from}T12:00:00`);
  const end = new Date(`${to}T12:00:00`);
  const cur = new Date(start.getFullYear(), start.getMonth(), 1);
  const last = new Date(end.getFullYear(), end.getMonth(), 1);
  while (cur <= last) {
    keys.add(
      `${cur.getFullYear()}-${String(cur.getMonth() + 1).padStart(2, "0")}`
    );
    cur.setMonth(cur.getMonth() + 1);
  }
  return keys;
}

function sumPaidSlipsInPeriod(
  rows: { net_payout: number | null; paid_at: string | null; month_year: string | null }[],
  from: string,
  to: string,
  closedMonths: Set<string>,
  excludeClosedPayrollMonths: boolean
): number {
  const fromMs = new Date(`${from}T00:00:00`).getTime();
  const toMs = new Date(`${to}T23:59:59.999`).getTime();
  const months = monthKeysBetween(from, to);

  return rows.reduce((sum, row) => {
    const payout = Number(row.net_payout ?? 0);
    if (payout <= 0) return sum;

    const my = row.month_year as string | null;
    if (excludeClosedPayrollMonths && my && closedMonths.has(my)) return sum;

    if (row.paid_at) {
      const t = new Date(row.paid_at).getTime();
      if (t >= fromMs && t <= toMs) return sum + payout;
    }

    if (my && months.has(my)) return sum + payout;

    return sum;
  }, 0);
}

/**
 * رواتب مُسلَّمة للعرض في اللوحة — تُصفَّر بعد تصفير شهر الرواتب.
 */
export async function fetchPaidSalariesForDisplay(
  supabase: SupabaseClient,
  clinicId: string,
  from: string,
  to: string
): Promise<number> {
  return fetchPaidSalariesInPeriod(supabase, clinicId, from, to, {
    excludeClosedPayrollMonths: true,
  });
}

/**
 * خصم الربح — يبقى حتى بعد التصفير (الراتب المدفوع لا يرجع للربح).
 */
export async function fetchPaidSalariesForProfitDeduction(
  supabase: SupabaseClient,
  clinicId: string,
  from: string,
  to: string
): Promise<number> {
  return fetchPaidSalariesInPeriod(supabase, clinicId, from, to, {
    excludeClosedPayrollMonths: false,
  });
}

export async function fetchPaidSalariesInPeriod(
  supabase: SupabaseClient,
  clinicId: string,
  from: string,
  to: string,
  options?: { excludeClosedPayrollMonths?: boolean }
): Promise<number> {
  const excludeClosed = options?.excludeClosedPayrollMonths ?? false;

  const [slipsRes, closedMonths] = await Promise.all([
    supabase
      .from("salary_slips")
      .select("net_payout, paid_at, month_year")
      .eq("clinic_id", clinicId)
      .eq("status", "paid"),
    excludeClosed
      ? fetchClosedPayrollMonths(supabase, clinicId)
      : Promise.resolve(new Set<string>()),
  ]);

  const data = slipsRes.data;
  if (slipsRes.error || !data?.length) return 0;

  return sumPaidSlipsInPeriod(data, from, to, closedMonths, excludeClosed);
}

/** كشفيات المراجع في الفترة — تُجمع كلما تُسجَّل جلسة بكشفية */
export async function fetchReviewFeesInPeriod(
  supabase: SupabaseClient,
  clinicId: string,
  from: string,
  to: string
): Promise<{ total: number; count: number }> {
  const { data, error } = await supabase
    .from("patient_operations")
    .select("review_fee_amount")
    .eq("clinic_id", clinicId)
    .gte("operation_date", from)
    .lte("operation_date", to);

  if (error) {
    if (
      error.message?.includes("review_fee_amount") ||
      error.code === "PGRST205"
    ) {
      return { total: 0, count: 0 };
    }
    return { total: 0, count: 0 };
  }

  let total = 0;
  let count = 0;
  for (const row of data ?? []) {
    const fee = Number(row.review_fee_amount ?? 0);
    if (fee > 0) {
      total += fee;
      count += 1;
    }
  }
  return { total, count };
}

export interface ExecutiveSnapshotCore {
  clinic_shares: number;
  expenses: number;
  salaries_paid?: number;
  review_fees?: number;
  net_profit: number;
  [key: string]: unknown;
}

/** دمج رواتب + كشفيات في اللوحة التنفيذية */
export function mergeExecutiveDashboardMetrics<T extends ExecutiveSnapshotCore>(
  snap: T,
  metrics: {
    salariesPaid: number;
    salariesDeductedFromProfit: number;
    reviewFees: number;
  }
): T {
  const clinicShares = Number(snap.clinic_shares ?? 0);
  const expenses = Number(snap.expenses ?? 0);
  const reviewFees =
    metrics.reviewFees > 0
      ? metrics.reviewFees
      : Number(snap.review_fees ?? 0);

  return {
    ...snap,
    salaries_paid: metrics.salariesPaid,
    review_fees: reviewFees,
    net_profit:
      clinicShares +
      reviewFees -
      expenses -
      metrics.salariesDeductedFromProfit,
  };
}

/** @deprecated استخدم mergeExecutiveDashboardMetrics */
export function mergeSalariesIntoSnapshot<T extends ExecutiveSnapshotCore>(
  snap: T,
  salariesPaid: number
): T {
  return mergeExecutiveDashboardMetrics(snap, {
    salariesPaid,
    salariesDeductedFromProfit: salariesPaid,
    reviewFees: Number(snap.review_fees ?? 0),
  });
}
