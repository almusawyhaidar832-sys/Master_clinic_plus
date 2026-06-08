import { NextRequest, NextResponse } from "next/server";
import {
  getApiCallerProfile,
  isApiDoctorRole,
  isApiStaffRole,
} from "@/lib/auth/api-session";
import { getAdminClient } from "@/lib/supabase/admin";
import {
  getDoctorByProfileId,
  updateQueueStatus,
  type QueueStatus,
} from "@/lib/queue/server";

const NEXT_STATUS: Partial<Record<QueueStatus, QueueStatus>> = {
  waiting: "called",
  called: "in_progress",
  in_progress: "done",
};

function staffRolesOk(role: string) {
  return isApiStaffRole(role);
}

/** PATCH — advance status or cancel */
export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const profile = await getApiCallerProfile(req);
    if (!profile?.clinic_id) {
      return NextResponse.json({ error: "يجب تسجيل الدخول" }, { status: 401 });
    }

    const role = String(profile.role ?? "").toLowerCase();
    const body = (await req.json()) as {
      action?: "advance" | "cancel" | "enter";
    };

    const admin = getAdminClient();

    if (body.action === "cancel") {
      if (!staffRolesOk(role)) {
        return NextResponse.json({ error: "غير مصرح" }, { status: 403 });
      }
      await updateQueueStatus(id, "cancelled", { clinicId: profile.clinic_id });
      return NextResponse.json({ success: true });
    }

    if (body.action === "enter") {
      if (!isApiDoctorRole(role)) {
        return NextResponse.json({ error: "غير مصرح" }, { status: 403 });
      }
      const doctor = await getDoctorByProfileId(profile.id);
      if (!doctor) {
        return NextResponse.json({ error: "حساب الطبيب غير مربوط" }, { status: 403 });
      }
      await updateQueueStatus(id, "in_progress", { doctorId: doctor.id });
      return NextResponse.json({ success: true });
    }

    // advance (staff or doctor)
    const { data: entry } = await admin
      .from("patient_queue")
      .select("status, doctor_id")
      .eq("id", id)
      .eq("clinic_id", profile.clinic_id)
      .maybeSingle();

    if (!entry) {
      return NextResponse.json({ error: "الدور غير موجود" }, { status: 404 });
    }

    if (role === "doctor" || isApiDoctorRole(role)) {
      const doctor = await getDoctorByProfileId(profile.id);
      if (!doctor || doctor.id !== entry.doctor_id) {
        return NextResponse.json({ error: "غير مصرح" }, { status: 403 });
      }
    } else if (!staffRolesOk(role)) {
      return NextResponse.json({ error: "غير مصرح" }, { status: 403 });
    }

    const current = entry.status as QueueStatus;
    const next = NEXT_STATUS[current];
    if (!next) {
      return NextResponse.json({ error: "لا يمكن تقديم هذا الدور" }, { status: 400 });
    }

    await updateQueueStatus(id, next, {
      clinicId: profile.clinic_id,
      doctorId: role === "doctor" ? entry.doctor_id : undefined,
    });

    return NextResponse.json({ success: true, status: next });
  } catch (err) {
    console.error("[api/queue PATCH]", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "تعذر تحديث الدور" },
      { status: 500 }
    );
  }
}
