import type { SupabaseClient } from "@supabase/supabase-js";
import {
  FINANCIAL_EPSILON,
  computeLiveDoctorShare,
  doctorPaymentPct,
} from "@/lib/services/patient-financial-plan";
import {
  isDailyWageAssistant,
  normalizeAssistantCompensationMode,
} from "@/lib/services/assistant-compensation";
import { isSalaryDoctor } from "@/lib/services/doctor-payment";
import { assistantPendingDoctorShare } from "@/lib/services/payroll-paid-portions";
import {
  fetchDoctorMonthSalaryBreakdown,
  fetchDoctorSalaryBreakdownsBatch,
} from "@/lib/services/salary-entry-display";
import {
  fetchDoctorBalanceTopupsTotal,
  groupDoctorBalanceTopupsByDoctor,
  BALANCE_TOPUP_DOCTOR_TYPE,
} from "@/lib/services/balance-topup";
import { currentMonthYear, monthDateRange } from "@/lib/utils";
import { DOCTOR_FINANCE_SELECT } from "@/lib/services/doctor-db-select";
import type { Doctor, PayrollRecord } from "@/types";

export interface DoctorWalletStats {
  totalEarnings: number;
  totalWithdrawn: number;
  pendingAmount: number;
  approvedAmount: number;
  expenseDeductions: number;
  payrollDeductions: number;
  /** رصيد محاسبي بعد الصرفيات والرواتب — قد يكون سالباً (مدين) */
  availableBalance: number;
  /** أقصى مبلغ سحب جديد — صفر إذا الرصيد سالب */
  withdrawableLimit: number;
  isDebtor: boolean;
}

type WithdrawalRow = {
  amount: number | string;
  status: string;
  requested_at?: string;
  processed_at?: string | null;
};

export function withdrawalEffectiveDate(row: WithdrawalRow): string {
  return (row.processed_at ?? row.requested_at ?? "").slice(0, 10);
}

export function filterWithdrawalsInPeriod<T extends WithdrawalRow>(
  rows: T[] | null | undefined,
  period?: { from: string; to: string }
): T[] {
  if (!period) return rows ?? [];
  return (rows ?? []).filter((r) => {
    const date = withdrawalEffectiveDate(r);
    return Boolean(date && date >= period.from && date <= period.to);
  });
}

function sumWithdrawalsByStatus(
  rows: WithdrawalRow[] | undefined,
  statuses: string[],
  period?: { from: string; to: string }
): number {
  return (rows ?? [])
    .filter((r) => {
      if (!statuses.includes(r.status)) return false;
      if (!period) return true;
      const date = withdrawalEffectiveDate(r);
      return Boolean(date && date >= period.from && date <= period.to);
    })
    .reduce((s, r) => s + Number(r.amount ?? 0), 0);
}

type OperationEarningRow = {
  doctor_share_amount?: number | string | null;
  clinic_share_amount?: number | string | null;
  paid_amount?: number | string | null;
  materials_cost?: number | string | null;
  review_fee_amount?: number | string | null;
  is_review_statement?: boolean | null;
  patient_treatment_cases?:
    | {
        doctor_share_total?: number;
        clinic_share_total?: number;
        final_price?: number;
      }
    | {
        doctor_share_total?: number;
        clinic_share_total?: number;
        final_price?: number;
      }[]
    | null;
};

/** يستنتج مبلغ الكشفية عند غياب review_fee_amount في السجل */
export function resolveReviewFeeOnOperation(
  row: {
    paid_amount?: number | string | null;
    review_fee_amount?: number | string | null;
    is_review_statement?: boolean | null;
  },
  clinicDefaultReviewFee = 0
): number {
  const paid = Number(row.paid_amount ?? 0);
  const stored = Number(row.review_fee_amount ?? 0);
  if (stored > FINANCIAL_EPSILON) return stored;
  if (!row.is_review_statement || paid <= FINANCIAL_EPSILON) return 0;

  const clinicFee = Math.max(0, Number(clinicDefaultReviewFee ?? 0));
  if (clinicFee > FINANCIAL_EPSILON && paid > clinicFee + FINANCIAL_EPSILON) {
    return clinicFee;
  }
  return paid;
}

/** كشفية فقط — بدون مبلغ علاج ضمن نفس الدفعة */
export function isReviewFeeOnlyPayment(
  row: {
    paid_amount?: number | string | null;
    review_fee_amount?: number | string | null;
    is_review_statement?: boolean | null;
  },
  clinicDefaultReviewFee = 0
): boolean {
  const paid = Number(row.paid_amount ?? 0);
  if (paid <= FINANCIAL_EPSILON) return false;

  const reviewFee = resolveReviewFeeOnOperation(row, clinicDefaultReviewFee);
  if (reviewFee > FINANCIAL_EPSILON) {
    return paid <= reviewFee + FINANCIAL_EPSILON;
  }

  return false;
}

