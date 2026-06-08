import type { SupabaseClient } from "@supabase/supabase-js";

export interface DoctorWalletStats {
  totalEarnings: number;
  totalWithdrawn: number;
  pendingAmount: number;
  approvedAmount: number;
  /** Balance shown to doctor — deducts paid + approved only (not pending) */
  availableBalance: number;
  /** Max amount for a new request — also reserves pending requests */
  withdrawableLimit: number;
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

export function computeWalletStats(
  totalEarnings: number,
  withdrawals: WithdrawalRow[]
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

  const availableBalance = Math.max(0, earned - totalWithdrawn - approvedAmount);
  const withdrawableLimit = Math.max(
    0,
    earned - totalWithdrawn - approvedAmount - pendingAmount
  );

  return {
    totalEarnings: earned,
    totalWithdrawn: round(totalWithdrawn),
    pendingAmount: round(pendingAmount),
    approvedAmount: round(approvedAmount),
    availableBalance: round(availableBalance),
    withdrawableLimit: round(withdrawableLimit),
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
  return computeWalletStats(totalEarnings, withdrawalsRes.data ?? []);
}

/** Max amount the doctor can request right now (accounts for pending requests) */
export async function fetchDoctorWithdrawableLimit(
  supabase: SupabaseClient,
  doctorId: string
): Promise<number> {
  const stats = await fetchDoctorWalletStats(supabase, doctorId);
  return stats.withdrawableLimit;
}
