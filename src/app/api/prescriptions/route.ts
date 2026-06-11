import { NextRequest, NextResponse } from "next/server";
import {
  getApiCallerProfile,
  isApiDoctorRole,
  isApiStaffRole,
} from "@/lib/auth/api-session";
import { getAdminClient } from "@/lib/supabase/admin";
import { getDoctorByProfileId } from "@/lib/queue/server";
import {
  fetchPrescriptionForSession,
  fetchPrescriptionPrintData,
  upsertPrescription,
  normalizeMedications,
} from "@/lib/prescriptions/server";

/** GET ?operation_id= | ?id=&print=1 */
export async function GET(req: NextRequest) {
  try {
    const profile = await getApiCallerProfile(req);
    if (!profile?.clinic_id) {
      return NextResponse.json({ error: "غير مصرح" }, { status: 401 });
    }

    const role = String(profile.role ?? "").toLowerCase();
    if (!isApiStaffRole(role) && !isApiDoctorRole(role)) {
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

/** POST — حفظ/تحديث وصفة جلسة الكشف (الطبيب) */
export async function POST(req: NextRequest) {
  try {
    const profile = await getApiCallerProfile(req);
    if (!profile?.clinic_id) {
      return NextResponse.json({ error: "غير مصرح" }, { status: 401 });
    }

    const role = String(profile.role ?? "").toLowerCase();
    if (!isApiDoctorRole(role)) {
      return NextResponse.json({ error: "للطبيب فقط" }, { status: 403 });
    }

    const doctor = await getDoctorByProfileId(profile.id);
    if (!doctor) {
      return NextResponse.json({ error: "حساب الطبيب غير مربوط" }, { status: 403 });
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
      doctorId: doctor.id,
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
