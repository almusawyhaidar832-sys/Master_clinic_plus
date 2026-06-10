import { NextRequest, NextResponse } from "next/server";
import {
  getApiCallerProfile,
  isApiAssistantRole,
  isApiStaffRole,
} from "@/lib/auth/api-session";
import { getAdminClient } from "@/lib/supabase/admin";
import { transferTreatmentCaseDoctor } from "@/lib/services/patient-doctor-transfer";
import { translateDbError } from "@/lib/db-errors";

/** POST — تحويل حالة علاج لطبيب جديد (الجلسات السابقة لا تُعدَّل) */
export async function POST(
  req: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  try {
    const profile = await getApiCallerProfile(req);
    if (!profile?.clinic_id) {
      return NextResponse.json(
        { error: "غير مصرح — سجّل الدخول من بوابة المحاسب" },
        { status: 401 }
      );
    }

    if (!process.env.SUPABASE_SERVICE_ROLE_KEY) {
      return NextResponse.json(
        {
          error:
            "SUPABASE_SERVICE_ROLE_KEY غير مضبوط في .env.local — لا يمكن تنفيذ التحويل",
        },
        { status: 500 }
      );
    }

    const role = String(profile.role ?? "");
    if (!isApiStaffRole(role) && !isApiAssistantRole(role)) {
      return NextResponse.json(
        { error: `غير مصرح — دورك «${role || "?"}» لا يسمح بتحويل الطبيب` },
        { status: 403 }
      );
    }

    const { id: patientId } = await context.params;

    const admin = getAdminClient();
    const { data: patientRow } = await admin
      .from("patients")
      .select("clinic_id")
      .eq("id", patientId)
      .maybeSingle();

    if (
      !patientRow ||
      String(patientRow.clinic_id) !== String(profile.clinic_id)
    ) {
      return NextResponse.json(
        { error: "غير مصرح — المريض لا ينتمي لعيادتك" },
        { status: 403 }
      );
    }
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

    const result = await transferTreatmentCaseDoctor(admin, {
      clinicId: profile.clinic_id as string,
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
