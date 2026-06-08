import type { SupabaseClient } from "@supabase/supabase-js";
import { doctorShareFromExpense } from "@/lib/services/assistant-payroll";

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
  doctorPct: number
): number {
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

/** مجموع حصة الطبيب من فواتير الصرفيات */
export async function fetchDoctorExpenseDeductionsTotal(
  supabase: SupabaseClient,
  doctorId: string
): Promise<number> {
  const { data } = await supabase
    .from("doctor_expenses")
    .select("amount, percentage_split")
    .eq("doctor_id", doctorId);

  return (data ?? []).reduce(
    (s, row) =>
      s +
      doctorShareFromExpense(
        Number(row.amount ?? 0),
        Number(row.percentage_split ?? 0)
      ),
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
  deductions?: { expenseDeductions?: number; payrollDeductions?: number }
): DoctorWalletStats {
  let totalWithdrawn = 0;
  let pendingAmount = 0;
  let approvedAmount = 0;

  for (const w of withdrawals) {
    const amt = Number(w.amount ?? 0);
    if (w.status === "paid") totalWithdrawn += amt;
    else if (w.status === "pending") pendingAmount += amt;
    else if (w.status === "approved") approvedAmount += amt;
  }

  const round = (n: number) => Math.round(n * 100) / 100;
  const earned = round(totalEarnings);
  const expenseDeductions = round(deductions?.expenseDeductions ?? 0);
  const payrollDeductions = round(deductions?.payrollDeductions ?? 0);

  const netAccounting = round(
    earned -
      totalWithdrawn -
      approvedAmount -
      expenseDeductions -
      payrollDeductions
  );

  const withdrawableLimit = Math.max(0, netAccounting - pendingAmount);

  return {
    totalEarnings: earned,
    totalWithdrawn: round(totalWithdrawn),
    pendingAmount: round(pendingAmount),
    approvedAmount: round(approvedAmount),
    expenseDeductions,
    payrollDeductions,
    availableBalance: netAccounting,
    withdrawableLimit: round(withdrawableLimit),
    isDebtor: netAccounting < 0,
  };
}

/** حساب الأرباح من الجلسات — لا يعتمد على doctor_share_amount (غالباً 0 في DB) */
export async function computeEarningsFromOperations(
  supabase: SupabaseClient,
  doctorId: string
): Promise<number> {
  const [opsRes, doctorRes] = await Promise.all([
    supabase
      .from("patient_operations")
      .select(
        "doctor_share_amount, paid_amount, treatment_case_id, patient_treatment_cases(doctor_share_total, final_price)"
      )
      .eq("doctor_id", doctorId),
    supabase
      .from("doctors")
      .select("percentage")
      .eq("id", doctorId)
      .maybeSingle(),
  ]);

  const pct = Number(doctorRes.data?.percentage ?? 50) / 100;

  return (opsRes.data ?? []).reduce(
    (sum, row) => sum + calcOperationEarned(row, pct),
    0
  );
}

/** مستحقات الطبيب — من حصة كل دفعة (نسبة من doctor_share_total للحالة) */
export async function fetchDoctorTotalEarnings(
  supabase: SupabaseClient,
  doctorId: string
): Promise<number> {
  const [clientEarnings, rpcRes] = await Promise.all([
    computeEarningsFromOperations(supabase, doctorId),
    supabase.rpc("get_doctor_wallet_stats", { p_doctor_id: doctorId }),
  ]);

  if (
    !rpcRes.error &&
    rpcRes.data &&
    typeof rpcRes.data === "object" &&
    !("error" in rpcRes.data)
  ) {
    const rpcEarned = Number(
      (rpcRes.data as Record<string, number>).total_earnings ?? 0
    );
    return Math.max(clientEarnings, rpcEarned);
  }

  return clientEarnings;
}

export async function fetchDoctorWalletStats(
  supabase: SupabaseClient,
  doctorId: string
): Promise<DoctorWalletStats> {
  const [clientEarnings, rpcRes, withdrawalsRes] = await Promise.all([
    computeEarningsFromOperations(supabase, doctorId),
    supabase.rpc("get_doctor_wallet_stats", { p_doctor_id: doctorId }),
    supabase
      .from("doctor_withdrawals")
      .select("amount, status")
      .eq("doctor_id", doctorId)
      .neq("status", "rejected"),
  ]);

  let rpcEarned = 0;
  if (
    !rpcRes.error &&
    rpcRes.data &&
    typeof rpcRes.data === "object" &&
    !("error" in rpcRes.data)
  ) {
    rpcEarned = Number(
      (rpcRes.data as Record<string, number>).total_earnings ?? 0
    );
  }

  const totalEarnings = Math.max(clientEarnings, rpcEarned);
  const [expenseDeductions, payrollDeductions] = await Promise.all([
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
