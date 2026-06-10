import type { SupabaseClient } from "@supabase/supabase-js";
import { fetchClosedPayrollMonths } from "@/lib/services/salary-payroll";
import {
  computeOutstandingDebtFromOperations,
} from "@/lib/services/patient-treatment-cases";
import { fetchPatientFinancialPlansBatch } from "@/lib/services/patient-financial-plan";
import { localDateISO, localPeriodUtcBounds } from "@/lib/utils";
import { opDebt, type PatientOperation } from "@/types";

function num(v: unknown): number {
  const n = Number(v ?? 0);
  return Number.isFinite(n) ? n : 0;
}

function opInLocalPeriod(
  op: { operation_date?: string | null; created_at?: string | null },
  from: string,
  to: string
): boolean {
  const opDate = op.operation_date?.slice(0, 10);
  if (opDate && opDate >= from && opDate <= to) return true;
  if (op.created_at) {
    const local = localDateISO(new Date(op.created_at));
    if (local >= from && local <= to) return true;
  }
  return false;
}

function caseRowDebt(row: {
  case_price?: number | null;
  discount_total?: number | null;
  final_price?: number | null;
  total_paid?: number | null;
}): number {
  const casePrice = num(row.case_price);
  const discount = num(row.discount_total);
  const finalPrice =
    num(row.final_price) || Math.max(0, casePrice - discount);
  return Math.max(0, finalPrice - num(row.total_paid));
}

/** مراجعون الفترة — تاريخ العملية أو وقت الإنشاء (تقويم محلي) */
async function collectPeriodVisitorPatientIds(
  supabase: SupabaseClient,
  clinicId: string,
  from: string,
  to: string
): Promise<string[]> {
  const ids = new Set<string>();
  const { startIso, endIso } = localPeriodUtcBounds(from, to);

  const [byOpDate, byCreated, casesRes] = await Promise.all([
    supabase
      .from("patient_operations")
      .select("patient_id")
      .eq("clinic_id", clinicId)
      .gte("operation_date", from)
      .lte("operation_date", to),
    supabase
      .from("patient_operations")
      .select("patient_id, operation_date, created_at")
      .eq("clinic_id", clinicId)
      .gte("created_at", startIso)
      .lte("created_at", endIso),
    supabase
      .from("patient_treatment_cases")
      .select("patient_id, created_at")
      .eq("clinic_id", clinicId)
      .gte("created_at", startIso)
      .lte("created_at", endIso),
  ]);

  for (const row of byOpDate.data ?? []) {
    if (row.patient_id) ids.add(row.patient_id as string);
  }
  for (const row of byCreated.data ?? []) {
    if (
      row.patient_id &&
      opInLocalPeriod(
        {
          operation_date: row.operation_date as string | null,
          created_at: row.created_at as string,
        },
        from,
        to
      )
    ) {
      ids.add(row.patient_id as string);
    }
  }
  for (const row of casesRes.data ?? []) {
    if (
      row.patient_id &&
      opInLocalPeriod(
        { created_at: row.created_at as string, operation_date: null },
        from,
        to
      )
    ) {
      ids.add(row.patient_id as string);
    }
  }

  return [...ids];
}

/**
 * ذمة المراجعين الذين زاروا خلال الفترة (وليس جمع remaining_debt لجلسات اليوم فقط).
 * يطابق get_clinic_financial_snapshot + حالات العلاج.
 */
