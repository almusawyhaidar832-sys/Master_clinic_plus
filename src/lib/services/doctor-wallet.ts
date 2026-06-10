import type { SupabaseClient } from "@supabase/supabase-js";
import { isSalaryDoctor } from "@/lib/services/doctor-payment";
import { currentMonthYear, monthDateRange } from "@/lib/utils";

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

type WithdrawalRow = { amount: number | string; status: string };

type OperationEarningRow = {
  doctor_share_amount?: number | string | null;
  paid_amount?: number | string | null;
  patient_treatment_cases?:
    | { doctor_share_total?: number; final_price?: number }
    | { doctor_share_total?: number; final_price?: number }[]
    | null;
};

export function calcOperationEarned(
  row: OperationEarningRow,
  doctorPct: number,
  salaryDoctor = false
): number {
  if (salaryDoctor) return 0;

  const direct = Number(row.doctor_share_amount ?? 0);
  if (direct !== 0) return Math.round(direct * 100) / 100;

  const paid = Number(row.paid_amount ?? 0);
  if (paid === 0) return 0;

  const tc = row.patient_treatment_cases;
  const caseRow = Array.isArray(tc) ? tc[0] : tc;
  const finalPrice = Number(caseRow?.final_price ?? 0);
  const caseDoc = Number(caseRow?.doctor_share_total ?? 0);

  if (finalPrice > 0 && caseDoc > 0) {
    return Math.round(paid * (caseDoc / finalPrice) * 100) / 100;
  }

  return Math.round(paid * doctorPct * 100) / 100;
}

