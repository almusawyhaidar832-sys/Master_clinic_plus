import { NextRequest, NextResponse } from "next/server";
import { getApiCallerProfile } from "@/lib/auth/api-session";
import { getAdminClient } from "@/lib/supabase/admin";
import { writeAuditLog } from "@/lib/audit/write-audit-log";
import { runSessionSavedAutomation } from "@/lib/automation/run";
import {
  buildOperationAmountAuditNote,
  syncFinancialsAfterOperationEdit,
  type OperationAmountRow,
} from "@/lib/services/operation-amount-edit";

const EDITABLE_FIELDS = [
  "paid_amount",
  "notes",
  "operation_date",
  "total_amount",
  "operation_name_ar",
  "operation_type",
  "is_review_statement",
  "review_fee_amount",
] as const;

/** PATCH — تعديل جلسة مع سجل تدقيق */
export async function PATCH(
  req: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
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

    const { id } = await context.params;
    const body = (await req.json()) as Record<string, unknown>;
    const admin = getAdminClient();

    const { data: before, error: loadErr } = await admin
      .from("patient_operations")
      .select("*")
      .eq("id", id)
      .eq("clinic_id", profile.clinic_id)
      .maybeSingle();

    if (loadErr || !before) {
      return NextResponse.json({ error: "الجلسة غير موجودة" }, { status: 404 });
    }

    if (role === "doctor") {
      const { data: doc } = await admin
        .from("doctors")
        .select("id")
        .eq("profile_id", profile.id)
        .maybeSingle();
      if (!doc || doc.id !== before.doctor_id) {
        return NextResponse.json({ error: "غير مصرح" }, { status: 403 });
      }
    }

    const patch: Record<string, unknown> = {};
    for (const key of EDITABLE_FIELDS) {
      if (body[key] !== undefined) patch[key] = body[key];
    }

    if (Object.keys(patch).length === 0) {
      return NextResponse.json({ error: "لا حقول للتحديث" }, { status: 400 });
    }

    const { data: after, error: updErr } = await admin
      .from("patient_operations")
      .update(patch)
      .eq("id", id)
      .select("*")
      .single();

    if (updErr) {
      return NextResponse.json(
        { error: updErr.message || "فشل التحديث" },
        { status: 500 }
      );
    }

    const beforePaid = Number(before.paid_amount ?? 0);
    const afterPaid = Number(after.paid_amount ?? 0);
    const beforeTotal = Number(before.total_amount ?? 0);
    const afterTotal = Number(after.total_amount ?? 0);
    const beforeReview = Number(before.review_fee_amount ?? 0);
    const afterReview = Number(after.review_fee_amount ?? 0);
    const beforeIsReview = Boolean(before.is_review_statement);
    const afterIsReview = Boolean(after.is_review_statement);
    const paidDelta = Math.round((afterPaid - beforePaid) * 100) / 100;
    const totalDelta = Math.round((afterTotal - beforeTotal) * 100) / 100;
    const financialFieldsChanged =
      paidDelta !== 0 ||
      totalDelta !== 0 ||
      beforeReview !== afterReview ||
      beforeIsReview !== afterIsReview;

    if (financialFieldsChanged) {
      const sync = await syncFinancialsAfterOperationEdit(
        admin,
        before as OperationAmountRow,
        after as OperationAmountRow
      );
      if (!sync.ok) {
        return NextResponse.json(
          { error: sync.error ?? "تعذر مزامنة المبالغ بعد التعديل" },
          { status: 500 }
        );
      }

      const { data: refreshed } = await admin
        .from("patient_operations")
        .select("*")
        .eq("id", id)
        .single();
      if (refreshed) {
        Object.assign(after as Record<string, unknown>, refreshed);
      }
    }

    const auditNote =
      typeof body.audit_note === "string"
        ? body.audit_note
        : buildOperationAmountAuditNote(
            before as OperationAmountRow,
            after as OperationAmountRow
          );

    const beforeDoc = Number(before.doctor_share_amount ?? 0);
    const afterDoc = Number(
      (after as Record<string, unknown>).doctor_share_amount ?? 0
    );
    const docDelta = Math.round((afterDoc - beforeDoc) * 100) / 100;

    await writeAuditLog(admin, {
      clinicId: profile.clinic_id,
      entityType: "patient_operation",
      entityId: id,
      action: "update",
      changedBy: profile.id,
      actorName: profile.full_name ?? null,
      financialAmount:
        paidDelta !== 0
          ? paidDelta
          : totalDelta !== 0
            ? totalDelta
            : docDelta !== 0
              ? docDelta
              : null,
      before: before as Record<string, unknown>,
      after: after as Record<string, unknown>,
      note: auditNote,
    });

    void runSessionSavedAutomation(id, {
      skipPatientWhatsApp: body.notify_patient === false,
      treatmentCompleted: body.treatment_completed === true,
    }).catch((e) =>
      console.error("[operations/PATCH] automation", e)
    );

    return NextResponse.json({ success: true, operation: after });
  } catch (err) {
    console.error("[operations/PATCH]", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "خطأ" },
      { status: 500 }
    );
  }
}
