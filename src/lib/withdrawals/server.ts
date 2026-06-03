import type { SupabaseClient } from "@supabase/supabase-js";
import {
  computeWalletStats,
  fetchDoctorTotalEarnings,
} from "@/lib/services/doctor-wallet";

/** Max amount available for a new withdrawal (reserves pending requests) */
export async function computeDoctorWithdrawableLimit(
  admin: SupabaseClient,
  doctorId: string
): Promise<number> {
  const stats = await computeDoctorWalletBreakdown(admin, doctorId);
  return stats.withdrawableLimit;
}

export async function computeDoctorWalletBreakdown(
  admin: SupabaseClient,
  doctorId: string
) {
  const [totalEarnings, wdsRes] = await Promise.all([
    fetchDoctorTotalEarnings(admin, doctorId),
    admin
      .from("doctor_withdrawals")
      .select("amount, status")
      .eq("doctor_id", doctorId)
      .neq("status", "rejected"),
  ]);

  return computeWalletStats(totalEarnings, wdsRes.data ?? []);
}

/** @deprecated use computeDoctorWithdrawableLimit */
export async function computeDoctorBalance(
  admin: SupabaseClient,
  doctorId: string
): Promise<number> {
  return computeDoctorWithdrawableLimit(admin, doctorId);
}

type WithdrawalInsert = {
  clinic_id: string;
  doctor_id: string;
  amount: number;
  status: "pending" | "approved" | "paid" | "rejected";
  processed_at?: string;
  processed_by?: string;
  notes?: string;
  source?: "doctor_request" | "accountant_cash";
};

export async function insertWithdrawal(
  admin: SupabaseClient,
  payload: WithdrawalInsert
): Promise<{ id: string }> {
  const base = { ...payload };
  const withSource =
    payload.source != null ? { ...base, source: payload.source } : base;

  let result = await admin
    .from("doctor_withdrawals")
    .insert(withSource)
    .select("id")
    .single();

  if (result.error) {
    const msg = result.error.message.toLowerCase();
    const strip: Partial<WithdrawalInsert> = { ...withSource };

    if (
      payload.source &&
      (msg.includes("source") || msg.includes("schema cache"))
    ) {
      delete strip.source;
    }
    if (msg.includes("processed_by")) {
      delete strip.processed_by;
    }
    if (msg.includes("processed_at")) {
      delete strip.processed_at;
    }

    if (Object.keys(strip).length !== Object.keys(withSource).length) {
      result = await admin
        .from("doctor_withdrawals")
        .insert(strip as WithdrawalInsert)
        .select("id")
        .single();
    }
  }

  if (result.error || !result.data) {
    throw new Error(result.error?.message ?? "تعذر تسجيل السحب");
  }

  return { id: result.data.id as string };
}
