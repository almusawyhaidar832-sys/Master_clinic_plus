import {
  FINANCIAL_EPSILON,
  hasTreatmentPlan,
  isTreatmentCaseClosed,
  type PatientFinancialPlan,
} from "@/lib/services/patient-financial-plan";
import {
  validateBillingAmount,
  type SessionBillingMode,
} from "@/lib/services/session-billing-mode";
import { validatePatientPhone } from "@/lib/phone";
import type { QuickEntryOfflinePayload } from "@/lib/offline/types";

export interface QuickEntryOfflineInput {
  clinicId: string | null;
  showCasePicker: boolean;
  selectedPatientId: string | null;
  patientQuery: string;
  patientPhone: string;
  doctorId: string;
  sessionDoctorId: string;
  doctorShareInput: QuickEntryOfflinePayload["doctorShareInput"];
  forceNewPlan: boolean;
  selectedCaseId: string | null;
  operationName: string;
  operationLabel: string;
  billingMode: SessionBillingMode;
  totalAmount: string;
  paidAmount: string;
  discountAmount: string;
  additionalDiscountAmount: string;
  materialsCost: string;
  notes: string;
  labNotes: string;
  applyExaminationFee: boolean;
  isReviewStatement: boolean;
  reviewFeeEnabled: boolean;
  reviewFeeLive: number;
  financialPlan: PatientFinancialPlan | null;
  visitQueueEntryId: string | null;
  clinicalTeeth: QuickEntryOfflinePayload["clinicalTeeth"];
  treatmentCaseId: string | null;
}

function parseAmount(raw: string): number {
  const n = Number(String(raw ?? "").replace(/,/g, "").trim());
  return Number.isFinite(n) ? n : 0;
}

export function validateQuickEntryOffline(
  input: QuickEntryOfflineInput
): { ok: true; payload: QuickEntryOfflinePayload } | { ok: false; message: string } {
  if (!input.clinicId) {
    return {
      ok: false,
      message:
        "لا يمكن الحفظ بدون نت — افتح النظام مرة واحدة مع اتصال لتحميل بيانات العيادة",
    };
  }

  if (input.showCasePicker) {
    return { ok: false, message: "اختر الحالة من القائمة أولاً" };
  }

  if (!input.doctorId) {
    return { ok: false, message: "اختر الطبيب" };
  }

  if (input.billingMode === "debt" || input.billingMode === "complete") {
    return {
      ok: false,
      message: "تسجيل الدين أو إغلاق الحالة يحتاج اتصالاً بالإنترنت",
    };
  }

  const isNewCase = input.forceNewPlan || !input.selectedCaseId;
  const entryMode: "plan" | "payment" = isNewCase ? "plan" : "payment";

  if (isNewCase && !input.operationName.trim() && input.billingMode !== "examination") {
    return {
      ok: false,
      message: "أدخل نوع العلاج للحالة الجديدة",
    };
  }

  if (input.billingMode === "examination" && input.applyExaminationFee) {
    if (!input.reviewFeeEnabled) {
      return { ok: false, message: "فعّل كشفية المراجع من إعدادات العيادة" };
    }
    if (input.reviewFeeLive <= 0) {
      return { ok: false, message: "حدد مبلغ الكشفية في إعدادات العيادة" };
    }
  }

  const patientName = input.patientQuery.trim();
  if (!input.selectedPatientId && !patientName) {
    return { ok: false, message: "أدخل اسم المريض" };
  }

  const paid =
    input.billingMode === "examination"
      ? input.reviewFeeLive
      : parseAmount(input.paidAmount);
  const additionalDiscount = parseAmount(input.additionalDiscountAmount);
  const materials = parseAmount(input.materialsCost);
  const plan = input.financialPlan;

  if (
    !isNewCase &&
    plan &&
    isTreatmentCaseClosed(plan) &&
    !input.forceNewPlan
  ) {
    return {
      ok: false,
      message: "تم إكمال العلاج — فعّل «حالة علاج جديدة» لبدء حالة جديدة",
    };
  }

  if (input.isReviewStatement && input.reviewFeeEnabled && input.reviewFeeLive <= 0) {
    return { ok: false, message: "حدد مبلغ الكشفية في إعدادات العيادة" };
  }

  const amountError = validateBillingAmount(input.billingMode, paid);
  if (amountError) {
    return { ok: false, message: amountError };
  }

  if (
    !isNewCase &&
    input.billingMode !== "examination" &&
    (!plan || !hasTreatmentPlan(plan)) &&
    paid <= 0 &&
    additionalDiscount <= 0
  ) {
    return {
      ok: false,
      message:
        "لا توجد حالة محفوظة محلياً — اتصل بالنت مرة لتحميل ملف المريض",
    };
  }

  if (additionalDiscount > 0 && plan && plan.final_price > FINANCIAL_EPSILON) {
    const maxDisc = Math.max(
      plan.remaining_balance,
      plan.final_price - plan.total_paid
    );
    if (additionalDiscount > maxDisc) {
      return {
        ok: false,
        message: `الخصم الإضافي أكبر من الذمة (${maxDisc})`,
      };
    }
  }

  if (!input.selectedPatientId) {
    const phoneCheck = validatePatientPhone(input.patientPhone);
    if (!phoneCheck.ok) {
      return { ok: false, message: phoneCheck.message };
    }
  }

  const operationLabel =
    input.billingMode === "examination"
      ? input.operationLabel.trim() || input.operationName.trim() || "كشف"
      : input.operationLabel.trim() || input.operationName.trim();

  if (isNewCase && !operationLabel && input.billingMode !== "examination") {
    return { ok: false, message: "أدخل نوع العلاج" };
  }

  const clientId =
    typeof crypto !== "undefined" && crypto.randomUUID
      ? crypto.randomUUID()
      : `qe-${Date.now()}`;

  return {
    ok: true,
    payload: {
      version: 1,
      clinicId: input.clinicId,
      selectedPatientId: input.selectedPatientId,
      patientQuery: patientName,
      patientPhone: input.patientPhone.trim(),
      doctorId: input.doctorId,
      sessionDoctorId: input.sessionDoctorId,
      doctorShareInput: input.doctorShareInput,
      forceNewPlan: input.forceNewPlan,
      selectedCaseId: input.selectedCaseId,
      entryMode: "payment",
      billingMode: input.billingMode,
      operationLabel,
      casePrice: 0,
      discount: 0,
      paid,
      additionalDiscount,
      materials,
      isReviewStatement:
        input.billingMode === "examination"
          ? input.applyExaminationFee
          : input.isReviewStatement,
      reviewFeeLive: input.reviewFeeLive,
      notes: input.notes.trim(),
      labNotes: input.labNotes.trim(),
      financialPlan: plan,
      treatmentCaseId: input.treatmentCaseId,
      visitQueueEntryId: input.visitQueueEntryId,
      clinicalTeeth: input.clinicalTeeth,
      clientId,
      enqueuedAt: new Date().toISOString(),
    },
  };
}

export function previewOfflinePlanFinal(payload: QuickEntryOfflinePayload): number {
  return payload.paid;
}
