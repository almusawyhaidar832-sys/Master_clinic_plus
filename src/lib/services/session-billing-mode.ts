import type { Doctor } from "@/types";
import {
  FINANCIAL_EPSILON,
  previewPaidSessionSplit,
  type PatientFinancialPlan,
} from "@/lib/services/patient-financial-plan";

/** نوع تسجيل الجلسة — بدون سعر كلي */
export type SessionBillingMode = "session" | "debt" | "complete";

export const SESSION_BILLING_MODE_OPTIONS: {
  value: SessionBillingMode;
  label: string;
  hint: string;
}[] = [
  {
    value: "session",
    label: "جلسة",
    hint: "تسجيل المبلغ المدفوع اليوم — يُجمع مع الجلسات السابقة",
  },
  {
    value: "debt",
    label: "دين",
    hint: "تسجيل ذمة على المراجع (بدون سعر كلي للحالة)",
  },
  {
    value: "complete",
    label: "مكتمل",
    hint: "إغلاق الحالة — العلاج انتهى أو حالة جديدة لاحقاً",
  },
];

export function sessionBillingModeLabel(mode: SessionBillingMode): string {
  return SESSION_BILLING_MODE_OPTIONS.find((o) => o.value === mode)?.label ?? mode;
}

export function isSessionOnlyPlan(plan: PatientFinancialPlan): boolean {
  return (
    plan.final_price <= FINANCIAL_EPSILON && plan.case_price <= FINANCIAL_EPSILON
  );
}

export function amountFieldLabel(mode: SessionBillingMode): string {
  switch (mode) {
    case "debt":
      return "مبلغ الدين *";
    case "complete":
      return "المبلغ المدفوع (اختياري)";
    default:
      return "المبلغ المدفوع *";
  }
}

export function validateBillingAmount(
  mode: SessionBillingMode,
  amount: number
): string | null {
  if (mode === "session" && amount <= 0) {
    return "أدخل المبلغ الذي دفعه المراجع في هذه الجلسة";
  }
  if (mode === "debt" && amount <= 0) {
    return "أدخل مبلغ الدين المراد تسجيله";
  }
  return null;
}

/** معاينة بعد هذا الإدخال — بدون سعر كلي */
export function previewSessionBillingTotals(
  plan: PatientFinancialPlan,
  opts: {
    mode: SessionBillingMode;
    amount: number;
    additionalDiscount?: number;
  }
): {
  totalPaidAfter: number;
  registeredDebt: number;
  sessionCountHint: string;
} {
  const additionalDiscount = opts.additionalDiscount ?? 0;
  const paidDelta =
    opts.mode === "session" || opts.mode === "complete" ? opts.amount : 0;
  const debtDelta = opts.mode === "debt" ? opts.amount : 0;

  const totalPaidAfter = plan.total_paid + paidDelta;
  const currentDebt = Math.max(0, plan.final_price - plan.total_paid);
  const registeredDebt =
    opts.mode === "debt"
      ? debtDelta
      : Math.max(0, currentDebt - additionalDiscount - paidDelta);

  return {
    totalPaidAfter,
    registeredDebt,
    sessionCountHint:
      paidDelta > 0
        ? `بعد الحفظ — مجموع المدفوع: ${totalPaidAfter}`
        : "",
  };
}

/** حصة الطبيب/العيادة لجلسة بدون سعر كلي */
export function resolveSessionPaymentShares(opts: {
  paidAmount: number;
  materialsCost: number;
  doctor: Doctor | null;
  plan: PatientFinancialPlan;
}): { doctorShare: number; clinicShare: number } {
  const split = previewPaidSessionSplit({
    paidAmount: opts.paidAmount,
    caseFinalPrice: opts.plan.final_price,
    caseDoctorShare: opts.plan.doctor_share_total,
    caseClinicShare: opts.plan.clinic_share_total,
    doctor: opts.doctor,
    materialsCost: opts.materialsCost,
  });
  return {
    doctorShare: split?.doctorShare ?? 0,
    clinicShare: split?.clinicShare ?? 0,
  };
}
