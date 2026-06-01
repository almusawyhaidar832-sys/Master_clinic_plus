import type { SupabaseClient } from "@supabase/supabase-js";

export interface DoctorWalletStats {
  totalEarnings: number;
  totalWithdrawn: number;
  pendingAmount: number;
  approvedAmount: number;
  availableBalance: number;
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
    return {
      totalEarnings: Number(row.total_earnings ?? 0),
      totalWithdrawn: Number(row.total_withdrawn ?? 0),
      pendingAmount: Number(row.pending_amount ?? 0),
      approvedAmount: Number(row.approved_amount ?? 0),
      availableBalance: Number(row.available_balance ?? 0),
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

  let totalWithdrawn = 0;
  let pendingAmount = 0;
  let approvedAmount = 0;

  for (const w of withdrawalsRes.data ?? []) {
    const amt = Number(w.amount ?? 0);
    if (w.status === "paid") totalWithdrawn += amt;
    else if (w.status === "pending") pendingAmount += amt;
    else if (w.status === "approved") approvedAmount += amt;
  }

  const availableBalance = Math.max(
    0,
    totalEarnings - totalWithdrawn - pendingAmount - approvedAmount
  );

  return {
    totalEarnings: Math.round(totalEarnings * 100) / 100,
    totalWithdrawn: Math.round(totalWithdrawn * 100) / 100,
    pendingAmount: Math.round(pendingAmount * 100) / 100,
    approvedAmount: Math.round(approvedAmount * 100) / 100,
    availableBalance: Math.round(availableBalance * 100) / 100,
  };
}
