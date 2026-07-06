import type { SupabaseClient } from "@supabase/supabase-js";
import { isSalaryDoctor } from "@/lib/services/doctor-payment";
import { treatmentPaidForDoctorShare } from "@/lib/services/doctor-wallet";
import {
  FINANCIAL_EPSILON,
  doctorPaymentPct,
  previewPaidSessionSplit,
  previewTreatmentSplitWithReview,
} from "@/lib/services/patient-financial-plan";
import {
  isPersistedTreatmentCaseId,
  processCasePayment,
} from "@/lib/services/patient-treatment-cases";
import { DOCTOR_FINANCE_SELECT } from "@/lib/services/doctor-db-select";
import type { Doctor } from "@/types";

function num(v: unknown): number {
  const n = Number(v ?? 0);
  return Number.isFinite(n) ? n : 0;
}

function roundMoney(n: number): number {
  return Math.round(n * 100) / 100;
}

function doctorPctFromRow(doctor: Doctor | null): number {
  return doctorPaymentPct(doctor);
}

function capDoctorShare(
  paid: number,
  doctor: Doctor | null,
  share: number,
  op?: Pick<OperationRow, "review_fee_amount" | "is_review_statement">
): number {
  const treatmentPaid = op
    ? treatmentPaidForDoctorShare({
        paid_amount: paid,
        review_fee_amount: num(op.review_fee_amount),
        is_review_statement: op.is_review_statement,
      })
    : paid;
  if (treatmentPaid <= 0) return 0;
  if (doctor && isSalaryDoctor(doctor)) return 0;
  return Math.min(
    Math.max(0, roundMoney(share)),
    roundMoney(treatmentPaid * doctorPctFromRow(doctor))
  );
}

type OperationRow = Record<string, unknown> & {
  id: string;
  patient_id: string;
  clinic_id: string;
  doctor_id: string;
  treatment_case_id?: string | null;
  paid_amount?: unknown;
  total_amount?: unknown;
  materials_cost?: unknown;
  session_kind?: string | null;
  review_fee_amount?: unknown;
  is_review_statement?: boolean | null;
  doctor_share_amount?: unknown;
  clinic_share_amount?: unknown;
  remaining_debt?: unknown;
};

export type OperationAmountRow = OperationRow;

type ShareRecalc = {
  doctorShare: number;
  clinicShare: number;
  remainingDebt: number;
};

/** يكمّل review_fee_amount للجلسات القديمة (كشفية + علاج) */
async function normalizeOperationReviewFee(
  admin: SupabaseClient,
  clinicId: string,
  op: OperationRow
): Promise<OperationRow> {
  const paid = num(op.paid_amount);
  const stored = num(op.review_fee_amount);
  if (stored > 0 || !op.is_review_statement || paid <= 0) {
    return op;
  }

  const { data: clinic } = await admin
    .from("clinics")
    .select("review_fee_enabled, review_fee_amount")
    .eq("id", clinicId)
    .maybeSingle();

  const clinicFee =
    clinic?.review_fee_enabled && num(clinic.review_fee_amount) > 0
      ? num(clinic.review_fee_amount)
      : 0;

  if (clinicFee > 0 && paid > clinicFee + FINANCIAL_EPSILON) {
    return { ...op, review_fee_amount: clinicFee, is_review_statement: true };
  }

  return { ...op, review_fee_amount: paid, is_review_statement: true };
}

