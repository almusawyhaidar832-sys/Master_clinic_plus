import { NextRequest, NextResponse } from "next/server";
import { getApiCallerProfile } from "@/lib/auth/api-session";
import { getAdminClient } from "@/lib/supabase/admin";
import { transferTreatmentCaseDoctor } from "@/lib/services/patient-doctor-transfer";
import { translateDbError } from "@/lib/db-errors";

/** POST — تحويل حالة علاج لطبيب جديد (الجلسات السابقة لا تُعدَّل) */
export async function POST(
  req: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  try {
    const profile = await getApiCallerProfile();
    if (!profile?.clinic_id) {
      return NextResponse.json({ error: "غير مصرح" }, { status: 401 });
    }

    const role = String(profile.role ?? "").toLowerCase();
    if (role !== "accountant" && role !== "super_admin") {
      return NextResponse.json({ error: "غير مصرح" }, { status: 403 });
    }

    const { id: patientId } = await context.params;
    const body = (await req.json()) as {
      doctor_id?: string;
      treatment_case_id?: string;
      notes?: string;
    };

    const newDoctorId = String(body.doctor_id ?? "").trim();
    const treatmentCaseId = String(body.treatment_case_id ?? "").trim();

    if (!newDoctorId) {
      return NextResponse.json({ error: "اختر الطبيب الجديد" }, { status: 400 });
    }
    if (!treatmentCaseId) {
      return NextResponse.json({ error: "اختر حالة العلاج أولاً" }, { status: 400 });
    }

    const admin = getAdminClient();
    const result = await transferTreatmentCaseDoctor(admin, {
      clinicId: profile.clinic_id,
      patientId,
      treatmentCaseId,
      newDoctorId,
      transferredBy: profile.id,
      notes: body.notes,
    });

    if (result.error && !result.primaryDoctor?.id) {
      return NextResponse.json(
        { error: translateDbError(result.error) },
        { status: 400 }
      );
    }

    if (result.error) {
      return NextResponse.json(
        {
          success: true,
          primaryDoctor: result.primaryDoctor,
          treatmentCaseId,
          warning: result.error,
        },
        { status: 200 }
      );
    }

    return NextResponse.json({
      success: true,
      primaryDoctor: result.primaryDoctor,
      treatmentCaseId,
    });
  } catch (err) {
    console.error("[api/patients/transfer-doctor]", err);
    const msg = err instanceof Error ? err.message : "تعذر التحويل";
    return NextResponse.json({ error: translateDbError(msg) }, { status: 500 });
  }
}
