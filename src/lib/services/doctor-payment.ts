import type { Doctor, DoctorPaymentType } from "@/types";

export function normalizeDoctorPaymentType(value: unknown): DoctorPaymentType {
  return value === "salary" ? "salary" : "percentage";
}

/** الاتفاق المالي — financial_agreement أو payment_type من قاعدة البيانات */
export function getDoctorFinancialAgreement(doctor: {
  payment_type?: unknown;
  financial_agreement?: unknown;
}): DoctorPaymentType {
  if (doctor.financial_agreement != null && doctor.financial_agreement !== "") {
    return normalizeDoctorPaymentType(doctor.financial_agreement);
  }
  return normalizeDoctorPaymentType(doctor.payment_type);
}

export function isSalaryDoctor(
  doctor: Pick<Doctor, "payment_type" | "financial_agreement"> | {
    payment_type?: unknown;
    financial_agreement?: unknown;
  }
): boolean {
  return getDoctorFinancialAgreement(doctor) === "salary";
}

/** مستحق الطبيب للفترة — راتب ثابت أو مجموع حصص الجلسات */
export function resolveDoctorPeriodEarned(
  doctor: Pick<Doctor, "payment_type" | "financial_agreement" | "salary_amount">,
  operationsShareSum: number
): number {
  if (isSalaryDoctor(doctor)) {
    return Math.max(0, Number(doctor.salary_amount ?? 0));
  }
  return Math.max(0, operationsShareSum);
}

export function doctorPaymentLabel(
  doctor: Pick<
    Doctor,
    "payment_type" | "financial_agreement" | "percentage" | "salary_amount"
  >
): string {
  if (isSalaryDoctor(doctor)) {
    const amount = Number(doctor.salary_amount ?? 0);
    return amount > 0 ? `راتب ثابت — ${amount.toLocaleString("ar-IQ")} د.ع` : "راتب ثابت";
  }
  return `نسبة ${doctor.percentage}%`;
}

export function parseSalaryAmount(raw: unknown): number {
  const n = Number(raw);
  if (!Number.isFinite(n) || n < 0) return 0;
  return Math.round(n * 100) / 100;
}