/**
 * مبلغ العلاج لحساب حصة الطبيب.
 * paid_amount = المجموع المحصّل (علاج + كشفية) — نطرح الكشفية دائماً.
 */
export function treatmentPaidForDoctorShare(
  row: {
    paid_amount?: number | string | null;
    review_fee_amount?: number | string | null;
    is_review_statement?: boolean | null;
  },
  clinicDefaultReviewFee = 0
): number {
  const paid = Number(row.paid_amount ?? 0);
  if (paid <= FINANCIAL_EPSILON) return 0;

  const reviewFee = resolveReviewFeeOnOperation(row, clinicDefaultReviewFee);

  if (
    isReviewFeeOnlyPayment(
      {
        paid_amount: paid,
        review_fee_amount: reviewFee,
        is_review_statement: row.is_review_statement,
      },
      clinicDefaultReviewFee
    )
  ) {
    return 0;
  }

  if (reviewFee > FINANCIAL_EPSILON && paid > reviewFee + FINANCIAL_EPSILON) {
    return Math.max(0, paid - reviewFee);
  }

  return paid;
}

function roundMoney(n: number): number {
  return Math.round(n * 100) / 100;
}

export function calcOperationEarned(
  row: OperationEarningRow,
  doctorPct: number,
  salaryDoctor = false,
  doctor?: Doctor | null,
  clinicDefaultReviewFee = 0
): number {
  if (salaryDoctor) return 0;

  const paid = Number(row.paid_amount ?? 0);
  if (paid <= 0) return 0;

  const treatmentPaid = treatmentPaidForDoctorShare(row, clinicDefaultReviewFee);
  if (treatmentPaid <= FINANCIAL_EPSILON) return 0;

  // نسبة الطبيب من ملفه أولاً — لا نعتمد حصة مخزّنة 50/50 خاطئة
  if (doctor) {
    return computeLiveDoctorShare(
      treatmentPaid,
      doctor,
      Number(row.materials_cost ?? 0)
    );
  }

  const maxShare = roundMoney(treatmentPaid * doctorPct);
  const tc = row.patient_treatment_cases;
  const caseRow = Array.isArray(tc) ? tc[0] : tc;
  const finalPrice = Number(caseRow?.final_price ?? 0);
  const caseDoc = Number(caseRow?.doctor_share_total ?? 0);

  if (finalPrice > 0 && caseDoc > 0 && caseDoc <= finalPrice) {
    return Math.min(
      roundMoney(treatmentPaid * (caseDoc / finalPrice)),
      maxShare
    );
  }

  return maxShare;
}

/** حصة العيادة من جلسة — يطابق calc_clinic_operation_earned في Postgres */
export function calcClinicOperationEarned(
  row: OperationEarningRow & { clinic_share_amount?: number | string | null },
  doctorPct: number,
  salaryDoctor = false
): number {
  const direct = Number(row.clinic_share_amount ?? 0);
  if (direct !== 0) {
    return Math.round(direct * 100) / 100;
  }

  const paid = Number(row.paid_amount ?? 0);
  if (paid <= 0) return 0;

  const tc = row.patient_treatment_cases;
  const caseRow = Array.isArray(tc) ? tc[0] : tc;
  const finalPrice = Number(caseRow?.final_price ?? 0);
  const caseClinic = Number(
    (caseRow as { clinic_share_total?: number } | undefined)
      ?.clinic_share_total ?? 0
  );

  if (finalPrice > 0) {
    return Math.round(paid * (caseClinic / finalPrice) * 100) / 100;
  }

  const doctorEarned = calcOperationEarned(row, doctorPct, salaryDoctor);
  return Math.round((paid - doctorEarned) * 100) / 100;
}

/** حصة الطبيب لزيارة واحدة — لا تتجاوز النسبة × مبلغ العلاج (بدون الكشفية) */
export function computeVisitDoctorShare(
  ops: OperationEarningRow[],
  doctorPct: number,
  visitPaidTotal: number,
  salaryDoctor = false,
  doctor?: Doctor | null
): number {
  if (salaryDoctor || ops.length === 0) {
    return 0;
  }

  const treatmentVisitPaid = ops.reduce(
    (sum, row) => sum + treatmentPaidForDoctorShare(row),
    0
  );
  if (treatmentVisitPaid <= FINANCIAL_EPSILON) {
    return 0;
  }

  const maxShare = roundMoney(treatmentVisitPaid * doctorPct);
  const fromOps = ops.reduce(
    (sum, row) =>
      sum + calcOperationEarned(row, doctorPct, salaryDoctor, doctor),
    0
  );
  return Math.min(roundMoney(fromOps), maxShare);
}

