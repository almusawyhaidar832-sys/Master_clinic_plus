import { NextRequest, NextResponse } from "next/server";
import {
  getApiCallerProfile,
  isApiDoctorRole,
} from "@/lib/auth/api-session";
import { getAdminClient } from "@/lib/supabase/admin";
import { getDoctorByProfileId } from "@/lib/queue/server";
import { createDoctorAppointment } from "@/lib/services/staff-appointments-server";

/** POST /api/doctor/appointments — حجز موعد من تطبيق الطبيب */
export async function POST(req: NextRequest) {
  try {
    const caller = await getApiCallerProfile(req);
    if (!caller?.clinic_id || !isApiDoctorRole(String(caller.role))) {
      return NextResponse.json({ error: "للأطباء فقط" }, { status: 403 });
    }

    const admin = getAdminClient();
    const doctor = await getDoctorByProfileId(caller.id);
    if (!doctor || doctor.clinic_id !== caller.clinic_id) {
      return NextResponse.json({ error: "حساب الطبيب غير مربوط" }, { status: 400 });
    }

    const body = await req.json();
    const { appointment, whatsapp } = await createDoctorAppointment(
      admin,
      caller.clinic_id as string,
      doctor.id,
      {
        patient_id: body.patient_id ? String(body.patient_id) : null,
        patient_name_ar: String(body.patient_name_ar ?? ""),
        patient_phone: String(body.patient_phone ?? ""),
        appointment_date: String(body.appointment_date ?? ""),
        start_time: String(body.start_time ?? ""),
        end_time: String(body.end_time ?? ""),
        notes: body.notes ?? null,
      }
    );

    return NextResponse.json({ success: true, appointment, whatsapp });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "خطأ غير متوقع";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
