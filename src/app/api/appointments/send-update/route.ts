import { NextRequest, NextResponse } from "next/server";
import { getApiCallerProfile } from "@/lib/auth/api-session";
import { getAdminClient } from "@/lib/supabase/admin";
import {
  sendAppointmentUpdate,
  type AppointmentUpdateAction,
} from "@/lib/services/appointment-updates";

/**
 * POST /api/appointments/send-update
 * Webhook / API — إرسال تحديث موعد عبر واتساب
 */
export async function POST(req: NextRequest) {
  try {
    const caller = await getApiCallerProfile(req);
    if (!caller) {
      return NextResponse.json({ error: "يجب تسجيل الدخول أولاً" }, { status: 401 });
    }

    if (!["accountant", "super_admin", "assistant", "doctor"].includes(caller.role)) {
      return NextResponse.json({ error: "صلاحيات غير كافية" }, { status: 403 });
    }

    const body = await req.json();
    const clinicId = String(body.clinic_id ?? caller.clinic_id ?? "");
    if (!clinicId) {
      return NextResponse.json({ error: "معرّف العيادة مطلوب" }, { status: 400 });
    }

    const action = body.action as AppointmentUpdateAction;
    if (!["accepted", "rejected", "modified", "created"].includes(action)) {
      return NextResponse.json({ error: "إجراء غير صالح" }, { status: 400 });
    }

    const admin = getAdminClient();
    const result = await sendAppointmentUpdate(admin, {
      clinicId,
      appointmentId: body.appointment_id ?? undefined,
      patientPhone: body.patient_phone ?? null,
      patientName: String(body.patient_name ?? "عميلنا"),
      doctorName: String(body.doctor_name ?? "الطبيب"),
      appointmentDate: String(body.appointment_date ?? ""),
      startTime: String(body.start_time ?? ""),
      endTime: String(body.end_time ?? ""),
      action,
      reasonForChange: body.reason_for_change ?? null,
    });

    return NextResponse.json({ success: true, ...result });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "خطأ غير متوقع";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
