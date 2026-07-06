import { NextRequest, NextResponse } from "next/server";
import { getApiCallerProfile } from "@/lib/auth/api-session";
import { getAdminClient } from "@/lib/supabase/admin";
import { getDoctorByProfileId } from "@/lib/queue/server";
import { assignPrimaryDoctorForSession } from "@/lib/services/patient-primary-doctor";
import {
  patientBelongsToDoctor,
  filterTreatmentCasesForDoctor,
} from "@/lib/services/doctor-patients";
import {
  createTreatmentCase,
  fetchPatientTreatmentCasesDirect,
} from "@/lib/services/patient-treatment-cases";
import type { PatientOperation } from "@/types";

/** GET — كل حالات المريض (يتجاوز RLS — يظهر الحالات الجديدة في ملخص الحالات) */
export async function GET(req: NextRequest) {
  try {
    const profile = await getApiCallerProfile(req);
    const roleNorm = String(profile?.role ?? "").toLowerCase();
    const allowedRole =
      roleNorm === "accountant" ||
      roleNorm === "super_admin" ||
      roleNorm === "admin" ||
      roleNorm === "doctor";
    if (!profile?.clinic_id) {
      return NextResponse.json({ error: "غير مصرح" }, { status: 401 });
    }

    if (!allowedRole) {
      return NextResponse.json({ error: "غير مصرح" }, { status: 403 });
    }

    const patientId = req.nextUrl.searchParams.get("patientId")?.trim();
    if (!patientId) {
      return NextResponse.json(
        { error: "معرّف المريض مطلوب" },
        { status: 400 }
      );
    }

    const admin = getAdminClient();
    const { data: patient } = await admin
      .from("patients")
      .select("id, clinic_id")
      .eq("id", patientId)
      .maybeSingle();

    if (!patient || patient.clinic_id !== profile.clinic_id) {
      return NextResponse.json({ error: "المريض غير موجود" }, { status: 404 });
    }

    if (roleNorm === "doctor") {
      const doctor = await getDoctorByProfileId(profile.id);
      if (!doctor || doctor.clinic_id !== profile.clinic_id) {
        return NextResponse.json({ error: "حساب الطبيب غير مربوط" }, { status: 403 });
      }
      const allowed = await patientBelongsToDoctor(admin, patientId, doctor.id);
      if (!allowed) {
        return NextResponse.json({ error: "غير مصرح" }, { status: 403 });
      }

      let cases = await fetchPatientTreatmentCasesDirect(admin, patientId, {
        skipReconcile: true,
      });

      const { data: doctorOps } = await admin
        .from("patient_operations")
        .select("treatment_case_id")
        .eq("patient_id", patientId)
        .eq("doctor_id", doctor.id);
      cases = filterTreatmentCasesForDoctor(
        cases,
        (doctorOps ?? []) as Pick<PatientOperation, "treatment_case_id">[]
      );

      return NextResponse.json({ cases });
    }

    const cases = await fetchPatientTreatmentCasesDirect(admin, patientId, {
      skipReconcile: true,
    });
    return NextResponse.json({ cases });
  } catch (err) {
    console.error("[api/treatment-cases GET]", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "خطأ" },
      { status: 500 }
    );
  }
}