async function sumVisitorOutstandingDebt(
  supabase: SupabaseClient,
  clinicId: string,
  patientIds: string[]
): Promise<number> {
  if (patientIds.length === 0) return 0;

  const [patientsRes, casesRes, opsRes] = await Promise.all([
    supabase
      .from("patients")
      .select("id, agreed_total, total_paid")
      .eq("clinic_id", clinicId)
      .in("id", patientIds),
    supabase
      .from("patient_treatment_cases")
      .select(
        "patient_id, case_price, discount_total, final_price, total_paid"
      )
      .eq("clinic_id", clinicId)
      .in("patient_id", patientIds),
    supabase
      .from("patient_operations")
      .select(
        "patient_id, remaining_debt, total_amount, paid_amount, session_kind"
      )
      .eq("clinic_id", clinicId)
      .in("patient_id", patientIds),
  ]);

  const patientById = new Map(
    (patientsRes.data ?? []).map((p) => [p.id as string, p])
  );
  const casesByPatient = new Map<string, typeof casesRes.data>();
  for (const row of casesRes.data ?? []) {
    const pid = row.patient_id as string;
    const list = casesByPatient.get(pid) ?? [];
    list.push(row);
    casesByPatient.set(pid, list);
  }
  const opsByPatient = new Map<string, PatientOperation[]>();
  for (const row of opsRes.data ?? []) {
    const pid = row.patient_id as string;
    const list = opsByPatient.get(pid) ?? [];
    list.push(row as PatientOperation);
    opsByPatient.set(pid, list);
  }

  let total = 0;
  const needsPlan: string[] = [];

  for (const pid of patientIds) {
    const p = patientById.get(pid);
    const agreed = num(p?.agreed_total);
    if (agreed > 0) {
      total += Math.max(0, agreed - num(p?.total_paid));
      continue;
    }

    const caseRows = casesByPatient.get(pid) ?? [];
    let caseDebt = 0;
    for (const row of caseRows) {
      caseDebt += caseRowDebt(row);
    }
    if (caseDebt > 0.001) {
      total += caseDebt;
      continue;
    }

    const ops = opsByPatient.get(pid) ?? [];
    if (ops.length) {
      const inferred = computeOutstandingDebtFromOperations(ops, pid);
      if (inferred > 0.001) {
        total += inferred;
        continue;
      }
      const maxOp = ops.reduce((m, op) => Math.max(m, opDebt(op)), 0);
      if (maxOp > 0.001) {
        total += maxOp;
        continue;
      }
    }

    needsPlan.push(pid);
  }

  if (needsPlan.length) {
    const plans = await fetchPatientFinancialPlansBatch(supabase, needsPlan);
    for (const pid of needsPlan) {
      const remaining = plans.get(pid)?.remaining_balance ?? 0;
      if (remaining > 0) {
        total += remaining;
      }
    }
  }

  return Math.round(total * 100) / 100;
}

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
  const bundle = await fetchPaidSalariesBundle(supabase, clinicId, from, to);
  return bundle.display;
}

/** أشهر ضمن الفترة (YYYY-MM) */
export function monthYearsInRange(from: string, to: string): string[] {
  const result: string[] = [];
  const start = new Date(`${from}T12:00:00`);
  const end = new Date(`${to}T12:00:00`);
  const cursor = new Date(start.getFullYear(), start.getMonth(), 1);

  while (cursor <= end) {
    result.push(
      `${cursor.getFullYear()}-${String(cursor.getMonth() + 1).padStart(2, "0")}`
    );
    cursor.setMonth(cursor.getMonth() + 1);
  }

  return result;
}

/**
 * رواتب مُولَّدة (مساعدون + قسائم) — تُخصم من الربح فور التوليد.
 */
export async function fetchPayrollAccrualsForProfitDeduction(
  supabase: SupabaseClient,
  clinicId: string,
  from: string,
  to: string
): Promise<number> {
  const months = monthYearsInRange(from, to);
  if (!months.length) return 0;

  const [recordsRes, slipsRes] = await Promise.all([
    supabase
      .from("payroll_records")
      .select("clinic_share_amount, month_year")
      .eq("clinic_id", clinicId)
      .in("month_year", months),
    supabase
      .from("salary_slips")
      .select("net_payout, month_year")
      .eq("clinic_id", clinicId)
      .in("month_year", months),
  ]);

  let total = 0;
  for (const row of recordsRes.data ?? []) {
    total += Number(row.clinic_share_amount ?? 0);
  }
  for (const row of slipsRes.data ?? []) {
    total += Number(row.net_payout ?? 0);
  }

  return total;
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
  const bundle = await fetchPaidSalariesBundle(supabase, clinicId, from, to);
  return bundle.profitDeduction;
}

export interface PaidSalariesBundle {
  display: number;
  profitDeduction: number;
}

