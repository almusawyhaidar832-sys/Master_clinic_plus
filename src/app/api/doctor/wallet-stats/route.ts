import { NextRequest, NextResponse } from "next/server";
import { getApiCallerProfile } from "@/lib/auth/api-session";
import { getAdminClient } from "@/lib/supabase/admin";
import { fetchDoctorWalletStats } from "@/lib/services/doctor-wallet";
import { repairDoctorOperationShares } from "@/lib/services/operation-amount-edit";

/** GET — رصيد الطبيب (يشمل صرفيات الطبيب — قد يكون سالباً) */
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
      .select("id, clinic_id")
      .eq("profile_id", profile.id)
      .eq("is_active", true)
      .maybeSingle();

    if (!doctor || doctor.clinic_id !== profile.clinic_id) {
      return NextResponse.json(
        { error: "لم يُربط حسابك بسجل طبيب" },
        { status: 404 }
      );
    }

    const syncShares = new URL(req.url).searchParams.get("sync_shares") === "1";
    if (syncShares) {
      await repairDoctorOperationShares(admin, doctor.clinic_id, {
        doctorId: doctor.id,
      });
    }

    const stats = await fetchDoctorWalletStats(admin, doctor.id);
    return NextResponse.json(stats);
  } catch (err) {
    console.error("[api/doctor/wallet-stats]", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "خطأ" },
      { status: 500 }
    );
  }
}