/** إعادة حساب حصة الطبيب/العيادة حسب النسبة — نفس منطق الإدخال السريع */
async function recalculateOperationShares(
  admin: SupabaseClient,
  op: OperationRow,
  clinicId?: string
): Promise<ShareRecalc> {
  const paid = num(op.paid_amount);
  const total = num(op.total_amount);
  const materials = num(op.materials_cost);
  const reviewFee = num(op.review_fee_amount);
  const caseId = op.treatment_case_id ? String(op.treatment_case_id) : null;
  const isPlan = op.session_kind === "plan" || total > 0;
  const effectiveClinicId = clinicId ?? String(op.clinic_id ?? "");

  const normalized =
    effectiveClinicId && !reviewFee && op.is_review_statement
      ? await normalizeOperationReviewFee(admin, effectiveClinicId, op)
      : op;
  const reviewFeeNorm = num(normalized.review_fee_amount);

  const { data: doctorRaw } = await admin
    .from("doctors")
    .select(DOCTOR_FINANCE_SELECT)
    .eq("id", op.doctor_id)
    .maybeSingle();

  const doctor = (doctorRaw as Doctor | null) ?? null;

  let caseFinal = 0;
  let caseDoc = 0;
  let caseClinic = 0;

  if (caseId && isPersistedTreatmentCaseId(caseId)) {
    const { data: caseRow } = await admin
      .from("patient_treatment_cases")
      .select(
        "final_price, case_price, discount_total, doctor_share_total, clinic_share_total, total_paid"
      )
      .eq("id", caseId)
      .maybeSingle();

    if (caseRow) {
      const discount = num(caseRow.discount_total);
      caseFinal =
        num(caseRow.final_price) ||
        Math.max(0, num(caseRow.case_price) - discount);
      caseDoc = num(caseRow.doctor_share_total);
      caseClinic = num(caseRow.clinic_share_total);
    }
  }

  const { data: patientRaw } = await admin
    .from("patients")
    .select("agreed_total, doctor_share_total, clinic_share_total, total_paid")
    .eq("id", op.patient_id)
    .maybeSingle();

  const agreed = num(patientRaw?.agreed_total);
  const patientDoc = num(patientRaw?.doctor_share_total);
  const patientClinic = num(patientRaw?.clinic_share_total);
  const patientPaid = num(patientRaw?.total_paid);

  if (isPlan && total > 0) {
    const planTotal = total + reviewFeeNorm;
    const planSplit = previewTreatmentSplitWithReview(
      total,
      reviewFeeNorm,
      materials,
      doctor
    );

    let doctorShare = 0;
    let clinicShare = 0;

    if (planSplit && paid > 0 && planTotal > 0) {
      doctorShare = roundMoney((paid * planSplit.doctorShare) / planTotal);
      clinicShare = roundMoney((paid * planSplit.clinicShare) / planTotal);
    } else if (paid > 0 && !doctor) {
      clinicShare = roundMoney(paid);
    }

    const remainingDebt = Math.max(0, planTotal - patientPaid);

    return {
      doctorShare: capDoctorShare(paid, doctor, doctorShare, normalized),
      clinicShare: roundMoney(
        Math.max(
          0,
          paid - capDoctorShare(paid, doctor, doctorShare, normalized)
        )
      ),
      remainingDebt,
    };
  }

  const split = previewPaidSessionSplit({
    paidAmount: paid,
    reviewFee: reviewFeeNorm,
    isReviewStatement: Boolean(normalized.is_review_statement),
    caseFinalPrice: caseFinal || agreed,
    caseDoctorShare: caseDoc || patientDoc,
    caseClinicShare: caseClinic || patientClinic,
    doctor,
    materialsCost: materials,
  });

  if (split) {
    const remainingDebt =
      caseFinal > 0
        ? Math.max(0, caseFinal - num(patientRaw?.total_paid))
        : agreed > 0
          ? Math.max(0, agreed - patientPaid)
          : Math.max(0, total - paid);

    return {
      doctorShare: capDoctorShare(paid, doctor, split.doctorShare, normalized),
      clinicShare: roundMoney(
        Math.max(
          0,
          paid - capDoctorShare(paid, doctor, split.doctorShare, normalized)
        )
      ),
      remainingDebt: roundMoney(remainingDebt),
    };
  }

  const fallbackDoc = capDoctorShare(paid, doctor, 0, normalized);
  return {
    doctorShare: fallbackDoc,
    clinicShare: roundMoney(Math.max(0, paid - fallbackDoc)),
    remainingDebt: roundMoney(Math.max(0, (caseFinal || agreed || total) - paid)),
  };
}

