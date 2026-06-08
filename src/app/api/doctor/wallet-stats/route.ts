import { NextRequest, NextResponse } from "next/server";
import { getApiCallerProfile } from "@/lib/auth/api-session";
import { getAdminClient } from "@/lib/supabase/admin";
import {
  calcOperationEarned,
  computeWalletStats,
} from "@/lib/services/doctor-wallet";

/** GET — رصيد الطبيب (حساب من الدفعات عبر service role) */
export async function GET(req: NextRequest) {
  try {
    const profile = await getApiCallerProfile(req);
    if (!profile?.clinic_id) {
      return NextResponse.json({ error: "غير مصرح" }, { status: 401 });
    }

    const role = String(profile.role ?? "").toLowerCase();
    if (role !== "doctor") {
      return NextResponse.json({ error: "للأطباء فقط" }, { status: 403 });
    }

    const admin = getAdminClient();
    const { data: doctor } = await admin
      .from("doctors")
      .select("id, percentage, clinic_id")
      .eq("profile_id", profile.id)
      .eq("is_active", true)
      .maybeSingle();

    if (!doctor || doctor.clinic_id !== profile.clinic_id) {
      return NextResponse.json(
        { error: "لم يُربط حسابك بسجل طبيب" },
        { status: 404 }
      );
    }

    const pct = Number(doctor.percentage ?? 50) / 100;

    const [opsRes, withdrawalsRes, rpcRes] = await Promise.all([
      admin
        .from("patient_operations")
        .select(
          "doctor_share_amount, paid_amount, treatment_case_id, patient_treatment_cases(doctor_share_total, final_price)"
        )
        .eq("doctor_id", doctor.id),
      admin
        .from("doctor_withdrawals")
        .select("amount, status")
        .eq("doctor_id", doctor.id)
        .neq("status", "rejected"),
      admin.rpc("get_doctor_wallet_stats", { p_doctor_id: doctor.id }),
    ]);

    const clientEarnings = (opsRes.data ?? []).reduce(
      (sum, row) => sum + calcOperationEarned(row, pct),
      0
    );

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

    const stats = computeWalletStats(
      Math.max(clientEarnings, rpcEarned),
      withdrawalsRes.data ?? []
    );

    return NextResponse.json(stats);
  } catch (err) {
    console.error("[api/doctor/wallet-stats]", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "خطأ" },
      { status: 500 }
    );
  }
}
