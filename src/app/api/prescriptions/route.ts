import { NextRequest, NextResponse } from "next/server";
import {
  getApiCallerProfile,
  isApiAssistantRole,
  isApiDoctorRole,
  isApiStaffRole,
} from "@/lib/auth/api-session";
import {
  assertAssistantOwnsOperation,
  assertAssistantOwnsQueueEntry,
  resolveAssistantApiContext,
} from "@/lib/auth/resolve-assistant-api";
import { getAdminClient } from "@/lib/supabase/admin";
import { getDoctorByProfileId } from "@/lib/queue/server";
import {
  fetchPrescriptionForSession,
  fetchPrescriptionPrintData,
  upsertPrescription,
  normalizeMedications,
} from "@/lib/prescriptions/server";

function canReadPrescriptions(role: string) {
  return (
    isApiStaffRole(role) || isApiDoctorRole(role) || isApiAssistantRole(role)
  );
}

async function assertAssistantPrescriptionScope(
  profile: { id: string; clinic_id: string | null; role?: string | null },
  input: { operationId?: string | null; queueEntryId?: string | null }
): Promise<NextResponse | null> {
  if (!isApiAssistantRole(profile.role)) return null;

  const ctx = await resolveAssistantApiContext(profile);
  if (!ctx) {
    return NextResponse.json(
      { error: "حساب المساعد غير مربوط بطبيب" },
      { status: 403 }
    );
  }

  const operationId = String(input.operationId ?? "").trim();
  if (operationId) {
    const check = await assertAssistantOwnsOperation(operationId, ctx);
    if (!check.ok) {
      return NextResponse.json({ error: check.error }, { status: check.status });
    }
    return null;
  }

  const queueEntryId = String(input.queueEntryId ?? "").trim();
  if (queueEntryId) {
    const check = await assertAssistantOwnsQueueEntry(queueEntryId, ctx);
    if (!check.ok) {
      return NextResponse.json({ error: check.error }, { status: check.status });
    }
  }

  return null;
}