async function updateCaseSharesForPlanTotal(
  admin: SupabaseClient,
  caseId: string,
  total: number,
  reviewFee: number,
  materials: number,
  doctor: Doctor | null
): Promise<void> {
  const split = previewTreatmentSplitWithReview(
    total,
    reviewFee,
    materials,
    doctor
  );
  if (!split) return;

  const { data: caseRow } = await admin
    .from("patient_treatment_cases")
    .select("discount_total")
    .eq("id", caseId)
    .maybeSingle();

  const discount = num(caseRow?.discount_total);
  const finalPrice = Math.max(0, total - discount);

  await admin
    .from("patient_treatment_cases")
    .update({
      case_price: total,
      final_price: finalPrice,
      doctor_share_total: split.doctorShare,
      clinic_share_total: split.clinicShare,
      updated_at: new Date().toISOString(),
    })
    .eq("id", caseId);
}

/**
 * بعد تعديل paid_amount / total_amount — تصحيح حصة الطبيب، ذمة المريض، والحالة.
 */
export async function syncFinancialsAfterOperationEdit(
  admin: SupabaseClient,
  before: OperationRow,
  after: OperationRow
): Promise<{ ok: boolean; error?: string; doctorShare?: number; clinicShare?: number }> {
  const beforePaid = num(before.paid_amount);
  const afterPaid = num(after.paid_amount);
  const beforeTotal = num(before.total_amount);
  const afterTotal = num(after.total_amount);

  if (beforePaid === afterPaid && beforeTotal === afterTotal) {
    return { ok: true };
  }

  const patientId = String(after.patient_id);
  const clinicId = String(after.clinic_id);
  const caseId = after.treatment_case_id
    ? String(after.treatment_case_id)
    : null;

  const { data: doctorRaw } = await admin
    .from("doctors")
    .select(DOCTOR_FINANCE_SELECT)
    .eq("id", after.doctor_id)
    .maybeSingle();
  const doctor = (doctorRaw as Doctor | null) ?? null;

  if (
    caseId &&
    isPersistedTreatmentCaseId(caseId) &&
    beforeTotal !== afterTotal &&
    afterTotal > 0
  ) {
    await updateCaseSharesForPlanTotal(
      admin,
      caseId,
      afterTotal,
      num(after.review_fee_amount),
      num(after.materials_cost),
      doctor
    );
  }

  const shares = await recalculateOperationShares(
    admin,
    after,
    String(after.clinic_id)
  );

  const { error: shareErr } = await admin
    .from("patient_operations")
    .update({
      doctor_share_amount: shares.doctorShare,
      clinic_share_amount: shares.clinicShare,
      remaining_debt: shares.remainingDebt,
    })
    .eq("id", String(after.id));

  if (shareErr) {
    return { ok: false, error: shareErr.message };
  }

  after.doctor_share_amount = shares.doctorShare;
  after.clinic_share_amount = shares.clinicShare;
  after.remaining_debt = shares.remainingDebt;

  const { data: ops, error: opsErr } = await admin
    .from("patient_operations")
    .select("paid_amount")
    .eq("patient_id", patientId)
    .eq("clinic_id", clinicId);

  if (opsErr) {
    return { ok: false, error: opsErr.message };
  }

  const totalPaidFromOps = (ops ?? []).reduce(
    (sum, row) => sum + num(row.paid_amount),
    0
  );
  const roundedTotal = roundMoney(totalPaidFromOps);

  const { data: patient } = await admin
    .from("patients")
    .select("agreed_total")
    .eq("id", patientId)
    .maybeSingle();

  const agreed = num(patient?.agreed_total);
  const patientPatch: Record<string, unknown> = {
    total_paid: roundedTotal,
    updated_at: new Date().toISOString(),
  };

  if (agreed > 0) {
    patientPatch.treatment_status =
      roundedTotal >= agreed - 0.01 ? "completed" : "active";
  }

  const { error: patientErr } = await admin
    .from("patients")
    .update(patientPatch)
    .eq("id", patientId);

  if (patientErr) {
    return { ok: false, error: patientErr.message };
  }

  if (caseId && isPersistedTreatmentCaseId(caseId)) {
    const sync = await processCasePayment(admin, { caseId, paidDelta: 0 });
    if (!sync.ok) {
      return { ok: false, error: sync.error ?? "تعذر مزامنة ذمة الحالة" };
    }
  }

  if (beforeTotal !== afterTotal && agreed > 0 && afterTotal > 0) {
    const reviewFee = num(after.review_fee_amount);
    const planTotal = afterTotal + reviewFee;
    const planSplit = previewTreatmentSplitWithReview(
      afterTotal,
      reviewFee,
      num(after.materials_cost),
      doctor
    );

    await admin
      .from("patients")
      .update({
        agreed_total: planTotal,
        previous_total: planTotal,
        doctor_share_total: planSplit?.doctorShare ?? 0,
        clinic_share_total: planSplit?.clinicShare ?? planTotal,
        updated_at: new Date().toISOString(),
      })
      .eq("id", patientId);
  }

  return {
    ok: true,
    doctorShare: shares.doctorShare,
    clinicShare: shares.clinicShare,
  };
}

