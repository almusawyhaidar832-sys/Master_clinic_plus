import { NextRequest, NextResponse } from "next/server";
import { getApiCallerProfile } from "@/lib/auth/api-session";
import { getAdminClient } from "@/lib/supabase/admin";
import {
  completeTreatmentCase,
  isPersistedTreatmentCaseId,
  registerTreatmentCaseDebt,
} from "@/lib/services/patient-treatment-cases";

/** POST — تسجيل دين أو إغلاق حالة (بدون سعر كلي) */
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
      role !== "admin" &&
      role !== "doctor"
    ) {
      return NextResponse.json({ error: "غير مصرح" }, { status: 403 });
    }

    const body = (await req.json()) as {
      action?: string;
      caseId?: string;
      debtAmount?: number;
      replace?: boolean;
    };

    const action = String(body.action ?? "").trim();
    const caseId = String(body.caseId ?? "").trim();

    if (!caseId || !isPersistedTreatmentCaseId(caseId)) {
      return NextResponse.json({ error: "معرّف الحالة مطلوب" }, { status: 400 });
    }

    const admin = getAdminClient();
    const { data: caseRow } = await admin
      .from("patient_treatment_cases")
      .select("id, clinic_id")
      .eq("id", caseId)
      .maybeSingle();

    if (!caseRow || caseRow.clinic_id !== profile.clinic_id) {
      return NextResponse.json({ error: "حالة العلاج غير موجودة" }, { status: 404 });
    }

    if (action === "debt") {
      const debtAmount = Number(body.debtAmount ?? 0);
      const result = await registerTreatmentCaseDebt(admin, {
        caseId,
        debtAmount,
        replace: Boolean(body.replace),
      });
      if (!result.ok) {
        return NextResponse.json(
          { ok: false, error: result.error ?? "تعذر تسجيل الدين" },
          { status: 400 }
        );
      }
      return NextResponse.json({
        ok: true,
        remainingBalance: result.remainingBalance,
      });
    }

    if (action === "complete") {
      const result = await completeTreatmentCase(admin, caseId);
      if (!result.ok) {
        return NextResponse.json(
          { ok: false, error: result.error ?? "تعذر إغلاق الحالة" },
          { status: 400 }
        );
      }
      return NextResponse.json({ ok: true });
    }

    return NextResponse.json({ error: "إجراء غير معروف" }, { status: 400 });
  } catch (err) {
    console.error("[api/treatment-cases/billing-action POST]", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "خطأ" },
      { status: 500 }
    );
  }
}
