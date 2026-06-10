import { NextRequest, NextResponse } from "next/server";
import { getApiCallerProfile, isApiStaffRole } from "@/lib/auth/api-session";
import { getAdminClient } from "@/lib/supabase/admin";
import {
  deleteStaffAppointment,
  updateStaffAppointment,
} from "@/lib/services/staff-appointments-server";

/** PATCH /api/accountant/appointments/[id] — تعديل موعد (محاسب) */
export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const caller = await getApiCallerProfile(req);
    if (!caller?.clinic_id || !isApiStaffRole(String(caller.role))) {
      return NextResponse.json({ error: "للموظفين فقط" }, { status: 403 });
    }

    const body = await req.json();
    const admin = getAdminClient();
    const appointment = await updateStaffAppointment(
      admin,
      caller.clinic_id as string,
      id,
      {
        patient_name_ar: body.patient_name_ar,
        patient_phone: body.patient_phone,
        appointment_date: body.appointment_date,
        start_time: body.start_time,
        end_time: body.end_time,
        notes: body.notes,
        reason_for_change: String(body.reason_for_change ?? ""),
      },
      {
        changedBy: caller.id as string,
        actorName: caller.full_name ?? null,
      }
    );

    return NextResponse.json({ success: true, appointment });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "خطأ غير متوقع";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

/** DELETE /api/accountant/appointments/[id] — حذف موعد (محاسب) */
export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const caller = await getApiCallerProfile(req);
    if (!caller?.clinic_id || !isApiStaffRole(String(caller.role))) {
      return NextResponse.json({ error: "للموظفين فقط" }, { status: 403 });
    }

    const admin = getAdminClient();
    await deleteStaffAppointment(admin, caller.clinic_id as string, id, {
      changedBy: caller.id as string,
      actorName: caller.full_name ?? null,
    });
    return NextResponse.json({ success: true });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "خطأ غير متوقع";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
