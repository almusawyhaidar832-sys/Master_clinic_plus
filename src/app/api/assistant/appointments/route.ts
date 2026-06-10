import { NextRequest, NextResponse } from "next/server";
import { getApiCallerProfile } from "@/lib/auth/api-session";
import { getAdminClient } from "@/lib/supabase/admin";
import {
  createAssistantAppointment,
  resolveAssistantContext,
} from "@/lib/services/assistant-appointments-server";

/** POST /api/assistant/appointments — إضافة موعد يدوي */
export async function POST(req: NextRequest) {
  try {
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
    const { appointment, whatsapp } = await createAssistantAppointment(admin, ctx, {
      patient_name_ar: String(body.patient_name_ar ?? ""),
      patient_phone: String(body.patient_phone ?? ""),
      appointment_date: String(body.appointment_date ?? ""),
      start_time: String(body.start_time ?? ""),
      end_time: String(body.end_time ?? ""),
      notes: body.notes ?? null,
    });

    return NextResponse.json({ success: true, appointment, whatsapp });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "خطأ غير متوقع";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