export interface WalletStatsOptions {
  expenseDeductions?: number;
  payrollDeductions?: number;
  /** شحن رصيد يدوي — يُضاف للرصيد المتاح */
  balanceCredits?: number;
  /** مبالغ راتب مُصرفة — تُحسب كـ «مسحوب» لأطباء الراتب */
  salaryWithdrawn?: number;
  /** محاسبة راتب ثابت — لا تُستخدم طلبات السحب التقليدية */
  salaryLedger?: boolean;
}

/** مجموع رواتب الأطباء المُصرفة (من الحركات المالية أو المصروفات) */
export async function fetchDoctorSalaryPayoutsTotal(
  supabase: SupabaseClient,
  doctorId: string,
  from?: string,
  to?: string
): Promise<number> {
  const map = await fetchDoctorSalaryPayoutsByDoctor(
    supabase,
    [doctorId],
    from,
    to
  );
  return map.get(doctorId) ?? 0;
}

export async function fetchDoctorSalaryPayoutsByDoctor(
  supabase: SupabaseClient,
  doctorIds: string[],
  from?: string,
  to?: string
): Promise<Map<string, number>> {
  const map = initDoctorNumberMap(doctorIds);
  if (!doctorIds.length) return map;

  let txQuery = supabase
    .from("transactions")
    .select("doctor_id, amount")
    .in("doctor_id", doctorIds)
    .eq("type", "doctor_salary_paid")
    .lt("amount", 0);

  if (from) txQuery = txQuery.gte("transaction_date", from);
  if (to) txQuery = txQuery.lte("transaction_date", to);

  const { data: txRows } = await txQuery;

  for (const row of txRows ?? []) {
    const id = row.doctor_id as string;
    map.set(id, (map.get(id) ?? 0) + Math.abs(Number(row.amount ?? 0)));
  }

  for (const [id, total] of map) {
    map.set(id, Math.round(total * 100) / 100);
  }
  return map;
}

export interface DoctorSalaryPayoutRecord {
  id: string;
  amount: number;
  payoutDate: string;
  descriptionAr: string;
}

export async function fetchDoctorSalaryPayoutRecords(
  supabase: SupabaseClient,
  doctorId: string,
  from?: string,
  to?: string
): Promise<DoctorSalaryPayoutRecord[]> {
  let q = supabase
    .from("transactions")
    .select("id, amount, transaction_date, description_ar")
    .eq("doctor_id", doctorId)
    .eq("type", "doctor_salary_paid")
    .lt("amount", 0)
    .order("transaction_date", { ascending: false });

  if (from) q = q.gte("transaction_date", from);
  if (to) q = q.lte("transaction_date", to);

  const { data } = await q;
  return (data ?? []).map((row) => ({
    id: row.id as string,
    amount: Math.abs(Number(row.amount ?? 0)),
    payoutDate: row.transaction_date as string,
    descriptionAr: (row.description_ar as string) || "صرف راتب",
  }));
}

export function computeSalaryDoctorWithdrawable(
  salaryDue: number,
  salaryPaid: number
): number {
  return Math.max(0, Math.round((salaryDue - salaryPaid) * 100) / 100);
}

export async function fetchDoctorExpenseDeductionsTotal(
  supabase: SupabaseClient,
  doctorId: string
): Promise<number> {
  const { data } = await supabase
    .from("transactions")
    .select("amount")
    .eq("doctor_id", doctorId)
    .eq("type", "doctor_expense_doctor")
    .lt("amount", 0);

  return (data ?? []).reduce(
    (s, row) => s + Math.abs(Number(row.amount ?? 0)),
    0
  );
}

/** خصومات رواتب المساعدين — صرف مؤكّد ناقص تصحيحات (حركات سالبة − موجبة) */
export async function fetchDoctorPayrollDeductionsTotal(
  supabase: SupabaseClient,
  doctorId: string
): Promise<number> {
  const { data: txns } = await supabase
    .from("transactions")
    .select("amount")
    .eq("doctor_id", doctorId)
    .eq("type", "assistant_payroll_doctor");

  return netPayrollDeductionFromRows(txns);
}

function netPayrollDeductionFromRows(
  rows: { amount: number | string }[] | null | undefined
): number {
  let total = 0;
  for (const row of rows ?? []) {
    const amt = Number(row.amount ?? 0);
    if (amt < 0) total += Math.abs(amt);
    else if (amt > 0) total -= amt;
  }
  return Math.round(Math.max(0, total) * 100) / 100;
}

