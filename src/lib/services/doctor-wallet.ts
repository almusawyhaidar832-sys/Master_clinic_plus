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

  // Pending requests do NOT reduce displayed balance — only on approve/pay
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

export async function fetchDoctorWalletStats(
  supabase: SupabaseClient,
  doctorId: string
): Promise<DoctorWalletStats> {
  const { data, error } = await supabase.rpc("get_doctor_wallet_stats", {
    p_doctor_id: doctorId,
  });

  if (!error && data && typeof data === "object" && !("error" in data)) {
    const row = data as Record<string, number>;
    const availableBalance = Number(row.available_balance ?? 0);
    const withdrawableLimit =
      row.withdrawable_limit != null
        ? Number(row.withdrawable_limit)
        : availableBalance;

    return {
      totalEarnings: Number(row.total_earnings ?? 0),
      totalWithdrawn: Number(row.total_withdrawn ?? 0),
      pendingAmount: Number(row.pending_amount ?? 0),
      approvedAmount: Number(row.approved_amount ?? 0),
      availableBalance,
      withdrawableLimit,
    };
  }

  const [opsRes, withdrawalsRes] = await Promise.all([
    supabase
      .from("patient_operations")
      .select("doctor_share_amount")
      .eq("doctor_id", doctorId),
    supabase
      .from("doctor_withdrawals")
      .select("amount, status")
      .eq("doctor_id", doctorId)
      .neq("status", "rejected"),
  ]);

  const totalEarnings = (opsRes.data ?? []).reduce(
    (s, r) => s + Number(r.doctor_share_amount ?? 0),
    0
  );

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
