import { NextRequest, NextResponse } from "next/server";
import { getApiCallerProfile } from "@/lib/auth/api-session";
import { getAdminClient } from "@/lib/supabase/admin";
import {
  syncTreatmentCaseAfterSession,
  isPersistedTreatmentCaseId,
} from "@/lib/services/patient-treatment-cases";
import type { PatientFinancialPlan } from "@/lib/services/patient-financial-plan";

/**
 * POST — مزامنة ذمة الحالة بعد جلسة (يتجاوز RLS من المتصفح).
 * نفس سبب createTreatmentCaseViaApi: قراءة/تحديث patient_treatment_cases من العميل قد تفشل.
 */
export async function POST(req: NextRequest) {
  try {
    const profile = await getApiCallerProfile();
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

    const body = (await req.json()) as {
      patientId?: string;
      treatmentName?: string;
      paidDelta?: number;
      additionalDiscount?: number;
      caseId?: string | null;
      plan?: PatientFinancialPlan;
    };

    const patientId = String(body.patientId ?? "").trim();
    const treatmentName = String(body.treatmentName ?? "").trim();
    const paidDelta = Number(body.paidDelta ?? 0);
    const additionalDiscount = Number(body.additionalDiscount ?? 0);
    const caseId = body.caseId?.trim() || null;
    const plan = body.plan;

    if (!patientId || !plan || typeof plan !== "object") {
      return NextResponse.json(
        { error: "patientId و plan مطلوبان" },
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

    if (caseId && isPersistedTreatmentCaseId(caseId)) {
      const { data: caseRow } = await admin
        .from("patient_treatment_cases")
        .select("id, clinic_id")
        .eq("id", caseId)
        .maybeSingle();

      if (!caseRow || caseRow.clinic_id !== profile.clinic_id) {
        return NextResponse.json(
          { error: "حالة العلاج غير موجودة" },
          { status: 404 }
        );
      }
    }

    const result = await syncTreatmentCaseAfterSession(admin, {
      patientId,
      clinicId: profile.clinic_id,
      treatmentName: treatmentName || "علاج",
      plan,
      paidDelta: Number.isFinite(paidDelta) ? paidDelta : 0,
      additionalDiscount: Number.isFinite(additionalDiscount)
        ? additionalDiscount
        : 0,
      caseId,
    });

    return NextResponse.json(result);
  } catch (err) {
    console.error("[api/treatment-cases/sync-session]", err);
    return NextResponse.json(
      { ok: false, completed: false, error: err instanceof Error ? err.message : "خطأ" },
      { status: 500 }
    );
  }
}