/** حصة الطبيب من أجور مساعديه المسجّلة ولم تُصرف بعد */
export async function fetchDoctorPendingAssistantPayrollDeductions(
  supabase: SupabaseClient,
  doctorId: string
): Promise<number> {
  const { data, error } = await supabase
    .from("payroll_records")
    .select(
      `
      doctor_share_amount,
      paid_doctor_share_amount,
      clinic_share_amount,
      paid_clinic_share_amount,
      total_salary,
      paid_total_salary,
      status,
      assistant:assistants!assistant_id(compensation_mode)
    `
    )
    .eq("doctor_id", doctorId);

  if (error || !data?.length) return 0;

  let total = 0;
  for (const row of data) {
    const assistantRaw = row.assistant;
    const assistant = Array.isArray(assistantRaw)
      ? assistantRaw[0]
      : assistantRaw;
    const dailyWage = isDailyWageAssistant(
      normalizeAssistantCompensationMode(
        (assistant as { compensation_mode?: string } | null)
          ?.compensation_mode
      )
    );
    total += assistantPendingDoctorShare(
      row as Pick<
        PayrollRecord,
        | "doctor_share_amount"
        | "paid_doctor_share_amount"
        | "clinic_share_amount"
        | "paid_clinic_share_amount"
        | "total_salary"
        | "paid_total_salary"
        | "status"
      >,
      { dailyWage }
    );
  }

  return Math.round(total * 100) / 100;
}

/** خصومات مساعدين — مؤكّدة + مسجّلة (أجر يومي قبل الصرف) */
export async function fetchDoctorTotalPayrollDeductions(
  supabase: SupabaseClient,
  doctorId: string
): Promise<number> {
  const [confirmed, pending] = await Promise.all([
    fetchDoctorPayrollDeductionsTotal(supabase, doctorId),
    fetchDoctorPendingAssistantPayrollDeductions(supabase, doctorId),
  ]);
  return Math.round((confirmed + pending) * 100) / 100;
}

async function fetchPendingAssistantPayrollByDoctor(
  supabase: SupabaseClient,
  doctorIds: string[]
): Promise<Map<string, number>> {
  const map = new Map<string, number>();
  if (!doctorIds.length) return map;

  const { data, error } = await supabase
    .from("payroll_records")
    .select(
      `
      doctor_id,
      doctor_share_amount,
      paid_doctor_share_amount,
      clinic_share_amount,
      paid_clinic_share_amount,
      total_salary,
      paid_total_salary,
      status,
      assistant:assistants!assistant_id(compensation_mode)
    `
    )
    .in("doctor_id", doctorIds);

  if (error || !data?.length) return map;

  for (const row of data) {
    const doctorId = String(row.doctor_id ?? "");
    if (!doctorId) continue;
    const assistantRaw = row.assistant;
    const assistant = Array.isArray(assistantRaw)
      ? assistantRaw[0]
      : assistantRaw;
    const dailyWage = isDailyWageAssistant(
      normalizeAssistantCompensationMode(
        (assistant as { compensation_mode?: string } | null)
          ?.compensation_mode
      )
    );
    const pending = assistantPendingDoctorShare(
      row as Pick<
        PayrollRecord,
        | "doctor_share_amount"
        | "paid_doctor_share_amount"
        | "clinic_share_amount"
        | "paid_clinic_share_amount"
        | "total_salary"
        | "paid_total_salary"
        | "status"
      >,
      {
        dailyWage,
      }
    );
    if (pending <= FINANCIAL_EPSILON) continue;
    map.set(doctorId, Math.round(((map.get(doctorId) ?? 0) + pending) * 100) / 100);
  }

  return map;
}

export function computeWalletStats(
  totalEarnings: number,
  withdrawals: WithdrawalRow[],
  options?: WalletStatsOptions
): DoctorWalletStats {
  let totalWithdrawn = 0;
  let pendingAmount = 0;
  let approvedAmount = 0;

  const salaryLedger = options?.salaryLedger ?? false;
  const salaryWithdrawn = Math.round((options?.salaryWithdrawn ?? 0) * 100) / 100;

  if (salaryLedger) {
    totalWithdrawn = salaryWithdrawn;
  } else {
    for (const w of withdrawals) {
      const amt = Number(w.amount ?? 0);
      if (w.status === "paid") totalWithdrawn += amt;
      else if (w.status === "pending") pendingAmount += amt;
      else if (w.status === "approved") approvedAmount += amt;
    }
  }

  const round = (n: number) => Math.round(n * 100) / 100;
  const earned = round(totalEarnings);
  const expenseDeductions = round(options?.expenseDeductions ?? 0);
  const payrollDeductions = round(options?.payrollDeductions ?? 0);
  const balanceCredits = round(options?.balanceCredits ?? 0);

  const netAccounting = round(
    earned -
      totalWithdrawn -
      approvedAmount -
      expenseDeductions -
      payrollDeductions
  );
  const effectiveNet = round(netAccounting + balanceCredits);

  const baseWithdrawable = salaryLedger
    ? computeSalaryDoctorWithdrawable(earned, totalWithdrawn)
    : netAccounting - pendingAmount;
  const withdrawableLimit = round(Math.max(0, baseWithdrawable + balanceCredits));

  return {
    totalEarnings: earned,
    totalWithdrawn: round(totalWithdrawn),
    pendingAmount: round(pendingAmount),
    approvedAmount: round(approvedAmount),
    expenseDeductions,
    payrollDeductions,
    availableBalance: salaryLedger
      ? round(baseWithdrawable + balanceCredits)
      : effectiveNet,
    withdrawableLimit,
    isDebtor: effectiveNet < 0,
  };
}

