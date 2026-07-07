import { NextRequest, NextResponse } from "next/server";
import { getApiCallerProfile, isApiStaffRole } from "@/lib/auth/api-session";
import { getAdminClient } from "@/lib/supabase/admin";
import {
  approvePendingAppointment,
  cancelStaffAppointment,
  rejectPendingAppointment,
} from "@/lib/services/staff-appointments-server";

/** POST /api/accountant/appointments/[id]/status — موافقة أو رفض (محاسب) */
export async function POST(
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
    const action = body.action as "accept" | "reject" | "cancel";
    const admin = getAdminClient();
    const clinicId = caller.clinic_id as string;

    if (action === "accept") {
      const appointment = await approvePendingAppointment(admin, clinicId, id);
      return NextResponse.json({
        success: true,
        appointment,
        queued_to_waiting_room: appointment.status === "waiting",
      });
    }

    if (action === "reject") {
      const appointment = await rejectPendingAppointment(
        admin,
        clinicId,
        id,
        String(body.reason_for_change ?? "")
      );
      return NextResponse.json({ success: true, appointment });
    }

    if (action === "cancel") {
      const appointment = await cancelStaffAppointment(
        admin,
        clinicId,
        id,
        {
          changedBy: caller.id as string,
          actorName: caller.full_name ?? null,
        }
      );
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
