import { NextRequest, NextResponse } from "next/server";
import {
  getApiCallerProfile,
  isApiDoctorRole,
  isApiStaffRole,
  isApiAssistantRole,
} from "@/lib/auth/api-session";
import { getAdminClient } from "@/lib/supabase/admin";
import { getDoctorByProfileId } from "@/lib/queue/server";
import { assertDoctorOwnsQueueEntry } from "@/lib/auth/resolve-doctor-api";
import { patientBelongsToDoctor } from "@/lib/services/doctor-patients";
import { buildLedgerPayUrl } from "@/lib/ledger/navigation";
import { ensureQueueEntryPatient } from "@/lib/services/ensure-queue-entry-patient";
import {
  ensureVisitSessionOperation,
  getVisitSessionByQueueEntry,
} from "@/lib/services/visit-session";
import {
  assertAssistantOwnsQueueEntry,
  resolveAssistantApiContext,
} from "@/lib/auth/resolve-assistant-api";

function staffOk(role: string) {
  return isApiStaffRole(role) || isApiAssistantRole(role);
}

function toPayload(
  session: Awaited<ReturnType<typeof ensureVisitSessionOperation>>
) {
  return {
    operationId: session.operationId,
    queueEntryId: session.queueEntryId,
    queueStatus: session.queueStatus,
    patientId: session.patientId,
    doctorId: session.doctorId,
    appointmentId: session.appointmentId,
    ledgerUrl: buildLedgerPayUrl({
      queueEntryId: session.queueEntryId,
      patientId: session.patientId,
      doctorId: session.doctorId,
      appointmentId: session.appointmentId,
    }),
    withoutQueue: session.withoutQueue ?? false,
  };
}

/** GET ?queue_entry_id= — جلسة الزيارة المرتبطة بالطابور */
export async function GET(req: NextRequest) {
  try {
    const profile = await getApiCallerProfile(req);
    if (!profile?.clinic_id) {
      return NextResponse.json({ error: "غير مصرح" }, { status: 401 });
    }

    const role = String(profile.role ?? "");
    if (!isApiDoctorRole(role) && !staffOk(role)) {
      return NextResponse.json({ error: "غير مصرح" }, { status: 403 });
    }

    const queueEntryId = req.nextUrl.searchParams.get("queue_entry_id")?.trim();
    if (!queueEntryId) {
      return NextResponse.json({ error: "queue_entry_id مطلوب" }, { status: 400 });
    }

    const admin = getAdminClient();

    if (isApiAssistantRole(role)) {
      const ctx = await resolveAssistantApiContext(profile);
      if (!ctx) {
        return NextResponse.json(
          { error: "حساب المساعد غير مربوط بطبيب" },
          { status: 403 }
        );
      }
      const check = await assertAssistantOwnsQueueEntry(queueEntryId, ctx);
      if (!check.ok) {
        return NextResponse.json({ error: check.error }, { status: check.status });
      }
    }

    if (isApiDoctorRole(role)) {
      const doctor = await getDoctorByProfileId(profile.id);
      if (!doctor || doctor.clinic_id !== profile.clinic_id) {
        return NextResponse.json({ error: "حساب الطبيب غير مربوط" }, { status: 403 });
      }
      const check = await assertDoctorOwnsQueueEntry(queueEntryId, {
        clinicId: profile.clinic_id,
        doctorId: doctor.id,
      });
      if (!check.ok) {
        return NextResponse.json({ error: check.error }, { status: check.status });
      }
    }

    const session = await getVisitSessionByQueueEntry(
      admin,
      profile.clinic_id as string,
      queueEntryId
    );

    if (!session) {
      return NextResponse.json({ error: "لا توجد جلسة مرتبطة" }, { status: 404 });
    }

    return NextResponse.json(toPayload(session));
  } catch (err) {
    console.error("[operations/visit-session GET]", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "خطأ" },
      { status: 500 }
    );
  }
}

