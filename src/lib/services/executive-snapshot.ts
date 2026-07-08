import type { SupabaseClient } from "@supabase/supabase-js";
import { DOCTOR_FINANCE_SELECT } from "@/lib/services/doctor-db-select";
import { fetchClosedPayrollMonths } from "@/lib/services/salary-payroll";
import { fetchConfirmedPayrollProfitDeduction } from "@/lib/services/payroll-paid-portions";
import {
  computeOutstandingDebtFromOperations,
} from "@/lib/services/patient-treatment-cases";
import { fetchPatientFinancialPlansBatch } from "@/lib/services/patient-financial-plan";
import { resolveOperationPaymentSplit } from "@/lib/services/session-billing-mode";
import { localDateISO, localPeriodUtcBounds } from "@/lib/utils";
import { opDebt, opName, type Doctor, type PatientOperation } from "@/types";
import type { TopPerformersPayload } from "@/lib/services/doctor-performance";

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
    false,
    "cash_date"
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
    false,
    "cash_date"
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
  revenue: number;
  collected: number;
  operationCount: number;
  patientCount: number;
  newPatients: number;
}

/** محاذاة اللوحة التنفيذية مع الكشف المالي — علاج وكشفيات منفصلان في العرض */
export function applyReportAlignedProfitMetrics<T extends ExecutiveSnapshotCore>(
  snap: T,
  aligned: ReportAlignedProfitMetrics
): T {
  const clinicShareFromTreatment = roundMoney(
    Math.max(0, aligned.clinicShareTotal - aligned.reviewFees)
  );
  return {
    ...snap,
    revenue: aligned.revenue,
    collected: aligned.collected,
    clinic_shares: clinicShareFromTreatment,
    expenses: aligned.totalExpenses,
    review_fees: aligned.reviewFees,
    net_profit: aligned.netProfit,
    doctor_shares: aligned.doctorShareTotal,
    operation_count: aligned.operationCount,
    patient_count: aligned.patientCount,
    new_patients: aligned.newPatients,
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
  const { fetchRegisteredAssistantPayrollClinicDeduction } = await import(
    "@/lib/ledger/daily-assistant-payroll"
  );
  const [payrollAccruals, bundle, registeredAssistantClinic] = await Promise.all([
    fetchConfirmedPayrollProfitDeduction(supabase, clinicId, from, to),
    fetchPaidSalariesBundle(supabase, clinicId, from, to),
    fetchRegisteredAssistantPayrollClinicDeduction(supabase, clinicId, from, to),
  ]);
  return roundMoney(
    resolveExecutiveSalaryDeduction(payrollAccruals, bundle.profitDeduction) +
      registeredAssistantClinic
  );
}

/** كشفيات المراجع في الفترة — مدفوعة فقط، مع استنتاج السجلات القديمة */
export async function fetchReviewFeesInPeriod(
  supabase: SupabaseClient,
  clinicId: string,
  from: string,
  to: string
): Promise<{ total: number; count: number }> {
  const {
    loadClinicDefaultReviewFee,
    resolveReviewFeeOnOperation,
    sumReviewFeesInOperations,
  } = await import("@/lib/services/doctor-wallet");
  const [ops, clinicReviewFee] = await Promise.all([
    loadOperationsInPeriod(supabase, clinicId, from, to),
    loadClinicDefaultReviewFee(supabase, clinicId),
  ]);

  let count = 0;
  for (const row of ops) {
    const paid = Number(row.paid_amount ?? 0);
    if (paid <= 0) continue;
    const fee = resolveReviewFeeOnOperation(row, clinicReviewFee);
    if (fee > 0) count += 1;
  }

  return {
    total: sumReviewFeesInOperations(ops, clinicReviewFee),
    count,
  };
}

export interface PeriodOperationFinancials {
  revenue: number;
  collected: number;
  clinicShareTotal: number;
  doctorShareTotal: number;
}

/**
 * حصص العيادة/الطبيب من المدفوعات — يطابق calc_*_operation_earned (plan/payment).
 */
export async function summarizePeriodOperationFinancials(
  supabase: SupabaseClient,
  ops: PatientOperation[]
): Promise<PeriodOperationFinancials> {
  if (ops.length === 0) {
    return {
      revenue: 0,
      collected: 0,
      clinicShareTotal: 0,
      doctorShareTotal: 0,
    };
  }

  const caseIds = [
    ...new Set(
      ops
        .map((o) => o.treatment_case_id?.trim())
        .filter((id): id is string => !!id)
    ),
  ];
  const doctorIds = [
    ...new Set(
      ops.map((o) => o.doctor_id).filter((id): id is string => !!id)
    ),
  ];

  const [casesRes, doctorsRes] = await Promise.all([
    caseIds.length
      ? supabase
          .from("patient_treatment_cases")
          .select(
            "id, clinic_share_total, doctor_share_total, final_price"
          )
          .in("id", caseIds)
      : Promise.resolve({ data: [] as Record<string, unknown>[] }),
    doctorIds.length
      ? supabase
          .from("doctors")
          .select(
            DOCTOR_FINANCE_SELECT
          )
          .in("id", doctorIds)
      : Promise.resolve({ data: [] as Record<string, unknown>[] }),
  ]);

  const caseById = new Map(
    (casesRes.data ?? []).map((row) => [String(row.id), row])
  );
  const doctorById = new Map<string, Doctor>();
  for (const doc of doctorsRes.data ?? []) {
    doctorById.set(String(doc.id), doc as Doctor);
  }

  let revenue = 0;
  let collected = 0;
  let clinicShareTotal = 0;
  let doctorShareTotal = 0;

  for (const op of ops) {
    const paid = num(op.paid_amount);
    if (paid <= 0) continue;

    const total = num(op.total_amount);
    collected += paid;
    revenue += total > 0 ? total : paid;

    const doctorId = op.doctor_id ? String(op.doctor_id) : "";
    const doctor = doctorId ? doctorById.get(doctorId) ?? null : null;
    const caseId = op.treatment_case_id?.trim();
    const caseRow = caseId ? caseById.get(caseId) : undefined;

    const split = resolveOperationPaymentSplit(op, doctor, caseRow ?? null);
    clinicShareTotal += split.clinicShare;
    doctorShareTotal += split.doctorShare;
  }

  return {
    revenue: roundMoney(revenue),
    collected: roundMoney(collected),
    clinicShareTotal: roundMoney(clinicShareTotal),
    doctorShareTotal: roundMoney(doctorShareTotal),
  };
}

/** جلب كل جلسات الفترة (تاريخ العملية + وقت الإنشاء — تقويم محلي) */
export async function loadOperationsInPeriod(
  supabase: SupabaseClient,
  clinicId: string,
  from: string,
  to: string
): Promise<PatientOperation[]> {
  const seen = new Map<string, PatientOperation>();
  const { startIso, endIso } = localPeriodUtcBounds(from, to);

  const addRows = (rows: PatientOperation[] | null) => {
    for (const op of rows ?? []) {
      if (!opInLocalPeriod(op, from, to)) continue;
      const key = op.id || `${op.patient_id}-${op.created_at ?? op.operation_date}`;
      if (!seen.has(key)) seen.set(key, op);
    }
  };

  const [byOpDateRes, byCreatedRes] = await Promise.all([
    supabase
      .from("patient_operations")
      .select("*")
      .eq("clinic_id", clinicId)
      .gte("operation_date", from)
      .lte("operation_date", to),
    supabase
      .from("patient_operations")
      .select("*")
      .eq("clinic_id", clinicId)
      .gte("created_at", startIso)
      .lte("created_at", endIso)
      .order("created_at", { ascending: false })
      .limit(2000),
  ]);

  addRows((byOpDateRes.data ?? []) as PatientOperation[]);
  addRows((byCreatedRes.data ?? []) as PatientOperation[]);

  return [...seen.values()];
}

/** أفضل الأطباء والخدمات — نفس منطق الكشف المالي (operation_date + created_at) */
export async function fetchTopPerformersForPeriod(
  supabase: SupabaseClient,
  clinicId: string,
  from: string,
  to: string
): Promise<TopPerformersPayload> {
  const ops = await loadOperationsInPeriod(supabase, clinicId, from, to);

  const caseIds = [
    ...new Set(
      ops
        .map((o) => o.treatment_case_id?.trim())
        .filter((id): id is string => !!id)
    ),
  ];
  const paymentDoctorIds = [
    ...new Set(
      ops
        .filter((o) => num(o.paid_amount) > 0 && o.doctor_id)
        .map((o) => String(o.doctor_id))
    ),
  ];

  const [expensesRes, doctorsRes, casesRes, paymentDoctorsRes] =
    await Promise.all([
      supabase
        .from("expenses")
        .select("amount, expense_kind, expense_categories(name_ar)")
        .eq("clinic_id", clinicId)
        .gte("expense_date", from)
        .lte("expense_date", to),
      supabase
        .from("doctors")
        .select("id, full_name_ar")
        .eq("clinic_id", clinicId)
        .eq("is_active", true)
        .order("full_name_ar"),
      caseIds.length
        ? supabase
            .from("patient_treatment_cases")
            .select(
              "id, clinic_share_total, doctor_share_total, final_price"
            )
            .in("id", caseIds)
        : Promise.resolve({ data: [] as Record<string, unknown>[] }),
      paymentDoctorIds.length
        ? supabase
            .from("doctors")
            .select(
              DOCTOR_FINANCE_SELECT
            )
            .in("id", paymentDoctorIds)
        : Promise.resolve({ data: [] as Record<string, unknown>[] }),
    ]);

  const caseById = new Map(
    (casesRes.data ?? []).map((row) => [String(row.id), row])
  );
  const paymentDoctorById = new Map<string, Doctor>();
  for (const doc of paymentDoctorsRes.data ?? []) {
    paymentDoctorById.set(String(doc.id), doc as Doctor);
  }

  type DoctorAgg = {
    doctor_id: string;
    full_name_ar: string;
    collected: number;
    payment_count: number;
    revenue: number;
    clinic_share: number;
    doctor_share: number;
    op_count: number;
  };

  const doctorById = new Map<string, DoctorAgg>();
  for (const doc of doctorsRes.data ?? []) {
    doctorById.set(String(doc.id), {
      doctor_id: String(doc.id),
      full_name_ar: String(doc.full_name_ar ?? "طبيب"),
      collected: 0,
      payment_count: 0,
      revenue: 0,
      clinic_share: 0,
      doctor_share: 0,
      op_count: 0,
    });
  }

  type ServiceAgg = {
    service_name: string;
    count: number;
    revenue: number;
    clinic_margin_total: number;
  };
  const serviceByName = new Map<string, ServiceAgg>();

  const doctorsWithPayments = new Set<string>();

  for (const op of ops) {
    const doctorId = op.doctor_id ? String(op.doctor_id) : "";
    if (!doctorId) continue;

    let agg = doctorById.get(doctorId);
    if (!agg) {
      agg = {
        doctor_id: doctorId,
        full_name_ar: "طبيب",
        collected: 0,
        payment_count: 0,
        revenue: 0,
        clinic_share: 0,
        doctor_share: 0,
        op_count: 0,
      };
      doctorById.set(doctorId, agg);
    }

    const paid = num(op.paid_amount);
    const total = num(op.total_amount);
    agg.op_count += 1;
    agg.revenue += total > 0 ? total : paid;

    if (paid > 0) {
      const caseId = op.treatment_case_id?.trim();
      const caseRow = caseId ? caseById.get(caseId) : undefined;
      const doctor = paymentDoctorById.get(doctorId) ?? null;
      const split = resolveOperationPaymentSplit(op, doctor, caseRow ?? null);

      agg.collected += paid;
      agg.payment_count += 1;
      agg.clinic_share += split.clinicShare;
      agg.doctor_share += split.doctorShare;
      doctorsWithPayments.add(doctorId);
    }

    const serviceName = opName(op).trim() || "جلسة";
    const svc = serviceByName.get(serviceName) ?? {
      service_name: serviceName,
      count: 0,
      revenue: 0,
      clinic_margin_total: 0,
    };
    svc.count += 1;
    const svcRevenue = total > 0 ? total : paid;
    svc.revenue += svcRevenue;
    if (svcRevenue > 0 && paid > 0) {
      const caseId = op.treatment_case_id?.trim();
      const caseRow = caseId ? caseById.get(caseId) : undefined;
      const doctor = paymentDoctorById.get(doctorId) ?? null;
      const split = resolveOperationPaymentSplit(op, doctor, caseRow ?? null);
      svc.clinic_margin_total += (split.clinicShare / svcRevenue) * 100;
    } else if (svcRevenue > 0) {
      svc.clinic_margin_total +=
        (num(op.clinic_share_amount) / svcRevenue) * 100;
    }
    serviceByName.set(serviceName, svc);
  }

  const top_doctors = [...doctorById.values()]
    .filter((d) => d.op_count > 0)
    .sort(
      (a, b) =>
        b.collected - a.collected ||
        b.payment_count - a.payment_count ||
        b.op_count - a.op_count
    )
    .map((d) => ({
      ...d,
      collected: roundMoney(d.collected),
      revenue: roundMoney(d.revenue),
      clinic_share: roundMoney(d.clinic_share),
      doctor_share: roundMoney(d.doctor_share),
    }));

  const top_services = [...serviceByName.values()]
    .sort((a, b) => b.revenue - a.revenue)
    .slice(0, 5)
    .map((s) => ({
      service_name: s.service_name,
      count: s.count,
      revenue: roundMoney(s.revenue),
      avg_price: roundMoney(s.count > 0 ? s.revenue / s.count : 0),
      clinic_margin_pct:
        s.count > 0 ? roundMoney(s.clinic_margin_total / s.count) : 0,
    }));

  type ExpenseRow = {
    amount: number;
    expense_kind?: string | null;
    expense_categories?: { name_ar?: string | null } | null;
  };
  const expenseByCategory = new Map<
    string,
    { category: string; total: number; count: number }
  >();
  for (const row of (expensesRes.data ?? []) as ExpenseRow[]) {
    if ((row.expense_kind ?? "general") === "doctor_salary") continue;
    const category =
      row.expense_categories?.name_ar?.trim() || "غير مصنف";
    const entry = expenseByCategory.get(category) ?? {
      category,
      total: 0,
      count: 0,
    };
    entry.total += num(row.amount);
    entry.count += 1;
    expenseByCategory.set(category, entry);
  }

  const top_expenses = [...expenseByCategory.values()]
    .sort((a, b) => b.total - a.total)
    .slice(0, 5)
    .map((e) => ({
      category: e.category,
      total: roundMoney(e.total),
      count: e.count,
    }));

  const inactive_doctors = [...doctorById.values()]
    .filter((d) => !doctorsWithPayments.has(d.doctor_id))
    .map((d) => ({
      doctor_id: d.doctor_id,
      full_name_ar: d.full_name_ar,
    }))
    .sort((a, b) => a.full_name_ar.localeCompare(b.full_name_ar, "ar"));

  return {
    top_doctors,
    top_services,
    top_expenses,
    inactive_doctors,
  };
}

/** عدد المرضى الجدد في الفترة — تقويم محلي */
export async function fetchNewPatientsInPeriod(
  supabase: SupabaseClient,
  clinicId: string,
  from: string,
  to: string
): Promise<number> {
  const { startIso, endIso } = localPeriodUtcBounds(from, to);
  const { count } = await supabase
    .from("patients")
    .select("*", { count: "exact", head: true })
    .eq("clinic_id", clinicId)
    .gte("created_at", startIso)
    .lte("created_at", endIso);

  return count ?? 0;
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
