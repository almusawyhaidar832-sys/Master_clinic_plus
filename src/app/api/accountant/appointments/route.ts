import { NextRequest, NextResponse } from "next/server";
import { getApiCallerProfile, isApiStaffRole } from "@/lib/auth/api-session";
import { getAdminClient } from "@/lib/supabase/admin";
import { createStaffAppointment } from "@/lib/services/staff-appointments-server";

/** POST /api/accountant/appointments — حجز مراجع جديد (محاسب / مالك) */
export async function POST(req: NextRequest) {
  try {
    const caller = await getApiCallerProfile(req);
    if (!caller?.clinic_id || !isApiStaffRole(String(caller.role))) {
      return NextResponse.json({ error: "للموظفين فقط" }, { status: 403 });
    }

    const body = await req.json();
    const admin = getAdminClient();
    const { appointment, whatsapp } = await createStaffAppointment(
      admin,
      caller.clinic_id as string,
      {
        doctor_id: String(body.doctor_id ?? ""),
        patient_name_ar: String(body.patient_name_ar ?? ""),
        patient_phone: String(body.patient_phone ?? ""),
        appointment_date: String(body.appointment_date ?? ""),
        start_time: String(body.start_time ?? ""),
        end_time: String(body.end_time ?? ""),
        notes: body.notes ?? null,
      },
      {
        changedBy: caller.id as string,
        actorName: caller.full_name ?? null,
      }
    );

    return NextResponse.json({ success: true, appointment, whatsapp });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "خطأ غير متوقع";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