export interface WalletStatsOptions {
  expenseDeductions?: number;
  payrollDeductions?: number;
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

/** خصومات رواتب المساعدين من الحركات المالية */
export async function fetchDoctorPayrollDeductionsTotal(
  supabase: SupabaseClient,
  doctorId: string
): Promise<number> {
  const { data: txns } = await supabase
    .from("transactions")
    .select("amount")
    .eq("doctor_id", doctorId)
    .eq("type", "assistant_payroll_doctor")
    .lt("amount", 0);

  return (txns ?? []).reduce(
    (s, t) => s + Math.abs(Number(t.amount ?? 0)),
    0
  );
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

  const netAccounting = round(
    earned -
      totalWithdrawn -
      approvedAmount -
      expenseDeductions -
      payrollDeductions
  );

  const withdrawableLimit = salaryLedger
    ? computeSalaryDoctorWithdrawable(earned, totalWithdrawn)
    : Math.max(0, netAccounting - pendingAmount);

  return {
    totalEarnings: earned,
    totalWithdrawn: round(totalWithdrawn),
    pendingAmount: round(pendingAmount),
    approvedAmount: round(approvedAmount),
    expenseDeductions,
    payrollDeductions,
    availableBalance: salaryLedger ? withdrawableLimit : netAccounting,
    withdrawableLimit: round(withdrawableLimit),
    isDebtor: netAccounting < 0,
  };
}

const OPERATION_EARNINGS_SELECT =
  "doctor_share_amount, paid_amount, treatment_case_id, operation_date, patient_treatment_cases(doctor_share_total, final_price)";

const OPERATION_EARNINGS_BATCH_SELECT =
  "doctor_id, doctor_share_amount, paid_amount, treatment_case_id, operation_date, patient_treatment_cases(doctor_share_total, final_price)";

type OperationEarningBatchRow = OperationEarningRow & { doctor_id: string };

type DoctorPaymentMeta = { pct: number; isSalary: boolean };

async function fetchDoctorPaymentMap(
  supabase: SupabaseClient,
  doctorIds: string[]
): Promise<Map<string, DoctorPaymentMeta>> {
  const map = new Map<string, DoctorPaymentMeta>();
  if (!doctorIds.length) return map;

  const { data } = await supabase
    .from("doctors")
    .select("id, percentage, payment_type")
    .in("id", doctorIds);

  for (const row of data ?? []) {
    map.set(row.id, {
      pct: Number(row.percentage ?? 50) / 100,
      isSalary: isSalaryDoctor({ payment_type: row.payment_type }),
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

  for (const row of (opsRes.data ?? []) as OperationEarningBatchRow[]) {
    const meta = paymentMap.get(row.doctor_id) ?? { pct: 0.5, isSalary: false };
    const prev = sums.get(row.doctor_id) ?? 0;
    sums.set(
      row.doctor_id,
      prev + calcOperationEarned(row, meta.pct, meta.isSalary)
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
      .eq("type", "assistant_payroll_doctor")
      .lt("amount", 0),
    fetchDoctorPaymentMap(supabase, doctorIds),
    fetchDoctorSalaryPayoutsByDoctor(
      supabase,
      doctorIds,
      range.from,
      range.to
    ),
    supabase
      .from("doctors")
      .select("id, payment_type, salary_amount")
      .in("id", doctorIds),
  ]);

  const salaryByDoctor = new Map<string, number>();
  for (const row of doctorsRes.data ?? []) {
    salaryByDoctor.set(row.id, Number(row.salary_amount ?? 0));
  }

  const withdrawalsByDoctor = groupWithdrawalsByDoctor(withdrawalsRes.data);
  const expenseByDoctor = groupDeductionsByDoctor(expenseRows.data);
  const payrollByDoctor = groupDeductionsByDoctor(payrollRows.data);

  for (const doctorId of doctorIds) {
    const meta = paymentMap.get(doctorId) ?? { pct: 0.5, isSalary: false };

    if (meta.isSalary) {
      const earned = salaryByDoctor.get(doctorId) ?? 0;
      result.set(
        doctorId,
        computeWalletStats(earned, [], {
          salaryLedger: true,
          salaryWithdrawn: salaryPayoutsMap.get(doctorId) ?? 0,
          expenseDeductions: expenseByDoctor.get(doctorId) ?? 0,
          payrollDeductions: payrollByDoctor.get(doctorId) ?? 0,
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
          payrollDeductions: payrollByDoctor.get(doctorId) ?? 0,
        }
      )
    );
  }

  return result;
}

function sumWithdrawalsByStatus(
  rows: WithdrawalRow[] | undefined,
  statuses: string[]
): number {
  return (rows ?? [])
    .filter((r) => statuses.includes(r.status))
    .reduce((s, r) => s + Number(r.amount ?? 0), 0);
}

/** مجموع السحوبات (موافق + مدفوع) والمعلّق — استعلام واحد */
export async function fetchWithdrawalSumsByDoctor(
  supabase: SupabaseClient,
  doctorIds: string[]
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
    .select("doctor_id, amount, status")
    .in("doctor_id", doctorIds);

  const byDoctor = groupWithdrawalsByDoctor(data);
  for (const doctorId of doctorIds) {
    const rows = byDoctor.get(doctorId);
    map.set(doctorId, {
      totalWithdrawn: sumWithdrawalsByStatus(rows, ["approved", "paid"]),
      pendingWithdrawalAmount: sumWithdrawalsByStatus(rows, ["pending"]),
    });
  }
  return map;
}

function sumOperationEarnings(
  rows: OperationEarningRow[] | null | undefined,
  doctorPct: number,
  salaryDoctor = false
): number {
  return (rows ?? []).reduce(
    (sum, row) => sum + calcOperationEarned(row, doctorPct, salaryDoctor),
    0
  );
}

/** حساب الأرباح من الجلسات — لا يعتمد على doctor_share_amount (غالباً 0 في DB) */
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
      .select("percentage, payment_type")
      .eq("id", doctorId)
      .maybeSingle(),
  ]);

  const pct = Number(doctorRes.data?.percentage ?? 50) / 100;
  const salaryDoctor = isSalaryDoctor({
    payment_type: doctorRes.data?.payment_type,
  });
  return sumOperationEarnings(opsRes.data, pct, salaryDoctor);
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

  const { data: doctor } = await supabase
    .from("doctors")
    .select("percentage, payment_type")
    .eq("id", doctorId)
    .maybeSingle();

  const pct = Number(doctor?.percentage ?? 50) / 100;
  const salaryDoctor = isSalaryDoctor({ payment_type: doctor?.payment_type });
  const { data: ops } = await opsQuery;
  return sumOperationEarnings(ops, pct, salaryDoctor);
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
    .select("percentage, payment_type, salary_amount")
    .eq("id", doctorId)
    .maybeSingle();

  if (isSalaryDoctor({ payment_type: doctor?.payment_type })) {
    const [salaryPaid, expenseDeductions, payrollDeductions] =
      await Promise.all([
        fetchDoctorSalaryPayoutsTotal(
          supabase,
          doctorId,
          range.from,
          range.to
        ),
        fetchDoctorExpenseDeductionsTotal(supabase, doctorId),
        fetchDoctorPayrollDeductionsTotal(supabase, doctorId),
      ]);

    return computeWalletStats(Number(doctor?.salary_amount ?? 0), [], {
      salaryLedger: true,
      salaryWithdrawn: salaryPaid,
      expenseDeductions,
      payrollDeductions,
    });
  }

  const [totalEarnings, withdrawalsRes, expenseDeductions, payrollDeductions] =
    await Promise.all([
      computeEarningsFromOperations(supabase, doctorId),
      supabase
        .from("doctor_withdrawals")
        .select("amount, status")
        .eq("doctor_id", doctorId)
        .neq("status", "rejected"),
      fetchDoctorExpenseDeductionsTotal(supabase, doctorId),
      fetchDoctorPayrollDeductionsTotal(supabase, doctorId),
    ]);

  return computeWalletStats(totalEarnings, withdrawalsRes.data ?? [], {
    expenseDeductions,
    payrollDeductions,
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
