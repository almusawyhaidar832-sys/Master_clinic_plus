import { NextRequest, NextResponse } from "next/server";
import { getApiCallerProfile } from "@/lib/auth/api-session";
import { getAdminClient } from "@/lib/supabase/admin";
import {
  acceptAssistantAppointment,
  cancelAssistantAppointment,
  rejectAssistantAppointment,
  resolveAssistantContext,
} from "@/lib/services/assistant-appointments-server";

/** POST /api/assistant/appointments/[id]/status — قبول أو رفض */
export async function POST(
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
    const action = body.action as "accept" | "reject" | "cancel";

    if (action === "accept") {
      const appointment = await acceptAssistantAppointment(admin, ctx, id);
      return NextResponse.json({
        success: true,
        appointment,
        queued_to_waiting_room: appointment.status === "waiting",
      });
    }

    if (action === "reject") {
      const appointment = await rejectAssistantAppointment(
        admin,
        ctx,
        id,
        String(body.reason_for_change ?? "")
      );
      return NextResponse.json({ success: true, appointment });
    }

    if (action === "cancel") {
      const appointment = await cancelAssistantAppointment(admin, ctx, id);
      return NextResponse.json({ success: true, appointment });
    }

    return NextResponse.json(
      { error: "action يجب أن يكون accept أو reject أو cancel" },
      { status: 400 }
    );
  } catch (e) {
    const msg = e instanceof Error ? e.message : "خطأ غير متوقع";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