const OPERATION_EARNINGS_SELECT =
  "doctor_share_amount, clinic_share_amount, paid_amount, materials_cost, review_fee_amount, is_review_statement, treatment_case_id, operation_date, patient_treatment_cases(doctor_share_total, clinic_share_total, final_price)";

const OPERATION_EARNINGS_BATCH_SELECT =
  "doctor_id, doctor_share_amount, clinic_share_amount, paid_amount, materials_cost, review_fee_amount, is_review_statement, treatment_case_id, operation_date, patient_treatment_cases(doctor_share_total, clinic_share_total, final_price)";

type OperationEarningBatchRow = OperationEarningRow & { doctor_id: string };

type DoctorPaymentMeta = { pct: number; isSalary: boolean; doctor: Doctor | null };

async function fetchDoctorPaymentMap(
  supabase: SupabaseClient,
  doctorIds: string[]
): Promise<Map<string, DoctorPaymentMeta>> {
  const map = new Map<string, DoctorPaymentMeta>();
  if (!doctorIds.length) return map;

  const { data } = await supabase
    .from("doctors")
    .select(
      DOCTOR_FINANCE_SELECT
    )
    .in("id", doctorIds);

  for (const row of data ?? []) {
    const doctor = row as Doctor;
    map.set(row.id, {
      pct: doctorPaymentPct(doctor),
      isSalary: isSalaryDoctor({ payment_type: doctor.payment_type }),
      doctor,
    });
  }
  return map;
}

function initDoctorNumberMap(
  doctorIds: string[],
  initial = 0
): Map<string, number> {
  return new Map(doctorIds.map((id) => [id, initial]));
}

/** أرباح عدة أطباء — استعلام واحد للجلسات + نسب الأطباء */
export async function computeEarningsFromOperationsForDoctors(
  supabase: SupabaseClient,
  doctorIds: string[],
  from?: string,
  to?: string
): Promise<Map<string, number>> {
  const sums = initDoctorNumberMap(doctorIds);
  if (!doctorIds.length) return sums;

  let opsQuery = supabase
    .from("patient_operations")
    .select(OPERATION_EARNINGS_BATCH_SELECT)
    .in("doctor_id", doctorIds);

  if (from) opsQuery = opsQuery.gte("operation_date", from);
  if (to) opsQuery = opsQuery.lte("operation_date", to);

  const [paymentMap, opsRes] = await Promise.all([
    fetchDoctorPaymentMap(supabase, doctorIds),
    opsQuery,
  ]);

  const clinicIds = [
    ...new Set(
      [...paymentMap.values()]
        .map((m) => (m.doctor as { clinic_id?: string } | null)?.clinic_id)
        .filter((id): id is string => !!id)
    ),
  ];
  const clinicReviewFeeById = new Map<string, number>();
  await Promise.all(
    clinicIds.map(async (clinicId) => {
      const fee = await loadClinicReviewFeeForDoctor(supabase, clinicId);
      clinicReviewFeeById.set(clinicId, fee);
    })
  );

  for (const row of (opsRes.data ?? []) as OperationEarningBatchRow[]) {
    const meta = paymentMap.get(row.doctor_id);
    if (!meta) continue;
    const clinicId = (meta.doctor as { clinic_id?: string } | null)?.clinic_id;
    const clinicReviewFee = clinicId
      ? (clinicReviewFeeById.get(clinicId) ?? 0)
      : 0;
    const prev = sums.get(row.doctor_id) ?? 0;
    sums.set(
      row.doctor_id,
      prev +
        calcOperationEarned(
          row,
          meta.pct,
          meta.isSalary,
          meta.doctor,
          clinicReviewFee
        )
    );
  }

  for (const [id, total] of sums) {
    sums.set(id, Math.round(total * 100) / 100);
  }
  return sums;
}

