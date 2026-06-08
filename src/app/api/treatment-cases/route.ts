import { NextRequest, NextResponse } from "next/server";
import { getApiCallerProfile } from "@/lib/auth/api-session";
import { getAdminClient } from "@/lib/supabase/admin";
import { assignPrimaryDoctorForSession } from "@/lib/services/patient-primary-doctor";
import {
  createTreatmentCase,
  fetchPatientTreatmentCasesDirect,
} from "@/lib/services/patient-treatment-cases";

/** GET — كل حالات المريض (يتجاوز RLS — يظهر الحالات الجديدة في ملخص الحالات) */
export async function GET(req: NextRequest) {
  try {
    const profile = await getApiCallerProfile(req);
    if (!profile?.clinic_id) {
      return NextResponse.json({ error: "غير مصرح" }, { status: 401 });
    }

    const role = String(profile.role ?? "").toLowerCase();
    if (
      role !== "accountant" &&
      role !== "super_admin" &&
      role !== "doctor"
    ) {
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
    if (!profile?.clinic_id) {
      return NextResponse.json({ error: "غير مصرح" }, { status: 401 });
    }

    const role = String(profile.role ?? "").toLowerCase();
    if (
      role !== "accountant" &&
      role !== "super_admin" &&
      role !== "doctor"
    ) {
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
    if (!Number.isFinite(casePrice) || casePrice <= 0) {
      return NextResponse.json(
        { error: "السعر الكلي للحالة مطلوب" },
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

    const created = await createTreatmentCase(admin, {
      patientId,
      clinicId: profile.clinic_id,
      treatmentName,
      casePrice,
      discount: Number.isFinite(discount) ? discount : 0,
      paid: Number.isFinite(paid) ? paid : 0,
      doctorShare: Number.isFinite(doctorShare) ? doctorShare : 0,
      clinicShare: Number.isFinite(clinicShare) ? clinicShare : 0,
      primaryDoctorId: doctorId,
    });

    if (!created.case) {
      return NextResponse.json(
        { error: created.error ?? "تعذر إنشاء الحالة" },
        { status: 500 }
      );
    }

    await assignPrimaryDoctorForSession(admin, {
      patientId,
      doctorId,
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