/** استعلام salary_slips واحد — عرض اللوحة + خصم الربح */
export async function fetchPaidSalariesBundle(
  supabase: SupabaseClient,
  clinicId: string,
  from: string,
  to: string
): Promise<PaidSalariesBundle> {
  const [slipsRes, closedMonths] = await Promise.all([
    supabase
      .from("salary_slips")
      .select("net_payout, paid_at, month_year")
      .eq("clinic_id", clinicId)
      .eq("status", "paid"),
    fetchClosedPayrollMonths(supabase, clinicId),
  ]);

  const data = slipsRes.data ?? [];
  if (slipsRes.error || !data.length) {
    return { display: 0, profitDeduction: 0 };
  }

  return {
    display: sumPaidSlipsInPeriod(data, from, to, closedMonths, true),
    profitDeduction: sumPaidSlipsInPeriod(data, from, to, closedMonths, false),
  };
}

export interface ExecutiveDashboardSupplement {
  salariesDisplay: number;
  salariesPaidLegacy: number;
  payrollAccruals: number;
  visitorDebt: { debt: number; visitorCount: number };
}

/** بيانات اللوحة التنفيذية الإضافية — 3 مسارات بدل 5 */
export async function fetchExecutiveDashboardSupplement(
  supabase: SupabaseClient,
  clinicId: string,
  from: string,
  to: string
): Promise<ExecutiveDashboardSupplement> {
  const [salaries, payrollAccruals, visitorDebt] = await Promise.all([
    fetchPaidSalariesBundle(supabase, clinicId, from, to),
    fetchPayrollAccrualsForProfitDeduction(supabase, clinicId, from, to),
    fetchPeriodVisitorDebt(supabase, clinicId, from, to),
  ]);

  return {
    salariesDisplay: salaries.display,
    salariesPaidLegacy: salaries.profitDeduction,
    payrollAccruals,
    visitorDebt,
  };
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

/** جلب كل جلسات الفترة (تاريخ العملية + وقت الإنشاء + توسيع لليوم) */
export async function loadOperationsInPeriod(
  supabase: SupabaseClient,
  clinicId: string,
  from: string,
  to: string
): Promise<PatientOperation[]> {
  const seen = new Map<string, PatientOperation>();

  const addRows = (rows: PatientOperation[] | null) => {
    for (const op of rows ?? []) {
      if (!opInLocalPeriod(op, from, to)) continue;
      const key = op.id || `${op.patient_id}-${op.created_at ?? op.operation_date}`;
      if (!seen.has(key)) seen.set(key, op);
    }
  };

  const { data: byOpDate } = await supabase
    .from("patient_operations")
    .select("*")
    .eq("clinic_id", clinicId)
    .gte("operation_date", from)
    .lte("operation_date", to);
  addRows((byOpDate ?? []) as PatientOperation[]);

  const fromMs = new Date(`${from}T12:00:00`).getTime();
  const toMs = new Date(`${to}T12:00:00`).getTime();
  const daySpan = Math.max(0, (toMs - fromMs) / 86400000);

  if (daySpan <= 7) {
    const lookback = new Date(fromMs);
    lookback.setDate(lookback.getDate() - 14);
    const { data: recent } = await supabase
      .from("patient_operations")
      .select("*")
      .eq("clinic_id", clinicId)
      .gte("created_at", lookback.toISOString())
      .order("created_at", { ascending: false })
      .limit(800);
    addRows((recent ?? []) as PatientOperation[]);
  }

  if (seen.size === 0 && from === to) {
    const monthFrom = `${from.slice(0, 7)}-01`;
    const { data: monthOps } = await supabase
      .from("patient_operations")
      .select("*")
      .eq("clinic_id", clinicId)
      .gte("operation_date", monthFrom)
      .lte("operation_date", to);
    addRows((monthOps ?? []) as PatientOperation[]);
  }

  return [...seen.values()];
}

/** ديون المراجعين الذين زاروا خلال الفترة (ذمتهم الكاملة، ليس جلسات اليوم فقط) */
export async function fetchPeriodVisitorDebt(
  supabase: SupabaseClient,
  clinicId: string,
  from: string,
  to: string
): Promise<{ debt: number; visitorCount: number }> {
  const patientIds = await collectPeriodVisitorPatientIds(
    supabase,
    clinicId,
    from,
    to
  );

  if (patientIds.length === 0) {
    return { debt: 0, visitorCount: 0 };
  }

  const debt = await sumVisitorOutstandingDebt(
    supabase,
    clinicId,
    patientIds
  );

  return { debt, visitorCount: patientIds.length };
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