/** عدد جلسات كل طبيب — استعلام خفيف بدون join */
export async function fetchOperationCountsByDoctor(
  supabase: SupabaseClient,
  clinicId: string,
  doctorIds: string[],
  range?: { from: string; to: string }
): Promise<Map<string, number>> {
  const counts = initDoctorNumberMap(doctorIds);
  if (!doctorIds.length) return counts;

  let q = supabase
    .from("patient_operations")
    .select("doctor_id")
    .eq("clinic_id", clinicId)
    .in("doctor_id", doctorIds);

  if (range) {
    q = q.gte("operation_date", range.from).lte("operation_date", range.to);
  }

  const { data } = await q;
  for (const row of data ?? []) {
    const id = row.doctor_id as string;
    counts.set(id, (counts.get(id) ?? 0) + 1);
  }
  return counts;
}

function groupWithdrawalsByDoctor(
  rows: { doctor_id: string; amount: number | string; status: string }[] | null
): Map<string, WithdrawalRow[]> {
  const map = new Map<string, WithdrawalRow[]>();
  for (const row of rows ?? []) {
    const list = map.get(row.doctor_id) ?? [];
    list.push({ amount: row.amount, status: row.status });
    map.set(row.doctor_id, list);
  }
  return map;
}

function groupDeductionsByDoctor(
  rows: { doctor_id: string; amount: number | string }[] | null
): Map<string, number> {
  const map = new Map<string, number>();
  for (const row of rows ?? []) {
    const id = row.doctor_id;
    map.set(id, (map.get(id) ?? 0) + Math.abs(Number(row.amount ?? 0)));
  }
  return map;
}

function groupPayrollDeductionsByDoctor(
  rows: { doctor_id: string; amount: number | string }[] | null
): Map<string, number> {
  const map = new Map<string, number>();
  for (const row of rows ?? []) {
    const id = row.doctor_id;
    const prev = map.get(id) ?? 0;
    const amt = Number(row.amount ?? 0);
    const next =
      amt < 0 ? prev + Math.abs(amt) : amt > 0 ? prev - amt : prev;
    map.set(id, Math.round(Math.max(0, next) * 100) / 100);
  }
  return map;
}

/** محافظ عدة أطباء — استعلامات مجمّعة */
export async function fetchDoctorWalletStatsBatch(
  supabase: SupabaseClient,
  doctorIds: string[],
  period?: { from: string; to: string }
): Promise<Map<string, DoctorWalletStats>> {
  const result = new Map<string, DoctorWalletStats>();
  if (!doctorIds.length) return result;

  const range = period ?? monthDateRange(currentMonthYear());

  const [
    earningsMap,
    withdrawalsRes,
    expenseRows,
    payrollRows,
    topupRows,
    pendingPayrollByDoctor,
    paymentMap,
    salaryPayoutsMap,
    doctorsRes,
  ] = await Promise.all([
    computeEarningsFromOperationsForDoctors(
      supabase,
      doctorIds,
      period?.from,
      period?.to
    ),
    supabase
      .from("doctor_withdrawals")
      .select("doctor_id, amount, status")
      .in("doctor_id", doctorIds)
      .neq("status", "rejected"),
    supabase
      .from("transactions")
      .select("doctor_id, amount")
      .in("doctor_id", doctorIds)
      .eq("type", "doctor_expense_doctor")
      .lt("amount", 0),
    supabase
      .from("transactions")
      .select("doctor_id, amount")
      .in("doctor_id", doctorIds)
      .eq("type", "assistant_payroll_doctor"),
    supabase
      .from("transactions")
      .select("doctor_id, amount")
      .in("doctor_id", doctorIds)
      .eq("type", BALANCE_TOPUP_DOCTOR_TYPE)
      .gt("amount", 0),
    fetchPendingAssistantPayrollByDoctor(supabase, doctorIds),
    fetchDoctorPaymentMap(supabase, doctorIds),
    fetchDoctorSalaryPayoutsByDoctor(
      supabase,
      doctorIds,
      range.from,
      range.to
    ),
    supabase
      .from("doctors")
      .select("id, payment_type, salary_amount, clinic_id")
      .in("id", doctorIds),
  ]);

  const salaryByDoctor = new Map<string, number>();
  const salaryDoctorIds: string[] = [];
  let salaryClinicId: string | null = null;
  for (const row of doctorsRes.data ?? []) {
    salaryByDoctor.set(row.id, Number(row.salary_amount ?? 0));
    if (isSalaryDoctor({ payment_type: row.payment_type })) {
      salaryDoctorIds.push(row.id as string);
      salaryClinicId ??= row.clinic_id as string;
    }
  }

  const monthYear = range.from.slice(0, 7);
  const salaryBreakdowns =
    salaryDoctorIds.length > 0 && salaryClinicId
      ? await fetchDoctorSalaryBreakdownsBatch(
          supabase,
          salaryClinicId,
          salaryDoctorIds,
          monthYear,
          salaryByDoctor
        )
      : new Map();

  const withdrawalsByDoctor = groupWithdrawalsByDoctor(withdrawalsRes.data);
  const expenseByDoctor = groupDeductionsByDoctor(expenseRows.data);
  const payrollByDoctor = groupPayrollDeductionsByDoctor(payrollRows.data);
  const topupByDoctor = groupDoctorBalanceTopupsByDoctor(topupRows.data);

  for (const doctorId of doctorIds) {
    const meta = paymentMap.get(doctorId) ?? { pct: 0.5, isSalary: false };
    const payrollDeductions = Math.round(
      ((payrollByDoctor.get(doctorId) ?? 0) +
        (pendingPayrollByDoctor.get(doctorId) ?? 0)) *
        100
    ) / 100;
    const balanceCredits = topupByDoctor.get(doctorId) ?? 0;

    if (meta.isSalary) {
      const earned =
        salaryBreakdowns.get(doctorId)?.netPayout ??
        salaryByDoctor.get(doctorId) ??
        0;
      result.set(
        doctorId,
        computeWalletStats(earned, [], {
          salaryLedger: true,
          salaryWithdrawn: salaryPayoutsMap.get(doctorId) ?? 0,
          expenseDeductions: expenseByDoctor.get(doctorId) ?? 0,
          payrollDeductions,
          balanceCredits,
        })
      );
      continue;
    }

    result.set(
      doctorId,
      computeWalletStats(
        earningsMap.get(doctorId) ?? 0,
        withdrawalsByDoctor.get(doctorId) ?? [],
        {
          expenseDeductions: expenseByDoctor.get(doctorId) ?? 0,
          payrollDeductions,
          balanceCredits,
        }
      )
    );
  }

  return result;
}

