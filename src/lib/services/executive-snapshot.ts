import type { SupabaseClient } from "@supabase/supabase-js";
import { fetchClosedPayrollMonths } from "@/lib/services/salary-payroll";
import { fetchConfirmedPayrollProfitDeduction } from "@/lib/services/payroll-paid-portions";
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
 * ذمة مجموعة مرضى مُحدَّدة (بغض النظر عن سبب اختيارهم — زوار فترة أو كل مرضى العيادة).
 * يطابق get_clinic_financial_snapshot + حالات العلاج.
 */
async function sumOutstandingDebtForPatients(
  supabase: SupabaseClient,
  clinicId: string,
  patientIds: string[]
): Promise<{ total: number; debtorCount: number }> {
  if (patientIds.length === 0) return { total: 0, debtorCount: 0 };

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
  let debtorCount = 0;
  const needsPlan: string[] = [];

  for (const pid of patientIds) {
    const p = patientById.get(pid);
    const agreed = num(p?.agreed_total);
    if (agreed > 0) {
      const owed = Math.max(0, agreed - num(p?.total_paid));
      total += owed;
      if (owed > 0.001) debtorCount += 1;
      continue;
    }

    const caseRows = casesByPatient.get(pid) ?? [];
    let caseDebt = 0;
    for (const row of caseRows) {
      caseDebt += caseRowDebt(row);
    }
    if (caseDebt > 0.001) {
      total += caseDebt;
      debtorCount += 1;
      continue;
    }

    const ops = opsByPatient.get(pid) ?? [];
    if (ops.length) {
      const inferred = computeOutstandingDebtFromOperations(ops, pid);
      if (inferred > 0.001) {
        total += inferred;
        debtorCount += 1;
        continue;
      }
      const maxOp = ops.reduce((m, op) => Math.max(m, opDebt(op)), 0);
      if (maxOp > 0.001) {
        total += maxOp;
        debtorCount += 1;
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
        debtorCount += 1;
      }
    }
  }

  return { total: Math.round(total * 100) / 100, debtorCount };
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

function slipConfirmedPayout(row: {
  net_payout: number | null;
  paid_net_payout?: number | null;
  status?: string | null;
}): number {
  const paidPortion = roundMoney(Number(row.paid_net_payout ?? 0));
  if (paidPortion > 0) return paidPortion;
  if (row.status === "paid") {
    return roundMoney(Number(row.net_payout ?? 0));
  }
  return 0;
}

/** فلتر الفترة — cash_date: تاريخ الصرف الفعلي؛ payroll_month: شهر القسيمة (عرض) */
type SalaryPeriodFilter = "cash_date" | "payroll_month";

function localPaidAtInRange(
  paidAt: string | null | undefined,
  from: string,
  to: string
): boolean {
  if (!paidAt) return false;
  const day = localDateISO(new Date(paidAt));
  return day >= from && day <= to;
}

function rowInSalaryPeriod(
  row: { paid_at: string | null; month_year: string | null },
  from: string,
  to: string,
  filter: SalaryPeriodFilter
): boolean {
  if (localPaidAtInRange(row.paid_at, from, to)) return true;
  if (filter === "cash_date") return false;
  const my = row.month_year as string | null;
  if (!my) return false;
  return monthKeysBetween(from, to).has(my);
}

function sumPaidSlipsInPeriod(
  rows: {
    net_payout: number | null;
    paid_net_payout?: number | null;
    paid_at: string | null;
    month_year: string | null;
    status?: string | null;
  }[],
  from: string,
  to: string,
  closedMonths: Set<string>,
  excludeClosedPayrollMonths: boolean,
  periodFilter: SalaryPeriodFilter
): number {
  return rows.reduce((sum, row) => {
    const payout = slipConfirmedPayout(row);
    if (payout <= 0) return sum;

    const my = row.month_year as string | null;
    if (excludeClosedPayrollMonths && my && closedMonths.has(my)) return sum;

    if (rowInSalaryPeriod(row, from, to, periodFilter)) return sum + payout;

    return sum;
  }, 0);
}

function roundMoney(n: number): number {
  return Math.round(Number(n) * 100) / 100;
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
 * خصم الربح من **حركات الصرف المؤكَّدة** ضمن الفترة (ليس استحقاقاً قبل التأكيد).
 * @deprecated الاسم القديم مضلّل — استخدم fetchConfirmedPayrollProfitDeduction
 */
export async function fetchPayrollAccrualsForProfitDeduction(
  supabase: SupabaseClient,
  clinicId: string,
  from: string,
  to: string
): Promise<number> {
  return fetchConfirmedPayrollProfitDeduction(supabase, clinicId, from, to);
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

/** استعلام salary_slips — المُؤكَّد صرفه فقط (paid_net_payout)، مو المتبقي */
async function fetchSalarySlipsForProfitLegacy(
  supabase: SupabaseClient,
  clinicId: string
) {
  const withPaidColumn = await supabase
    .from("salary_slips")
    .select("net_payout, paid_net_payout, paid_at, month_year, status")
    .eq("clinic_id", clinicId)
    .or("status.eq.paid,paid_net_payout.gt.0");

  if (!withPaidColumn.error) {
    return withPaidColumn.data ?? [];
  }

  const legacy = await supabase
    .from("salary_slips")
    .select("net_payout, paid_at, month_year, status")
    .eq("clinic_id", clinicId)
    .eq("status", "paid");

  return legacy.data ?? [];
}

function sumAssistantClinicPaidInPeriod(
  rows: {
    clinic_share_amount?: number | null;
    paid_clinic_share_amount?: number | null;
    paid_at: string | null;
    month_year: string | null;
    status?: string | null;
  }[],
  from: string,
  to: string,
  closedMonths: Set<string>,
  excludeClosedPayrollMonths: boolean,
  periodFilter: SalaryPeriodFilter
): number {
  return rows.reduce((sum, row) => {
    const paidClinic = roundMoney(Number(row.paid_clinic_share_amount ?? 0));
    const payout =
      paidClinic > 0
        ? paidClinic
        : row.status === "paid"
          ? roundMoney(Number(row.clinic_share_amount ?? 0))
          : 0;
    if (payout <= 0) return sum;

    const my = row.month_year as string | null;
    if (excludeClosedPayrollMonths && my && closedMonths.has(my)) return sum;

    if (rowInSalaryPeriod(row, from, to, periodFilter)) return sum + payout;

    return sum;
  }, 0);
}

async function fetchPayrollRecordsForProfitLegacy(
  supabase: SupabaseClient,
  clinicId: string
) {
  const withPaid = await supabase
    .from("payroll_records")
    .select(
      "clinic_share_amount, paid_clinic_share_amount, paid_at, month_year, status"
    )
    .eq("clinic_id", clinicId)
    .or("status.eq.paid,paid_clinic_share_amount.gt.0");

  if (!withPaid.error) {
    return withPaid.data ?? [];
  }

  const legacy = await supabase
    .from("payroll_records")
    .select("clinic_share_amount, paid_at, month_year, status")
    .eq("clinic_id", clinicId)
    .eq("status", "paid");

  return legacy.data ?? [];
}

/** استعلام salary_slips واحد — عرض اللوحة + خصم الربح */
export async function fetchPaidSalariesBundle(
  supabase: SupabaseClient,
  clinicId: string,
  from: string,
  to: string
): Promise<PaidSalariesBundle> {
  const [slipRows, recordRows, closedMonths] = await Promise.all([
    fetchSalarySlipsForProfitLegacy(supabase, clinicId),
    fetchPayrollRecordsForProfitLegacy(supabase, clinicId),
    fetchClosedPayrollMonths(supabase, clinicId),
  ]);

  if (!slipRows.length && !recordRows.length) {
    return { display: 0, profitDeduction: 0 };
  }

  const staffDisplay = sumPaidSlipsInPeriod(
    slipRows,
    from,
    to,
    closedMonths,
    true,
    "payroll_month"
  );
  const staffProfit = sumPaidSlipsInPeriod(
    slipRows,
    from,
    to,
    closedMonths,
    false,
    "cash_date"
  );
  const assistantDisplay = sumAssistantClinicPaidInPeriod(
    recordRows,
    from,
    to,
    closedMonths,
    true,
    "payroll_month"
  );
  const assistantProfit = sumAssistantClinicPaidInPeriod(
    recordRows,
    from,
    to,
    closedMonths,
    false,
    "cash_date"
  );

  return {
    display: roundMoney(staffDisplay + assistantDisplay),
    profitDeduction: roundMoney(staffProfit + assistantProfit),
  };
}

export interface ExecutiveDashboardSupplement {
  salariesDisplay: number;
  salariesPaidLegacy: number;
  payrollAccruals: number;
  visitorDebt: { debt: number; visitorCount: number };
  /** إجمالي الذمم الحالية على كل العيادة — لا يتصفّر ببداية فترة جديدة */
  totalDebt: { debt: number; debtorCount: number };
}

/** أرقام الربح — نفس منطق التقرير الشامل (fetchClinicProfitStatsForPeriod) */
export interface ReportAlignedProfitMetrics {
  netProfit: number;
  clinicShareTotal: number;
  totalExpenses: number;
  reviewFees: number;
  salariesDeducted: number;
  doctorShareTotal: number;
}

/** محاذاة اللوحة التنفيذية مع التقرير — حصة العيادة من clinic_share_amount وليس calc_clinic_operation_earned */
export function applyReportAlignedProfitMetrics<T extends ExecutiveSnapshotCore>(
  snap: T,
  aligned: ReportAlignedProfitMetrics
): T {
  return {
    ...snap,
    clinic_shares: aligned.clinicShareTotal,
    expenses: aligned.totalExpenses,
    review_fees: aligned.reviewFees,
    net_profit: aligned.netProfit,
    doctor_shares: aligned.doctorShareTotal,
  };
}

/** بيانات اللوحة التنفيذية الإضافية — 3 مسارات بدل 5 */
export async function fetchExecutiveDashboardSupplement(
  supabase: SupabaseClient,
  clinicId: string,
  from: string,
  to: string
): Promise<ExecutiveDashboardSupplement> {
  const [salaries, payrollAccruals, visitorDebt, totalDebt] = await Promise.all([
    fetchPaidSalariesBundle(supabase, clinicId, from, to),
    fetchConfirmedPayrollProfitDeduction(supabase, clinicId, from, to),
    fetchPeriodVisitorDebt(supabase, clinicId, from, to),
    fetchClinicOutstandingDebtNow(supabase, clinicId),
  ]);

  return {
    salariesDisplay: salaries.display,
    salariesPaidLegacy: salaries.profitDeduction,
    payrollAccruals,
    visitorDebt,
    totalDebt,
  };
}

export async function fetchPaidSalariesInPeriod(
  supabase: SupabaseClient,
  clinicId: string,
  from: string,
  to: string,
  options?: { excludeClosedPayrollMonths?: boolean }
): Promise<number> {
  const bundle = await fetchPaidSalariesBundle(supabase, clinicId, from, to);
  if (options?.excludeClosedPayrollMonths) {
    return bundle.display;
  }
  return bundle.profitDeduction;
}

/** خصم الرواتب للتقارير — نفس منطق اللوحة التنفيذية */
export async function fetchResolvedSalaryDeductionForPeriod(
  supabase: SupabaseClient,
  clinicId: string,
  from: string,
  to: string
): Promise<number> {
  const [payrollAccruals, bundle] = await Promise.all([
    fetchConfirmedPayrollProfitDeduction(supabase, clinicId, from, to),
    fetchPaidSalariesBundle(supabase, clinicId, from, to),
  ]);
  return resolveExecutiveSalaryDeduction(
    payrollAccruals,
    bundle.profitDeduction
  );
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

  const { total } = await sumOutstandingDebtForPatients(
    supabase,
    clinicId,
    patientIds
  );

  return { debt: total, visitorCount: patientIds.length };
}

/**
 * إجمالي الذمم المستحقة على كل مرضى العيادة الآن — بغض النظر عن الفترة المختارة
 * باللوحة (الديون لا تتبع فترة زمنية، فتصفيرها في بداية شهر جديد مضلِّل).
 */
export async function fetchClinicOutstandingDebtNow(
  supabase: SupabaseClient,
  clinicId: string
): Promise<{ debt: number; debtorCount: number }> {
  const { data } = await supabase
    .from("patients")
    .select("id")
    .eq("clinic_id", clinicId);
  const patientIds = (data ?? []).map((p) => p.id as string);

  if (patientIds.length === 0) {
    return { debt: 0, debtorCount: 0 };
  }

  const { total, debtorCount } = await sumOutstandingDebtForPatients(
    supabase,
    clinicId,
    patientIds
  );

  return { debt: total, debtorCount };
}

export interface ExecutiveSnapshotCore {
  clinic_shares: number;
  expenses: number;
  salaries_paid?: number;
  review_fees?: number;
  net_profit: number;
  [key: string]: unknown;
}

/** خصم الرواتب من الربح — المُؤكَّد صرفه (حركات + قسائم) */
export function resolveExecutiveSalaryDeduction(
  payrollAccruals: number,
  salariesPaidLegacy: number
): number {
  return roundMoney(Math.max(payrollAccruals, salariesPaidLegacy));
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