export function buildOperationAmountAuditNote(
  before: OperationRow,
  after: OperationRow
): string | undefined {
  const parts: string[] = [];
  const beforePaid = num(before.paid_amount);
  const afterPaid = num(after.paid_amount);
  const beforeTotal = num(before.total_amount);
  const afterTotal = num(after.total_amount);
  const beforeDoc = num(before.doctor_share_amount);
  const afterDoc = num(after.doctor_share_amount);

  if (beforePaid !== afterPaid) {
    parts.push(`المدفوع ${beforePaid} ← ${afterPaid}`);
  }
  if (beforeTotal !== afterTotal) {
    parts.push(`الإجمالي ${beforeTotal} ← ${afterTotal}`);
  }
  if (beforeDoc !== afterDoc) {
    parts.push(`حصة الطبيب ${beforeDoc} ← ${afterDoc}`);
  }

  return parts.length ? `تعديل مبلغ — ${parts.join(" · ")}` : undefined;
}

/** تصحيح paid_amount للجلسات القديمة (علاج فقط) أو المضاعفة خطأً */
async function normalizeCombinedReviewPaidAmount(
  admin: SupabaseClient,
  op: OperationRow
): Promise<OperationRow> {
  const paid = num(op.paid_amount);
  const review = num(op.review_fee_amount);
  if (
    review <= FINANCIAL_EPSILON ||
    !op.is_review_statement ||
    paid <= review + FINANCIAL_EPSILON
  ) {
    return op;
  }

  const { data: doctorRaw } = await admin
    .from("doctors")
    .select(DOCTOR_FINANCE_SELECT)
    .eq("id", op.doctor_id)
    .maybeSingle();
  const doctor = (doctorRaw as Doctor | null) ?? null;
  if (!doctor || isSalaryDoctor(doctor)) return op;

  const pct = doctorPaymentPct(doctor);
  const doc = num(op.doctor_share_amount);
  const ratio = paid / review;
  const docIfPaidMinusReview = roundMoney((paid - review) * pct);
  const docIfPaidMinus2Review = roundMoney((paid - review * 2) * pct);

  // مضاعفة كشفية: 25k علاج → 30k صح → 35k خطأ (نور ريسان: 30k وليس 35k)
  // ratio 7 فقط — لا نلمس ratio 6 (30k مجموع صحيح)
  if (
    ratio >= 6.5 &&
    ratio < 7.5 &&
    Math.abs(doc - docIfPaidMinusReview) <= 0.02 &&
    Math.abs(doc - docIfPaidMinus2Review) > 0.02
  ) {
    return { ...op, paid_amount: roundMoney(paid - review) };
  }

  // قديم: paid=25,000 علاج فقط (ratio≈5) — نرفع إلى 30,000 (علاج + كشفية)
  // لا نرفع إذا paid أصلاً مجموع صحيح (ratio≈6) وإلا نعيد 35k بالخطأ
  const docIfPaidIsTreatment = roundMoney(paid * pct);
  if (
    ratio <= 5.5 &&
    Math.abs(doc - docIfPaidIsTreatment) <= 0.02
  ) {
    return { ...op, paid_amount: roundMoney(paid + review) };
  }

  return op;
}