/** مجموع السحوبات (موافق + مدفوع) والمعلّق — استعلام واحد */
export async function fetchWithdrawalSumsByDoctor(
  supabase: SupabaseClient,
  doctorIds: string[],
  period?: { from: string; to: string }
): Promise<
  Map<string, { totalWithdrawn: number; pendingWithdrawalAmount: number }>
> {
  const map = new Map<
    string,
    { totalWithdrawn: number; pendingWithdrawalAmount: number }
  >();
  if (!doctorIds.length) return map;

  const { data } = await supabase
    .from("doctor_withdrawals")
    .select("doctor_id, amount, status, requested_at, processed_at")
    .in("doctor_id", doctorIds);

  const byDoctor = groupWithdrawalsByDoctor(data);
  for (const doctorId of doctorIds) {
    const rows = byDoctor.get(doctorId);
    map.set(doctorId, {
      totalWithdrawn: sumWithdrawalsByStatus(rows, ["approved", "paid"], period),
      pendingWithdrawalAmount: sumWithdrawalsByStatus(rows, ["pending"], period),
    });
  }
  return map;
}

function sumOperationEarnings(
  rows: OperationEarningRow[] | null | undefined,
  doctorPct: number,
  salaryDoctor = false,
  doctor?: Doctor | null,
  clinicDefaultReviewFee = 0
): number {
  return (rows ?? []).reduce(
    (sum, row) =>
      sum +
      calcOperationEarned(
        row,
        doctorPct,
        salaryDoctor,
        doctor,
        clinicDefaultReviewFee
      ),
    0
  );
}

export async function loadClinicReviewFeeForDoctor(
  supabase: SupabaseClient,
  clinicId: string | null | undefined
): Promise<number> {
  if (!clinicId) return 0;
  const { data } = await supabase
    .from("clinics")
    .select("review_fee_enabled, review_fee_amount")
    .eq("id", clinicId)
    .maybeSingle();
  if (!data?.review_fee_enabled) return 0;
  return Math.max(0, Number(data.review_fee_amount ?? 0));
}

/** حساب الأرباح من الجلسات — نسبة الطبيب الحالية من ملفه (لا 50/50 افتراضي) */
export async function computeEarningsFromOperations(
  supabase: SupabaseClient,
  doctorId: string
): Promise<number> {
  const [opsRes, doctorRes] = await Promise.all([
    supabase
      .from("patient_operations")
      .select(OPERATION_EARNINGS_SELECT)
      .eq("doctor_id", doctorId),
    supabase
      .from("doctors")
      .select(
        DOCTOR_FINANCE_SELECT
      )
      .eq("id", doctorId)
      .maybeSingle(),
  ]);

  const doctorRow = (doctorRes.data as Doctor | null) ?? null;
  const pct = doctorPaymentPct(doctorRow);
  const salaryDoctor = isSalaryDoctor({
    payment_type: doctorRow?.payment_type,
  });
  const clinicReviewFee = await loadClinicReviewFeeForDoctor(
    supabase,
    (doctorRow as { clinic_id?: string } | null)?.clinic_id
  );
  return sumOperationEarnings(
    opsRes.data,
    pct,
    salaryDoctor,
    doctorRow,
    clinicReviewFee
  );
}