/** POST { patient_id, queue_entry_id? } — إنشاء/جلب جلسة الكشف للسجل البصري */
export async function POST(req: NextRequest) {
  try {
    const profile = await getApiCallerProfile(req);
    if (!profile?.clinic_id) {
      return NextResponse.json({ error: "غير مصرح" }, { status: 401 });
    }

    const role = String(profile.role ?? "");
    const isDoctor = isApiDoctorRole(role);
    const isAssistant = isApiAssistantRole(role);
    if (!isDoctor && !staffOk(role)) {
      return NextResponse.json({ error: "غير مصرح" }, { status: 403 });
    }

    const body = (await req.json().catch(() => ({}))) as {
      patient_id?: string;
      queue_entry_id?: string | null;
    };

    const admin = getAdminClient();
    let patientId = String(body.patient_id ?? "").trim();
    let doctorId: string | undefined;
    const queueEntryId = body.queue_entry_id
      ? String(body.queue_entry_id).trim()
      : null;

    if (isAssistant) {
      const ctx = await resolveAssistantApiContext(profile);
      if (!ctx) {
        return NextResponse.json(
          { error: "حساب المساعد غير مربوط بطبيب" },
          { status: 403 }
        );
      }
      doctorId = ctx.doctorId;
      if (queueEntryId) {
        const check = await assertAssistantOwnsQueueEntry(queueEntryId, ctx);
        if (!check.ok) {
          return NextResponse.json({ error: check.error }, { status: check.status });
        }
      }
    }

    if (isDoctor) {
      const doctor = await getDoctorByProfileId(profile.id);
      if (!doctor) {
        return NextResponse.json({ error: "حساب الطبيب غير مربوط" }, { status: 403 });
      }
      doctorId = doctor.id;
      if (queueEntryId) {
        const check = await assertDoctorOwnsQueueEntry(queueEntryId, {
          clinicId: profile.clinic_id as string,
          doctorId: doctor.id,
        });
        if (!check.ok) {
          return NextResponse.json({ error: check.error }, { status: check.status });
        }
      }
    }

    if (!patientId && queueEntryId) {
      try {
        const ctx = await ensureQueueEntryPatient(
          admin,
          queueEntryId,
          profile.clinic_id as string
        );
        patientId = ctx.patientId;
        doctorId = doctorId ?? ctx.doctorId;
      } catch (err) {
        return NextResponse.json(
          {
            error:
              err instanceof Error
                ? err.message
                : "لا يوجد ملف مريض لهذا الدور — أدخل اسم المراجع أو هاتفه في الطابور",
          },
          { status: 400 }
        );
      }
    }

    if (!patientId) {
      return NextResponse.json(
        { error: "patient_id أو queue_entry_id مطلوب" },
        { status: 400 }
      );
    }

    if (isDoctor && doctorId) {
      const allowed = await patientBelongsToDoctor(admin, patientId, doctorId);
      if (!allowed) {
        return NextResponse.json({ error: "غير مصرح" }, { status: 403 });
      }
    }

    if (!doctorId) {
      if (queueEntryId) {
        const { data: entry } = await admin
          .from("patient_queue")
          .select("doctor_id")
          .eq("id", queueEntryId)
          .eq("clinic_id", profile.clinic_id)
          .maybeSingle();
        doctorId = entry?.doctor_id as string | undefined;
      }

      if (!doctorId) {
        const { data: recentOp } = await admin
          .from("patient_operations")
          .select("doctor_id")
          .eq("clinic_id", profile.clinic_id)
          .eq("patient_id", patientId)
          .order("operation_date", { ascending: false })
          .limit(1)
          .maybeSingle();
        doctorId = recentOp?.doctor_id as string | undefined;
      }

      if (!doctorId) {
        return NextResponse.json(
          { error: "تعذر تحديد الطبيب — افتح الزيارة من الطابور" },
          { status: 400 }
        );
      }
    }

    const session = await ensureVisitSessionOperation(admin, {
      clinicId: profile.clinic_id as string,
      doctorId,
      patientId,
      queueEntryId,
      createdBy: profile.id,
      allowWithoutQueue: isDoctor,
    });

    return NextResponse.json(toPayload(session));
  } catch (err) {
    console.error("[operations/visit-session POST]", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "خطأ" },
      { status: 500 }
    );
  }
}