/** إصلاح حصص جلسات طبيب — يصحّح doctor_share_amount المبالغ فيها */
export async function repairDoctorOperationShares(
  admin: SupabaseClient,
  clinicId: string,
  opts: {
    doctorId?: string;
    date?: string;
    dateFrom?: string;
    dateTo?: string;
  } = {}
): Promise<{ ok: boolean; repaired: number; error?: string }> {
  let query = admin
    .from("patient_operations")
    .select("*")
    .eq("clinic_id", clinicId);

  if (opts.doctorId) query = query.eq("doctor_id", opts.doctorId);
  if (opts.date) query = query.eq("operation_date", opts.date);
  if (opts.dateFrom) query = query.gte("operation_date", opts.dateFrom);
  if (opts.dateTo) query = query.lte("operation_date", opts.dateTo);

  const { data: ops, error } = await query;
  if (error) return { ok: false, repaired: 0, error: error.message };

  const caseIds = new Set<string>();
  let repaired = 0;

  for (const row of ops ?? []) {
    const op = row as OperationRow;
    const paid = num(op.paid_amount);

    if (paid <= 0) {
      if (num(op.doctor_share_amount) !== 0 || num(op.clinic_share_amount) !== 0) {
        await admin
          .from("patient_operations")
          .update({ doctor_share_amount: 0, clinic_share_amount: 0 })
          .eq("id", op.id);
        repaired += 1;
      }
      continue;
    }

    const bumped = await normalizeCombinedReviewPaidAmount(admin, op);
    const normalized = await normalizeOperationReviewFee(
      admin,
      clinicId,
      bumped
    );
    const shares = await recalculateOperationShares(admin, normalized, clinicId);
    const beforeDoc = num(op.doctor_share_amount);
    const beforeReview = num(op.review_fee_amount);
    const beforePaid = num(op.paid_amount);
    const patch: Record<string, unknown> = {
      doctor_share_amount: shares.doctorShare,
      clinic_share_amount: shares.clinicShare,
      remaining_debt: shares.remainingDebt,
    };
    if (num(bumped.paid_amount) !== beforePaid) {
      patch.paid_amount = num(bumped.paid_amount);
    }
    if (num(normalized.review_fee_amount) !== beforeReview) {
      patch.review_fee_amount = normalized.review_fee_amount;
      patch.is_review_statement = normalized.is_review_statement ?? true;
    }
    if (
      Math.abs(beforeDoc - shares.doctorShare) > 0.01 ||
      Math.abs(num(op.clinic_share_amount) - shares.clinicShare) > 0.01 ||
      num(normalized.review_fee_amount) !== beforeReview ||
      num(bumped.paid_amount) !== beforePaid
    ) {
      await admin.from("patient_operations").update(patch).eq("id", op.id);
      repaired += 1;
    }

    const caseId = op.treatment_case_id ? String(op.treatment_case_id) : null;
    if (caseId && isPersistedTreatmentCaseId(caseId)) {
      caseIds.add(caseId);
    }
  }

  for (const caseId of caseIds) {
    await processCasePayment(admin, { caseId, paidDelta: 0 });
  }

  return { ok: true, repaired };
}