/** أرباح الطبيب لفترة محددة — للتقارير والتسوية الشهرية */
export async function computeEarningsFromOperationsForPeriod(
  supabase: SupabaseClient,
  doctorId: string,
  from?: string,
  to?: string
): Promise<number> {
  let opsQuery = supabase
    .from("patient_operations")
    .select(OPERATION_EARNINGS_SELECT)
    .eq("doctor_id", doctorId);

  if (from) opsQuery = opsQuery.gte("operation_date", from);
  if (to) opsQuery = opsQuery.lte("operation_date", to);

  const { data: doctorRaw } = await supabase
    .from("doctors")
    .select(
      DOCTOR_FINANCE_SELECT
    )
    .eq("id", doctorId)
    .maybeSingle();

  const doctorRow = (doctorRaw as Doctor | null) ?? null;
  const pct = doctorPaymentPct(doctorRow);
  const salaryDoctor = isSalaryDoctor({
    payment_type: doctorRow?.payment_type,
  });
  const clinicReviewFee = await loadClinicReviewFeeForDoctor(
    supabase,
    (doctorRow as { clinic_id?: string } | null)?.clinic_id
  );
  const { data: ops } = await opsQuery;
  return sumOperationEarnings(
    ops,
    pct,
    salaryDoctor,
    doctorRow,
    clinicReviewFee
  );
}

/** مستحقات الطبيب — من حصة كل دفعة (نسبة من doctor_share_total للحالة) */
export async function fetchDoctorTotalEarnings(
  supabase: SupabaseClient,
  doctorId: string
): Promise<number> {
  return computeEarningsFromOperations(supabase, doctorId);
}

export async function fetchDoctorWalletStats(
  supabase: SupabaseClient,
  doctorId: string,
  period?: { from: string; to: string }
): Promise<DoctorWalletStats> {
  const range = period ?? monthDateRange(currentMonthYear());

  const { data: doctor } = await supabase
    .from("doctors")
    .select("percentage, payment_type, salary_amount, clinic_id")
    .eq("id", doctorId)
    .maybeSingle();

  if (isSalaryDoctor({ payment_type: doctor?.payment_type })) {
    const [salaryPaid, expenseDeductions, payrollDeductions, balanceCredits, breakdown] =
      await Promise.all([
        fetchDoctorSalaryPayoutsTotal(
          supabase,
          doctorId,
          range.from,
          range.to
        ),
        fetchDoctorExpenseDeductionsTotal(supabase, doctorId),
        fetchDoctorTotalPayrollDeductions(supabase, doctorId),
        fetchDoctorBalanceTopupsTotal(supabase, doctorId),
        doctor?.clinic_id
          ? fetchDoctorMonthSalaryBreakdown(
              supabase,
              doctor.clinic_id as string,
              doctorId,
              range.from.slice(0, 7),
              Number(doctor?.salary_amount ?? 0)
            )
          : Promise.resolve(null),
      ]);

    const earned = breakdown?.netPayout ?? Number(doctor?.salary_amount ?? 0);

    return computeWalletStats(earned, [], {
      salaryLedger: true,
      salaryWithdrawn: salaryPaid,
      expenseDeductions,
      payrollDeductions,
      balanceCredits,
    });
  }

  const [totalEarnings, withdrawalsRes, expenseDeductions, payrollDeductions, balanceCredits] =
    await Promise.all([
      computeEarningsFromOperations(supabase, doctorId),
      supabase
        .from("doctor_withdrawals")
        .select("amount, status")
        .eq("doctor_id", doctorId)
        .neq("status", "rejected"),
      fetchDoctorExpenseDeductionsTotal(supabase, doctorId),
      fetchDoctorTotalPayrollDeductions(supabase, doctorId),
      fetchDoctorBalanceTopupsTotal(supabase, doctorId),
    ]);

  return computeWalletStats(totalEarnings, withdrawalsRes.data ?? [], {
    expenseDeductions,
    payrollDeductions,
    balanceCredits,
  });
}

/** Max amount the doctor can request right now (accounts for pending requests) */
export async function fetchDoctorWithdrawableLimit(
  supabase: SupabaseClient,
  doctorId: string
): Promise<number> {
  const stats = await fetchDoctorWalletStats(supabase, doctorId);
  return stats.withdrawableLimit;
}
