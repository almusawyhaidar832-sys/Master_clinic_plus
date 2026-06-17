import {
  computeFinalPrice,
  hasTreatmentPlan,
  isTreatmentCaseClosed,
  type PatientFinancialPlan,
} from "@/lib/services/patient-financial-plan";
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
  totalAmount: string;
  paidAmount: string;
  discountAmount: string;
  additionalDiscountAmount: string;
  materialsCost: string;
  notes: string;
  labNotes: string;
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

  const entryMode: "plan" | "payment" =
    input.forceNewPlan || !input.selectedCaseId ? "plan" : "payment";

  if (entryMode === "plan" && !input.operationName.trim()) {
    return {
      ok: false,
      message: "أدخل نوع العلاج للحالة الجديدة",
    };
  }

  const patientName = input.patientQuery.trim();
  if (!input.selectedPatientId && !patientName) {
    return { ok: false, message: "أدخل اسم المريض" };
  }

  const paid = parseAmount(input.paidAmount);
  const discount = parseAmount(input.discountAmount);
  const additionalDiscount = parseAmount(input.additionalDiscountAmount);
  const materials = parseAmount(input.materialsCost);
  const casePrice = parseAmount(input.totalAmount);
  const plan = input.financialPlan;

  if (
    entryMode === "payment" &&
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

  if (entryMode === "plan") {
    if (casePrice <= 0) {
      return {
        ok: false,
        message: "أول جلسة: أدخل السعر الكلي للحالة",
      };
    }
    if (discount < 0 || discount >= casePrice) {
      return { ok: false, message: "الخصم يجب أن يكون أقل من السعر الكلي" };
    }
  } else {
    if (!plan || !hasTreatmentPlan(plan)) {
      return {
        ok: false,
        message:
          "لا توجد خطة علاج محفوظة محلياً — اتصل بالنت مرة لتحميل ملف المريض ثم يمكنك العمل بدون نت",
      };
    }
    if (discount > 0) {
      return {
        ok: false,
        message: "الخصم الأولي يُسجّل في أول جلسة فقط",
      };
    }
    if (paid <= 0 && additionalDiscount <= 0) {
      return {
        ok: false,
        message: "أدخل المبلغ المدفوع أو خصماً إضافياً",
      };
    }
    if (additionalDiscount > 0) {
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
  }

  if (!input.selectedPatientId) {
    const phoneCheck = validatePatientPhone(input.patientPhone);
    if (!phoneCheck.ok) {
      return { ok: false, message: phoneCheck.message };
    }
  }

  const operationLabel =
    input.operationLabel.trim() || input.operationName.trim();

  if (entryMode === "plan" && !operationLabel) {
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
      entryMode,
      operationLabel,
      casePrice,
      discount: entryMode === "plan" ? discount : 0,
      paid,
      additionalDiscount,
      materials,
      isReviewStatement: input.isReviewStatement,
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
  if (payload.entryMode !== "plan") return 0;
  return computeFinalPrice(payload.casePrice, payload.discount);
}
