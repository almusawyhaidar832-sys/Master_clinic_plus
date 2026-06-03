import { NextRequest, NextResponse } from "next/server";
import { getApiCallerProfile } from "@/lib/auth/api-session";
import { getAdminClient } from "@/lib/supabase/admin";
import {
  computeDoctorWithdrawableLimit,
  insertWithdrawal,
} from "@/lib/withdrawals/server";
import {
  notifyWithdrawalRequest,
} from "@/lib/notifications/server";
import { formatCurrency } from "@/lib/utils";

/** POST — doctor requests withdrawal */
export async function POST(req: NextRequest) {
  try {
    const caller = await getApiCallerProfile();
    if (!caller) {
      return NextResponse.json({ error: "يجب تسجيل الدخول" }, { status: 401 });
    }

    if (caller.role !== "doctor") {
      return NextResponse.json({ error: "غير مصرح" }, { status: 403 });
    }

    const { amount } = (await req.json()) as { amount?: number };
    if (!amount || amount <= 0) {
      return NextResponse.json({ error: "أدخل مبلغاً صحيحاً" }, { status: 400 });
    }

    const admin = getAdminClient();

    let doctor: { id: string; clinic_id: string; full_name_ar: string } | null =
      null;

    const { data: linkedDoctor } = await admin
      .from("doctors")
      .select("id, clinic_id, full_name_ar")
      .eq("profile_id", caller.id)
      .maybeSingle();

    doctor = linkedDoctor;

    if (!doctor && caller.clinic_id) {
      const { data: byName } = await admin
        .from("doctors")
        .select("id, clinic_id, full_name_ar")
        .eq("clinic_id", caller.clinic_id)
        .eq("full_name_ar", caller.full_name)
        .maybeSingle();

      doctor = byName;

      if (doctor) {
        await admin
          .from("doctors")
          .update({ profile_id: caller.id })
          .eq("id", doctor.id)
          .is("profile_id", null);
      }
    }

    if (!doctor) {
      return NextResponse.json(
        { error: "حساب الطبيب غير مربوط — تواصل مع المحاسب" },
        { status: 403 }
      );
    }

    const limit = await computeDoctorWithdrawableLimit(admin, doctor.id);
    if (amount > limit + 0.001) {
      return NextResponse.json(
        { error: `المبلغ يتجاوز الحد المتاح (${formatCurrency(limit)})` },
        { status: 400 }
      );
    }

    const { id } = await insertWithdrawal(admin, {
      clinic_id: doctor.clinic_id,
      doctor_id: doctor.id,
      amount,
      status: "pending",
      source: "doctor_request",
    });

    await notifyWithdrawalRequest(id).catch((err) => {
      console.error("[withdrawals/request] notification failed:", err);
    });

    return NextResponse.json({ success: true, id });
  } catch (err) {
    console.error("[withdrawals/request]", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "تعذر إرسال الطلب" },
      { status: 500 }
    );
  }
}
