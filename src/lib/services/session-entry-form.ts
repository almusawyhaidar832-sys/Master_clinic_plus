import type { SupabaseClient } from "@supabase/supabase-js";
import {
  computeFinalPrice,
  computeFinalPriceWithDiscounts,
  computePatientDebtRemaining,
  computeRemainingBalance,
  FINANCIAL_EPSILON,
  hasTreatmentPlan,
  type PatientFinancialPlan,
} from "@/lib/services/patient-financial-plan";

export type SessionEntryMode = "first" | "follow_up";

export interface SessionEntryFormSchema {
  mode: SessionEntryMode;
  showCasePrice: boolean;
  showInitialDiscount: boolean;
  /** كل جلسات المتابعة: خصم إضافي اختياري */
  showAdditionalDiscount: boolean;
  showPaidAmount: boolean;
  showBillingMode: boolean;
  showOperation: boolean;
  showNotes: boolean;
  showDoctor: boolean;
  /** طبيب المريض من الجلسات السابقة — عرض الاسم فقط */
  showAssignedDoctor: boolean;
  showPatientSearch: boolean;
  showMaterials: boolean;
  showFinancialPreview: boolean;
  showClinicalRecord: boolean;
  showReviewCheckbox: boolean;
  showPlanSummary: boolean;
  showCasePicker: boolean;
}

export function resolveSessionEntryMode(
  plan: PatientFinancialPlan,
  forceNewPlan: boolean
): SessionEntryMode {
  if (forceNewPlan || !hasTreatmentPlan(plan)) return "first";
  return "follow_up";
}

/** @deprecated — لم يعد يحدد ظهور الحقول */
export async function fetchPriorSessionCount(
  supabase: SupabaseClient,
  patientId: string
): Promise<number> {
  const { count, error } = await supabase
    .from("patient_operations")
    .select("id", { count: "exact", head: true })
    .eq("patient_id", patientId);

  if (error) return 0;
  return count ?? 0;
}

export function buildSessionEntrySchema(opts: {
  plan: PatientFinancialPlan;
  forceNewPlan: boolean;
  defaultPatientId?: string;
  lockDoctorId?: string;
  /** يعرض قائمة الحالات قبل الإدخال */
  showCasePicker?: boolean;
  /** حالة محددة — متابعة بدون إعادة كتابة نوع الإجراء */
  hasSelectedCase?: boolean;
  /** طبيب مُستنتج من سجل الجلسات السابقة */
  hasAssignedDoctor?: boolean;
}): SessionEntryFormSchema {
  const picking = opts.showCasePicker ?? false;
  const isNewCase = opts.forceNewPlan;
  const hasCase = opts.hasSelectedCase ?? false;
  const isFirst =
    isNewCase || picking || !hasTreatmentPlan(opts.plan);
  const isFollowUp = hasCase && !isNewCase && !picking;

  return {
    mode: isFollowUp ? "follow_up" : "first",
    showCasePrice: false,
    showInitialDiscount: false,
    showAdditionalDiscount:
      isFollowUp && opts.plan.final_price > FINANCIAL_EPSILON,
    showPaidAmount: !picking,
    showBillingMode: !picking,
    showOperation: isFirst && !picking,
    showNotes: !picking,
    showDoctor:
      !!opts.lockDoctorId || (!picking && !opts.hasAssignedDoctor),
    showAssignedDoctor:
      !opts.lockDoctorId && !!opts.hasAssignedDoctor,
    showPatientSearch: !opts.defaultPatientId,
    showMaterials: !picking,
    showFinancialPreview:
      (!picking && isFirst) ||
      (isFollowUp && hasTreatmentPlan(opts.plan) && opts.plan.final_price > 0),
    /** أشعة ومخطط أسنان — لكل جلسة على حدة (أولى أو متابعة) */
    showClinicalRecord: !picking,
    showReviewCheckbox: isFirst && !picking,
    showPlanSummary: isFollowUp && hasTreatmentPlan(opts.plan),
    showCasePicker: picking,
  };
}

/** معاينة مالية أثناء إدخال الجلسة (قبل الحفظ) */
export function previewSessionFinancials(
  plan: PatientFinancialPlan,
  opts: {
    isFirstSession: boolean;
    casePrice?: number;
    initialDiscount?: number;
    additionalDiscount?: number;
    newPayment?: number;
    /** كشفية مراجع — تُضاف للسعر المتفق في أول جلسة */
    reviewFee?: number;
  }
): { finalPrice: number; remainingBalance: number; reviewFee: number } {
  const reviewFee = opts.isFirstSession ? (opts.reviewFee ?? 0) : 0;

  if (opts.isFirstSession) {
    const casePrice = opts.casePrice ?? 0;
    const disc = opts.initialDiscount ?? 0;
    const treatmentFinal = computeFinalPrice(casePrice, disc);
    const finalPrice = treatmentFinal + reviewFee;
    const remaining = computeRemainingBalance(
      finalPrice,
      0,
      opts.newPayment ?? 0
    );
    return { finalPrice, remainingBalance: remaining, reviewFee };
  }

  const finalPrice = computeFinalPriceWithDiscounts(plan, opts.additionalDiscount ?? 0);
  const remaining = computePatientDebtRemaining(plan, {
    additionalDiscount: opts.additionalDiscount ?? 0,
    newPayment: opts.newPayment ?? 0,
  });
  return { finalPrice, remainingBalance: remaining, reviewFee: 0 };
}

/** @deprecated — استخدم computePatientDebtRemaining من patient-financial-plan */
export function computeDebtRemaining(
  plan: PatientFinancialPlan,
  opts: { additionalDiscount?: number; newPayment?: number } = {}
): number {
  return computePatientDebtRemaining(plan, opts);
}
