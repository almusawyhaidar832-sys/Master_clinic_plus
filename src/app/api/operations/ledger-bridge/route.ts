import { NextRequest, NextResponse } from "next/server";
import { getApiCallerProfile, isApiStaffRole } from "@/lib/auth/api-session";
import { getAdminClient } from "@/lib/supabase/admin";
import { ensureAppointmentPatient } from "@/lib/services/ensure-appointment-patient";

/** GET ?appointment_id= — تجهيز مريض الموعد للانتقال إلى إدخال الجلسة */
export async function GET(req: NextRequest) {
  try {
    const profile = await getApiCallerProfile(req);
    if (!profile?.clinic_id || !isApiStaffRole(String(profile.role))) {
      return NextResponse.json({ error: "غير مصرح" }, { status: 403 });
    }

    const appointmentId = req.nextUrl.searchParams.get("appointment_id")?.trim();
    if (!appointmentId) {
      return NextResponse.json(
        { error: "appointment_id مطلوب" },
        { status: 400 }
      );
    }

    const admin = getAdminClient();
    const ctx = await ensureAppointmentPatient(
      admin,
      appointmentId,
      profile.clinic_id as string
    );

    return NextResponse.json({
      patient_id: ctx.patientId,
      patient_name: ctx.patientName,
      patient_phone: ctx.patientPhone,
      doctor_id: ctx.doctorId,
      appointment_id: ctx.appointmentId,
    });
  } catch (err) {
    console.error("[api/operations/ledger-bridge]", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "تعذر تجهيز المريض" },
      { status: 500 }
    );
  }
}
