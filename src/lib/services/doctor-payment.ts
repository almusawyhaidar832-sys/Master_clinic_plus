import type { Doctor, DoctorPaymentType } from "@/types";

export function normalizeDoctorPaymentType(value: unknown): DoctorPaymentType {
  return value === "salary" ? "salary" : "percentage";
}

export function isSalaryDoctor(
  doctor: Pick<Doctor, "payment_type">
): boolean {
  return normalizeDoctorPaymentType(doctor.payment_type) === "salary";
}

/** مستحق الطبيب للفترة — راتب ثابت أو مجموع حصص الجلسات */
export function resolveDoctorPeriodEarned(
  doctor: Pick<Doctor, "payment_type" | "salary_amount">,
  operationsShareSum: number
): number {
  if (isSalaryDoctor(doctor)) {
    return Math.max(0, Number(doctor.salary_amount ?? 0));
  }
  return Math.max(0, operationsShareSum);
}

export function doctorPaymentLabel(
  doctor: Pick<Doctor, "payment_type" | "percentage" | "salary_amount">
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
