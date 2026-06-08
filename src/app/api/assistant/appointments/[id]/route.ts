import { NextRequest, NextResponse } from "next/server";
import { getApiCallerProfile } from "@/lib/auth/api-session";
import { getAdminClient } from "@/lib/supabase/admin";
import {
  deleteAssistantAppointment,
  resolveAssistantContext,
  updateAssistantAppointment,
} from "@/lib/services/assistant-appointments-server";

/** PATCH /api/assistant/appointments/[id] — تعديل موعد + سبب التغيير */
export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const caller = await getApiCallerProfile(req);
    if (!caller || caller.role !== "assistant") {
      return NextResponse.json({ error: "للمساعدين فقط" }, { status: 403 });
    }

    const admin = getAdminClient();
    const ctx = await resolveAssistantContext(admin, caller.id);
    if (!ctx) {
      return NextResponse.json({ error: "حساب المساعد غير مربوط" }, { status: 400 });
    }

    const body = await req.json();
    const appointment = await updateAssistantAppointment(admin, ctx, id, {
      patient_name_ar: body.patient_name_ar,
      patient_phone: body.patient_phone,
      appointment_date: body.appointment_date,
      start_time: body.start_time,
      end_time: body.end_time,
      notes: body.notes,
      reason_for_change: String(body.reason_for_change ?? ""),
    });

    return NextResponse.json({ success: true, appointment });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "خطأ غير متوقع";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

/** DELETE /api/assistant/appointments/[id] */
export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const caller = await getApiCallerProfile(req);
    if (!caller || caller.role !== "assistant") {
      return NextResponse.json({ error: "للمساعدين فقط" }, { status: 403 });
    }

    const admin = getAdminClient();
    const ctx = await resolveAssistantContext(admin, caller.id);
    if (!ctx) {
      return NextResponse.json({ error: "حساب المساعد غير مربوط" }, { status: 400 });
    }

    await deleteAssistantAppointment(admin, ctx, id);
    return NextResponse.json({ success: true });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "خطأ غير متوقع";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