/** GET ?operation_id= | ?id=&print=1 */
export async function GET(req: NextRequest) {
  try {
    const profile = await getApiCallerProfile(req);
    if (!profile?.clinic_id) {
      return NextResponse.json({ error: "غير مصرح" }, { status: 401 });
    }

    const role = String(profile.role ?? "").toLowerCase();
    if (!canReadPrescriptions(role)) {
      return NextResponse.json({ error: "غير مصرح" }, { status: 403 });
    }

    const clinicId = profile.clinic_id as string;
    const admin = getAdminClient();
    const operationId = req.nextUrl.searchParams.get("operation_id");
    const queueEntryId = req.nextUrl.searchParams.get("queue_entry_id");
    const prescriptionId = req.nextUrl.searchParams.get("id");
    const forPrint = req.nextUrl.searchParams.get("print") === "1";

    if (prescriptionId && forPrint) {
      const data = await fetchPrescriptionPrintData(
        admin,
        clinicId,
        prescriptionId
      );
      if (!data) {
        return NextResponse.json({ error: "الوصفة غير موجودة" }, { status: 404 });
      }
      return NextResponse.json(data);
    }

    const scopeError = await assertAssistantPrescriptionScope(profile, {
      operationId,
      queueEntryId,
    });
    if (scopeError) return scopeError;

    if (operationId) {
      const prescription = await fetchPrescriptionForSession(admin, clinicId, {
        operationId,
        queueEntryId,
      });
      if (!prescription) {
        return NextResponse.json({ error: "لا توجد وصفة" }, { status: 404 });
      }
      return NextResponse.json({ prescription });
    }

    if (queueEntryId && !operationId) {
      const prescription = await fetchPrescriptionForSession(admin, clinicId, {
        queueEntryId,
      });
      if (!prescription) {
        return NextResponse.json({ error: "لا توجد وصفة" }, { status: 404 });
      }
      return NextResponse.json({ prescription });
    }

    return NextResponse.json(
      { error: "operation_id أو queue_entry_id أو id مطلوب" },
      { status: 400 }
    );
  } catch (e) {
    const msg = e instanceof Error ? e.message : "خطأ غير متوقع";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

/** POST — حفظ/تحديث وصفة جلسة الكشف (الطبيب أو مساعده) */
export async function POST(req: NextRequest) {
  try {
    const profile = await getApiCallerProfile(req);
    if (!profile?.clinic_id) {
      return NextResponse.json({ error: "غير مصرح" }, { status: 401 });
    }

    const role = String(profile.role ?? "").toLowerCase();
    const isDoctor = isApiDoctorRole(role);
    const isAssistant = isApiAssistantRole(role);
    if (!isDoctor && !isAssistant) {
      return NextResponse.json({ error: "للطبيب أو مساعده فقط" }, { status: 403 });
    }

    let doctorId: string | null = null;
    let assistantCtx: Awaited<ReturnType<typeof resolveAssistantApiContext>> = null;

    if (isDoctor) {
      const doctor = await getDoctorByProfileId(profile.id);
      if (!doctor) {
        return NextResponse.json({ error: "حساب الطبيب غير مربوط" }, { status: 403 });
      }
      doctorId = doctor.id;
    } else {
      assistantCtx = await resolveAssistantApiContext(profile);
      if (!assistantCtx) {
        return NextResponse.json(
          { error: "حساب المساعد غير مربوط بطبيب" },
          { status: 403 }
        );
      }
      doctorId = assistantCtx.doctorId;
    }

    const body = (await req.json()) as {
      operation_id?: string;
      patient_id?: string;
      doctor_id?: string;
      queue_entry_id?: string;
      diagnosis_ar?: string;
      notes_ar?: string;
      medications?: unknown;
    };

    const operationId = String(body.operation_id ?? "").trim();
    let patientId = String(body.patient_id ?? "").trim();
    if (!operationId) {
      return NextResponse.json({ error: "operation_id مطلوب" }, { status: 400 });
    }

    if (isAssistant && assistantCtx) {
      const check = await assertAssistantOwnsOperation(operationId, assistantCtx);
      if (!check.ok) {
        return NextResponse.json({ error: check.error }, { status: check.status });
      }
    }

    const admin = getAdminClient();
    const clinicId = profile.clinic_id as string;

    const { data: operation, error: opError } = await admin
      .from("patient_operations")
      .select("id, patient_id, clinic_id, doctor_id, queue_entry_id")
      .eq("id", operationId)
      .eq("clinic_id", clinicId)
      .maybeSingle();

    if (opError) {
      return NextResponse.json({ error: opError.message }, { status: 500 });
    }
    if (!operation?.patient_id) {
      return NextResponse.json(
        { error: "جلسة الكشف غير موجودة — أعد تحميل الصفحة" },
        { status: 404 }
      );
    }

    if (doctorId && operation.doctor_id !== doctorId) {
      return NextResponse.json({ error: "غير مصرح" }, { status: 403 });
    }

    if (!patientId) {
      patientId = String(operation.patient_id);
    }
    if (patientId !== String(operation.patient_id)) {
      return NextResponse.json(
        { error: "المريض لا يطابق جلسة الكشف" },
        { status: 400 }
      );
    }

    const queueEntryId =
      String(body.queue_entry_id ?? "").trim() ||
      (operation.queue_entry_id ? String(operation.queue_entry_id) : null);

    const prescription = await upsertPrescription(admin, {
      clinicId,
      patientId,
      doctorId: doctorId ?? String(operation.doctor_id),
      operationId,
      queueEntryId,
      diagnosisAr: body.diagnosis_ar,
      notesAr: body.notes_ar,
      medications: normalizeMedications(body.medications),
      createdBy: profile.id as string,
    });

    return NextResponse.json({ prescription });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "خطأ غير متوقع";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
