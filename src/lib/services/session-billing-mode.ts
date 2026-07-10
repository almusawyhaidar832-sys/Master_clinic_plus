import type { Doctor } from "@/types";
import { isSalaryDoctor } from "@/lib/services/doctor-payment";
import {
  FINANCIAL_EPSILON,
  doctorPaymentPct,
  previewPaidSessionSplit,
  type PatientFinancialPlan,
} from "@/lib/services/patient-financial-plan";
import { treatmentPaidForDoctorShare, isReviewFeeOnlyPayment } from "@/lib/services/doctor-wallet";

/** نوع تسجيل الجلسة — بدون سعر كلي */
export type SessionBillingMode =
  | "session"
  | "debt"
  | "complete"
  | "examination";

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
  {
    value: "examination",
    label: "كشف",
    hint: "زيارة كشف فقط — بدون علاج. فعّل الكشفية إن وُجدت رسوم",
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
    case "examination":
      return "المبلغ المدفوع";
    default:
      return "المبلغ المدفوع *";
  }
}

export function cashCollectedForBillingMode(
  mode: SessionBillingMode,
  amount: number,
  examinationFee = 0
): number {
  if (mode === "debt") return 0;
  if (mode === "examination") return Math.max(0, examinationFee);
  return Math.max(0, amount);
}

/** مبلغ يُحسب للحصص والأرباح — الدين لا يُعامل كدفعة */
export function paidAmountForShareCalculation(
  mode: SessionBillingMode,
  entryAmount: number,
  reviewAddon = 0
): number {
  if (mode === "debt") return 0;
  return Math.max(0, entryAmount + reviewAddon);
}

export function validateBillingAmount(
  mode: SessionBillingMode,
  amount: number
): string | null {
  if (mode === "examination") {
    return null;
  }
  if (mode === "session" && amount <= 0) {
    return "أدخل المبلغ الذي دفعه المراجع في هذه الجلسة";
  }
  if (mode === "debt" && amount <= 0) {
    return "أدخل مبلغ الدين المراد تسجيله";
  }
  return null;
}

export function examinationFeeAmount(opts: {
  applyExaminationFee: boolean;
  reviewFeeEnabled: boolean;
  clinicReviewFeeAmount: number;
}): number {
  if (
    !opts.applyExaminationFee ||
    !opts.reviewFeeEnabled ||
    opts.clinicReviewFeeAmount <= 0
  ) {
    return 0;
  }
  return opts.clinicReviewFeeAmount;
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
    opts.mode === "session" ||
    opts.mode === "complete" ||
    opts.mode === "examination"
      ? opts.amount
      : 0;
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
  reviewFee?: number;
  isReviewStatement?: boolean;
  materialsCost: number;
  doctor: Doctor | null;
  plan: PatientFinancialPlan;
}): { doctorShare: number; clinicShare: number } {
  const split = previewPaidSessionSplit({
    paidAmount: opts.paidAmount,
    reviewFee: opts.reviewFee,
    isReviewStatement: opts.isReviewStatement,
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

function roundMoney(n: number): number {
  return Math.round(n * 100) / 100;
}

function num(v: unknown): number {
  const n = Number(v ?? 0);
  return Number.isFinite(n) ? n : 0;
}

/** حصة الطبيب/العيادة من جلسة محفوظة — نفس منطق إدخال الجلسة (نسبة الطبيب 40%/50%…) */
export function resolveOperationPaymentSplit(
  op: {
    paid_amount?: number | string | null;
    doctor_share_amount?: number | string | null;
    clinic_share_amount?: number | string | null;
    materials_cost?: number | string | null;
    review_fee_amount?: number | string | null;
    is_review_statement?: boolean | null;
  },
  doctor: Doctor | null,
  caseRow?: {
    final_price?: number | string | null;
    doctor_share_total?: number | string | null;
    clinic_share_total?: number | string | null;
  } | null
): { doctorShare: number; clinicShare: number; paid: number } {
  const paid = num(op.paid_amount);
  if (paid <= 0) {
    return { doctorShare: 0, clinicShare: 0, paid: 0 };
  }

  const reviewFee = num(op.review_fee_amount);
  const isReviewStatement = Boolean(op.is_review_statement);
  const reviewOnly = isReviewFeeOnlyPayment({
    paid_amount: op.paid_amount,
    review_fee_amount: op.review_fee_amount,
    is_review_statement: op.is_review_statement,
  });

  const storedDoc = num(op.doctor_share_amount);
  const storedClinic = num(op.clinic_share_amount);
  if (!reviewOnly && !doctor && (storedDoc > 0 || storedClinic > 0)) {
    if (storedDoc > 0 && storedClinic > 0) {
      return {
        doctorShare: roundMoney(storedDoc),
        clinicShare: roundMoney(storedClinic),
        paid,
      };
    }
    if (storedDoc > 0) {
      return {
        doctorShare: roundMoney(storedDoc),
        clinicShare: roundMoney(Math.max(0, paid - storedDoc)),
        paid,
      };
    }
    return {
      doctorShare: roundMoney(Math.max(0, paid - storedClinic)),
      clinicShare: roundMoney(storedClinic),
      paid,
    };
  }

  const split = previewPaidSessionSplit({
    paidAmount: paid,
    reviewFee,
    isReviewStatement,
    caseFinalPrice: num(caseRow?.final_price),
    caseDoctorShare: num(caseRow?.doctor_share_total),
    caseClinicShare: num(caseRow?.clinic_share_total),
    doctor,
    materialsCost: num(op.materials_cost),
  });

  if (split) {
    return {
      doctorShare: split.doctorShare,
      clinicShare: split.clinicShare,
      paid,
    };
  }

  if (!doctor) {
    return { doctorShare: 0, clinicShare: roundMoney(paid), paid };
  }

  if (isSalaryDoctor(doctor)) {
    return { doctorShare: 0, clinicShare: roundMoney(paid), paid };
  }

  const treatmentPaid = treatmentPaidForDoctorShare({
    paid_amount: op.paid_amount,
    review_fee_amount: op.review_fee_amount,
    is_review_statement: op.is_review_statement,
  });
  if (treatmentPaid <= 0) {
    return { doctorShare: 0, clinicShare: roundMoney(paid), paid };
  }

  const pct = doctorPaymentPct(doctor);
  const doctorShare = roundMoney(treatmentPaid * pct);
  return {
    doctorShare,
    clinicShare: roundMoney(Math.max(0, paid - doctorShare)),
    paid,
  };
}
