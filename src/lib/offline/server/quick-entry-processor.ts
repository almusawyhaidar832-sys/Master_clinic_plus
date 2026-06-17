import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import {
  applyAdditionalDiscountFallback,
  computeFinalPrice,
  saveFirstSessionPlanFallback,
} from "@/lib/services/patient-financial-plan";
import { splitTreatmentAndReviewFee } from "@/lib/finance";
import {
  createTreatmentCase,
  isPersistedTreatmentCaseId,
  linkOperationToTreatmentCase,
  syncTreatmentCaseAfterSession,
} from "@/lib/services/patient-treatment-cases";
import { assignPrimaryDoctorForSession } from "@/lib/services/patient-primary-doctor";
import { completeVisitAfterPayment } from "@/lib/services/session-checkout";
import {
  patientPhoneColumns,
  validatePatientPhone,
} from "@/lib/phone";
import { isToothStatus } from "@/lib/clinical/tooth-status";
import { todayISO } from "@/lib/utils";
import type { QuickEntryOfflinePayload } from "@/lib/offline/types";
import type { PatientOperation } from "@/types";

export interface QuickEntryOfflineProcessResult {
  ok: boolean;
  operationId?: string;
  patientId?: string;
  error?: string;
}

async function resolvePatientId(
  admin: SupabaseClient,
  clinicId: string,
  payload: QuickEntryOfflinePayload
): Promise<{ patientId: string } | { error: string }> {
  if (payload.selectedPatientId) {
    const { data } = await admin
      .from("patients")
      .select("id, clinic_id")
      .eq("id", payload.selectedPatientId)
      .maybeSingle();
    if (!data || data.clinic_id !== clinicId) {
      return { error: "المريض غير موجود في هذه العيادة" };
    }
    return { patientId: data.id as string };
  }

  const name = payload.patientQuery.trim();
  const { data: existing } = await admin
    .from("patients")
    .select("id")
    .eq("full_name_ar", name)
    .eq("clinic_id", clinicId)
    .maybeSingle();

  if (existing?.id) {
    return { patientId: existing.id as string };
  }

  const phoneCheck = validatePatientPhone(payload.patientPhone);
  if (!phoneCheck.ok) {
    return { error: phoneCheck.message };
  }

  const { data: created, error } = await admin
    .from("patients")
    .insert({
      full_name_ar: name,
      clinic_id: clinicId,
      primary_doctor_id: payload.sessionDoctorId,
      ...patientPhoneColumns(phoneCheck.normalized),
    })
    .select("id")
    .single();

  if (error || !created?.id) {
    return { error: error?.message ?? "تعذر إنشاء سجل المريض" };
  }

  return { patientId: created.id as string };
}

async function insertPatientOperation(
  admin: SupabaseClient,
  input: {
    clinicId: string;
    patientId: string;
    doctorId: string;
    sessionKind: "plan" | "payment" | "discount";
    operationLabel: string;
    fields: Record<string, unknown>;
    optionalCols: Record<string, unknown>;
  }
): Promise<{ op: PatientOperation | null; error: string | null }> {
  const safePayload: Record<string, unknown> = {
    clinic_id: input.clinicId,
    patient_id: input.patientId,
    doctor_id: input.doctorId,
    operation_date: todayISO(),
    session_kind: input.sessionKind,
    ...input.fields,
  };

  const opColCandidates = [
    { key: "operation_name_ar", val: input.operationLabel },
    { key: "operation_type", val: input.operationLabel },
  ];

  for (const { key, val } of opColCandidates) {
    const payload = { ...safePayload, [key]: val, ...input.optionalCols };
    const result = await admin
      .from("patient_operations")
      .insert(payload)
      .select("*")
      .single();

    if (!result.error && result.data?.id) {
      return { op: result.data as PatientOperation, error: null };
    }

    const msg = result.error?.message ?? "";
    if (
      msg.includes("session_kind") ||
      msg.includes("discount_amount") ||
      msg.includes("treatment_case_id")
    ) {
      const stripped = { ...payload };
      delete stripped.session_kind;
      delete stripped.discount_amount;
      delete stripped.treatment_case_id;
      const retry = await admin
        .from("patient_operations")
        .insert(stripped)
        .select("*")
        .single();
      if (!retry.error && retry.data?.id) {
        return { op: retry.data as PatientOperation, error: null };
      }
    }

    if (
      msg.includes(key) ||
      msg.includes("schema cache") ||
      msg.includes("Could not find")
    ) {
      continue;
    }

    return { op: null, error: msg || "تعذر حفظ الجلسة" };
  }

  return { op: null, error: "تعذر حفظ الجلسة في قاعدة البيانات" };
}