/** POST — إنشاء حالة علاج جديدة (يتجاوز RLS من المتصفح) */
export async function POST(req: NextRequest) {
  try {
    const profile = await getApiCallerProfile(req);
    const roleNorm = String(profile?.role ?? "").toLowerCase();
    const allowedRole =
      roleNorm === "accountant" ||
      roleNorm === "super_admin" ||
      roleNorm === "admin" ||
      roleNorm === "doctor";
    if (!profile?.clinic_id) {
      return NextResponse.json({ error: "غير مصرح" }, { status: 401 });
    }

    if (!allowedRole) {
      return NextResponse.json({ error: "غير مصرح" }, { status: 403 });
    }

    const body = (await req.json()) as Record<string, unknown>;
    const patientId = String(body.patientId ?? "").trim();
    const treatmentName = String(body.treatmentName ?? "").trim();
    const doctorId = String(body.doctorId ?? "").trim();
    const casePrice = Number(body.casePrice);
    const discount = Number(body.discount ?? 0);
    const paid = Number(body.paid ?? 0);
    const doctorShare = Number(body.doctorShare ?? 0);
    const clinicShare = Number(body.clinicShare ?? 0);

    if (!patientId || !treatmentName) {
      return NextResponse.json(
        { error: "معرّف المريض واسم العلاج مطلوبان" },
        { status: 400 }
      );
    }
    if (!doctorId) {
      return NextResponse.json({ error: "اختر الطبيب للحالة" }, { status: 400 });
    }
    const sessionOnly = Boolean(body.sessionOnly);
    if (!Number.isFinite(casePrice)) {
      return NextResponse.json({ error: "مبلغ غير صالح" }, { status: 400 });
    }
    if (casePrice <= 0 && !sessionOnly) {
      return NextResponse.json(
        { error: "السعر الكلي للحالة مطلوب" },
        { status: 400 }
      );
    }
    if (sessionOnly && casePrice > 0) {
      return NextResponse.json(
        { error: "وضع الجلسة لا يقبل سعراً كلياً" },
        { status: 400 }
      );
    }
    if (sessionOnly && paid <= 0) {
      return NextResponse.json(
        { error: "أدخل المبلغ المدفوع في الجلسة الأولى" },
        { status: 400 }
      );
    }

    const admin = getAdminClient();
    const { data: patient } = await admin
      .from("patients")
      .select("id, clinic_id")
      .eq("id", patientId)
      .maybeSingle();

    if (!patient || patient.clinic_id !== profile.clinic_id) {
      return NextResponse.json({ error: "المريض غير موجود" }, { status: 404 });
    }

    const { data: doctor } = await admin
      .from("doctors")
      .select("id, clinic_id")
      .eq("id", doctorId)
      .maybeSingle();

    if (!doctor || doctor.clinic_id !== profile.clinic_id) {
      return NextResponse.json(
        { error: "الطبيب غير موجود في هذه العيادة" },
        { status: 400 }
      );
    }

    let effectiveDoctorId = doctorId;
    if (roleNorm === "doctor") {
      const sessionDoctor = await getDoctorByProfileId(profile.id);
      if (!sessionDoctor || sessionDoctor.clinic_id !== profile.clinic_id) {
        return NextResponse.json({ error: "حساب الطبيب غير مربوط" }, { status: 403 });
      }
      const allowed = await patientBelongsToDoctor(
        admin,
        patientId,
        sessionDoctor.id
      );
      if (!allowed) {
        return NextResponse.json({ error: "غير مصرح" }, { status: 403 });
      }
      effectiveDoctorId = sessionDoctor.id;
    }

    const created = await createTreatmentCase(admin, {
      patientId,
      clinicId: profile.clinic_id,
      treatmentName,
      casePrice,
      discount: Number.isFinite(discount) ? discount : 0,
      paid: Number.isFinite(paid) ? paid : 0,
      doctorShare: Number.isFinite(doctorShare) ? doctorShare : 0,
      clinicShare: Number.isFinite(clinicShare) ? clinicShare : 0,
      primaryDoctorId: effectiveDoctorId,
    });

    if (!created.case) {
      return NextResponse.json(
        { error: created.error ?? "تعذر إنشاء الحالة" },
        { status: 500 }
      );
    }

    await assignPrimaryDoctorForSession(admin, {
      patientId,
      doctorId: effectiveDoctorId,
      caseId: created.case.id,
    });

    return NextResponse.json({ case: created.case });
  } catch (err) {
    console.error("[api/treatment-cases]", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "خطأ" },
      { status: 500 }
    );
  }
}
