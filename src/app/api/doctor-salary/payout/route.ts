import { NextRequest, NextResponse } from "next/server";
import { getApiCallerProfile } from "@/lib/auth/api-session";
import { getAdminClient } from "@/lib/supabase/admin";
import { recordDoctorSalaryPayout } from "@/lib/services/doctor-salary-payout";

/**
 * POST /api/doctor-salary/payout
 * صرف راتب طبيب (نظام الراتب الثابت) — خصم من خزينة العيادة
 */
export async function POST(req: NextRequest) {
  try {
    const caller = await getApiCallerProfile(req);
    if (!caller) {
      return NextResponse.json({ error: "يجب تسجيل الدخول أولاً" }, { status: 401 });
    }

    if (!["accountant", "super_admin", "admin"].includes(caller.role)) {
      return NextResponse.json({ error: "صلاحيات غير كافية" }, { status: 403 });
    }

    const clinicId = caller.clinic_id;
    if (!clinicId) {
      return NextResponse.json({ error: "حسابك غير مربوط بعيادة" }, { status: 400 });
    }

    const body = await req.json();
    const doctor_id = String(body.doctor_id ?? "").trim();
    const amount = Number(body.amount);
    const payout_date = String(body.payout_date ?? "");
    const notes = body.notes != null ? String(body.notes) : null;

    const admin = getAdminClient();
    const result = await recordDoctorSalaryPayout(admin, {
      clinicId,
      doctorId: doctor_id,
      amount,
      payoutDate: payout_date,
      notes,
    });

    if (!result.ok) {
      return NextResponse.json({ error: result.error }, { status: 400 });
    }

    return NextResponse.json({
      success: true,
      expense_id: result.result.expenseId,
      description_ar: result.result.descriptionAr,
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "خطأ غير متوقع";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
