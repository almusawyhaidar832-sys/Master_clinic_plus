import { NextRequest, NextResponse } from "next/server";
import {
  getApiCallerProfile,
  isApiAssistantRole,
  isApiDoctorRole,
  isApiStaffRole,
} from "@/lib/auth/api-session";
import { getAdminClient } from "@/lib/supabase/admin";
import {
  emitQueueScreenCall,
  fetchClinicQueue,
  getDoctorByProfileId,
  insertQueueEntry,
  notifyAccountantsPatientAdmit,
  recallAccountantNotification,
  sendQueueEntryToDoctor,
} from "@/lib/queue/server";
import {
  assertAssistantOwnsQueueEntry,
  resolveAssistantApiContext,
} from "@/lib/auth/resolve-assistant-api";

function staffRolesOk(role: string) {
  return isApiStaffRole(role) || isApiAssistantRole(role);
}

/** GET — today's queue + doctors list for accountant dashboard */
export async function GET(req: NextRequest) {
  try {
    const profile = await getApiCallerProfile(req);
    if (!profile?.clinic_id) {
      return NextResponse.json({ error: "يجب تسجيل الدخول" }, { status: 401 });
    }

    const role = String(profile.role ?? "");
    if (
      !isApiStaffRole(role) &&
      !isApiDoctorRole(role) &&
      !isApiAssistantRole(role)
    ) {
      return NextResponse.json(
        { error: `غير مصرح — دورك "${profile.role ?? "?"}" لا يسمح` },
        { status: 403 }
      );
    }

    const admin = getAdminClient();
    let doctorId: string | undefined;

    if (isApiDoctorRole(role)) {
      const doctor = await getDoctorByProfileId(profile.id);
      if (!doctor) {
        return NextResponse.json(
          { error: "حساب الطبيب غير مربوط" },
          { status: 403 }
        );
      }
      doctorId = doctor.id;
    } else if (isApiAssistantRole(role)) {
      const ctx = await resolveAssistantApiContext(profile);
      if (!ctx) {
        return NextResponse.json(
          { error: "حساب المساعد غير مربوط بطبيب" },
          { status: 403 }
        );
      }
      doctorId = ctx.doctorId;
    }

    const [queue, doctorsRes] = await Promise.all([
      fetchClinicQueue(profile.clinic_id, {
        doctorId,
        includeDone: true,
      }),
      admin
        .from("doctors")
        .select("id, full_name_ar, specialty_ar")
        .eq("clinic_id", profile.clinic_id)
        .eq("is_active", true),
    ]);

    return NextResponse.json({
      queue,
      doctors: doctorsRes.data ?? [],
      clinicId: profile.clinic_id,
      doctorId: doctorId ?? null,
    });
  } catch (err) {
    console.error("[api/queue GET]", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "تعذر تحميل الطابور" },
      { status: 500 }
    );
  }
}