async function saveClinicalTeeth(
  admin: SupabaseClient,
  clinicId: string,
  operationId: string,
  payload: QuickEntryOfflinePayload
): Promise<void> {
  const teeth = Object.values(payload.clinicalTeeth ?? {});
  if (!teeth.length) return;

  const rows = teeth.map((t) => ({
    clinic_id: clinicId,
    operation_id: operationId,
    tooth_number: t.tooth_number,
    procedure_ar: t.procedure_ar.trim(),
    status:
      typeof t.status === "string" && isToothStatus(t.status.trim())
        ? t.status.trim()
        : "healthy",
    note: t.note?.trim() || null,
  }));

  await admin.from("operation_tooth_records").upsert(rows, {
    onConflict: "operation_id,tooth_number",
  });
}

export async function processQuickEntryOfflinePayload(
  admin: SupabaseClient,
  clinicId: string,
  payload: QuickEntryOfflinePayload
): Promise<QuickEntryOfflineProcessResult> {
  if (payload.clinicId !== clinicId) {
    return { ok: false, error: "معرّف العيادة لا يطابق حسابك" };
  }

  const patientRes = await resolvePatientId(admin, clinicId, payload);
  if ("error" in patientRes) {
    return { ok: false, error: patientRes.error };
  }
  const patientId = patientRes.patientId;

  const optionalCols: Record<string, unknown> = {};
  if (payload.notes) optionalCols.notes = payload.notes;
  if (payload.labNotes) optionalCols.lab_notes = payload.labNotes;
  if (payload.isReviewStatement) {
    optionalCols.is_review_statement = true;
    if (payload.reviewFeeLive > 0) {
      optionalCols.review_fee_amount = payload.reviewFeeLive;
    }
  }

  let linkedCaseId: string | null = payload.treatmentCaseId;
  let op: PatientOperation | null = null;
  let error: string | null = null;
  const plan = payload.financialPlan;

  if (payload.entryMode === "payment" && payload.additionalDiscount > 0 && plan) {
    const discRes = await insertPatientOperation(admin, {
      clinicId,
      patientId,
      doctorId: payload.sessionDoctorId,
      sessionKind: "discount",
      operationLabel: `${payload.operationLabel} — خصم إضافي`,
      fields: {
        discount_amount: payload.additionalDiscount,
        total_amount: 0,
        paid_amount: 0,
      },
      optionalCols,
    });
    if (discRes.error) {
      const fb = await applyAdditionalDiscountFallback(
        admin,
        patientId,
        plan,
        payload.additionalDiscount
      );
      if (!fb.ok) error = fb.error ?? discRes.error;
    } else {
      op = discRes.op;
    }
  }

  if (!error && payload.entryMode === "plan") {
    const treatmentFinal = computeFinalPrice(payload.casePrice, payload.discount);
    const split = splitTreatmentAndReviewFee(
      treatmentFinal,
      payload.reviewFeeLive,
      payload.materials,
      payload.doctorShareInput
    );

    const created = await createTreatmentCase(admin, {
      patientId,
      clinicId,
      treatmentName: payload.operationLabel,
      casePrice: payload.casePrice,
      discount: payload.discount,
      paid: payload.paid,
      doctorShare: split?.doctorShare ?? 0,
      clinicShare: split?.clinicShare ?? 0,
      primaryDoctorId: payload.sessionDoctorId,
    });

    if (!created.case?.id) {
      return {
        ok: false,
        error: created.error ?? "تعذر إنشاء حالة العلاج",
      };
    }

    linkedCaseId = created.case.id;
    optionalCols.treatment_case_id = created.case.id;

    const planCols: Record<string, unknown> = {
      total_amount: payload.casePrice,
      discount_amount: payload.discount,
      paid_amount: payload.paid,
      materials_cost: payload.materials,
    };

    const res = await insertPatientOperation(admin, {
      clinicId,
      patientId,
      doctorId: payload.sessionDoctorId,
      sessionKind: "plan",
      operationLabel: payload.operationLabel,
      fields: planCols,
      optionalCols,
    });

    op = res.op;
    error = res.error;

    if (error) {
      const fb = await saveFirstSessionPlanFallback(
        admin,
        patientId,
        clinicId,
        payload.casePrice,
        payload.discount,
        payload.paid,
        split?.doctorShare ?? 0,
        split?.clinicShare ?? 0
      );
      if (fb.ok) {
        error = null;
        if (payload.paid > 0) {
          const payRes = await insertPatientOperation(admin, {
            clinicId,
            patientId,
            doctorId: payload.sessionDoctorId,
            sessionKind: "payment",
            operationLabel: payload.operationLabel,
            fields: { total_amount: 0, paid_amount: payload.paid },
            optionalCols,
          });
          op = payRes.op;
          error = payRes.error;
        }
      }
    }
  } else if (!error && payload.entryMode === "payment" && payload.paid > 0) {
    const paymentCols: Record<string, unknown> = {
      total_amount: 0,
      paid_amount: payload.paid,
    };
    if (payload.materials > 0) paymentCols.materials_cost = payload.materials;

    if (
      payload.treatmentCaseId &&
      isPersistedTreatmentCaseId(payload.treatmentCaseId)
    ) {
      optionalCols.treatment_case_id = payload.treatmentCaseId;
    }

    const res = await insertPatientOperation(admin, {
      clinicId,
      patientId,
      doctorId: payload.sessionDoctorId,
      sessionKind: "payment",
      operationLabel: payload.operationLabel,
      fields: paymentCols,
      optionalCols,
    });
    op = res.op;
    error = res.error;
  }

  if (error || !op?.id) {
    return { ok: false, error: error ?? "تعذر حفظ الجلسة" };
  }

  if (linkedCaseId && isPersistedTreatmentCaseId(linkedCaseId)) {
    await linkOperationToTreatmentCase(admin, op.id, linkedCaseId);
  }

  if (
    payload.entryMode === "payment" &&
    plan &&
    (payload.paid > 0 || payload.additionalDiscount > 0)
  ) {
    const sync = await syncTreatmentCaseAfterSession(admin, {
      patientId,
      clinicId,
      treatmentName: payload.operationLabel,
      plan,
      paidDelta: payload.paid,
      additionalDiscount: payload.additionalDiscount,
      caseId: linkedCaseId,
    });
    if (!sync.ok) {
      return {
        ok: false,
        error: `تم حفظ الجلسة لكن فشل تحديث ذمة الحالة: ${sync.error ?? "خطأ"}`,
      };
    }
  }

  await assignPrimaryDoctorForSession(admin, {
    patientId,
    doctorId: payload.sessionDoctorId,
    caseId: linkedCaseId,
  });

  await saveClinicalTeeth(admin, clinicId, op.id, payload);

  if (payload.visitQueueEntryId && payload.paid > 0) {
    try {
      await completeVisitAfterPayment(admin, clinicId, {
        appointmentId: null,
        queueEntryId: payload.visitQueueEntryId,
      });
    } catch {
      /* الدفع سُجّل — إغلاق الدور اختياري */
    }
  }

  return { ok: true, operationId: op.id, patientId };
}