/** POST — add to queue or send to doctor */
export async function POST(req: NextRequest) {
  try {
    const profile = await getApiCallerProfile(req);
    if (!profile?.clinic_id) {
      return NextResponse.json({ error: "يجب تسجيل الدخول" }, { status: 401 });
    }

    const role = String(profile.role ?? "");
    const body = (await req.json()) as {
      action?: string;
      doctor_id?: string;
      patient_name?: string;
      patient_phone?: string;
      patient_id?: string;
      send_to_doctor?: boolean;
      queue_entry_id?: string;
      notes?: string;
    };

    if (body.action === "admit") {
      if (!isApiDoctorRole(role)) {
        return NextResponse.json({ error: "غير مصرح" }, { status: 403 });
      }
      const doctor = await getDoctorByProfileId(profile.id);
      if (!doctor) {
        return NextResponse.json({ error: "حساب الطبيب غير مربوط" }, { status: 403 });
      }

      const entryId = String(body.queue_entry_id ?? "").trim();
      if (!entryId) {
        return NextResponse.json({ error: "معرّف الدور مطلوب" }, { status: 400 });
      }

      const admin = getAdminClient();
      const { error } = await admin
        .from("patient_queue")
        .update({ status: "called" })
        .eq("id", entryId)
        .eq("doctor_id", doctor.id)
        .in("status", ["waiting"]);

      if (error) {
        return NextResponse.json({ error: error.message }, { status: 400 });
      }

      await notifyAccountantsPatientAdmit(entryId).catch(console.error);
      void emitQueueScreenCall(entryId).catch(console.error);

      return NextResponse.json({ success: true });
    }

    if (body.action === "send_to_doctor") {
      if (!staffRolesOk(role)) {
        return NextResponse.json(
          { error: `غير مصرح — دورك "${profile.role ?? "?"}" لا يسمح` },
          { status: 403 }
        );
      }

      const entryId = String(body.queue_entry_id ?? "").trim();
      if (!entryId) {
        return NextResponse.json({ error: "معرّف الدور مطلوب" }, { status: 400 });
      }

      if (isApiAssistantRole(role)) {
        const ctx = await resolveAssistantApiContext(profile);
        if (!ctx) {
          return NextResponse.json({ error: "حساب المساعد غير مربوط" }, { status: 403 });
        }
        const owned = await assertAssistantOwnsQueueEntry(entryId, ctx);
        if (!owned.ok) {
          return NextResponse.json({ error: owned.error }, { status: owned.status });
        }
      }

      await sendQueueEntryToDoctor(entryId);
      return NextResponse.json({ success: true });
    }

    if (body.action === "recall") {
      const entryId = String(body.queue_entry_id ?? "").trim();
      if (!entryId) {
        return NextResponse.json({ error: "معرّف الدور مطلوب" }, { status: 400 });
      }

      const admin = getAdminClient();

      if (isApiDoctorRole(role)) {
        const doctor = await getDoctorByProfileId(profile!.id);
        if (!doctor) {
          return NextResponse.json({ error: "حساب الطبيب غير مربوط" }, { status: 403 });
        }
        const { data: entry } = await admin
          .from("patient_queue")
          .select("id, doctor_id, status")
          .eq("id", entryId)
          .eq("doctor_id", doctor.id)
          .maybeSingle();
        if (!entry) {
          return NextResponse.json({ error: "الدور غير موجود" }, { status: 404 });
        }
        await recallAccountantNotification(entryId);
        return NextResponse.json({ success: true });
      }

      if (!staffRolesOk(role)) {
        return NextResponse.json({ error: "غير مصرح" }, { status: 403 });
      }

      if (isApiAssistantRole(role)) {
        const ctx = await resolveAssistantApiContext(profile);
        if (!ctx) {
          return NextResponse.json({ error: "حساب المساعد غير مربوط" }, { status: 403 });
        }
        const owned = await assertAssistantOwnsQueueEntry(entryId, ctx);
        if (!owned.ok) {
          return NextResponse.json({ error: owned.error }, { status: owned.status });
        }
      }

      const { data: entry } = await admin
        .from("patient_queue")
        .select("id, status, doctor_id, clinic_id")
        .eq("id", entryId)
        .eq("clinic_id", profile!.clinic_id)
        .maybeSingle();

      if (!entry) {
        return NextResponse.json({ error: "الدور غير موجود" }, { status: 404 });
      }

      if (entry.status === "waiting") {
        await sendQueueEntryToDoctor(entryId, true);
      }

      return NextResponse.json({ success: true });
    }

    if (!staffRolesOk(role)) {
      return NextResponse.json(
        { error: `غير مصرح — دورك "${profile.role ?? "?"}" لا يسمح بإضافة مراجع` },
        { status: 403 }
      );
    }

    const doctorId = String(body.doctor_id ?? "").trim();
    if (!doctorId) {
      return NextResponse.json({ error: "اختر الطبيب" }, { status: 400 });
    }

    if (isApiAssistantRole(role)) {
      const ctx = await resolveAssistantApiContext(profile);
      if (!ctx) {
        return NextResponse.json({ error: "حساب المساعد غير مربوط" }, { status: 403 });
      }
      if (doctorId !== ctx.doctorId) {
        return NextResponse.json({ error: "غير مصرح — طبيب آخر" }, { status: 403 });
      }
    }

    const sendToDoctor =
      body.send_to_doctor !== false;

    const id = await insertQueueEntry({
      clinic_id: profile.clinic_id,
      doctor_id: doctorId,
      patient_name: body.patient_name,
      patient_phone: body.patient_phone,
      patient_id: body.patient_id,
      send_to_doctor: sendToDoctor,
      notes: body.notes,
    });

    return NextResponse.json({ success: true, id, doctor_id: doctorId });
  } catch (err) {
    console.error("[api/queue POST]", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "تعذر تنفيذ العملية" },
      { status: 500 }
    );
  }
}
