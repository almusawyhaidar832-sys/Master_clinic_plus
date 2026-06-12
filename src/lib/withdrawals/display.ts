import type { WithdrawalStatus } from "@/types";

export const WITHDRAWAL_STATUS_AR: Record<string, string> = {
  pending: "معلّق",
  approved: "موافق",
  paid: "مدفوع",
  rejected: "مرفوض",
};

export const WITHDRAWAL_SOURCE_AR: Record<string, string> = {
  doctor_request: "طلب طبيب",
  accountant_cash: "دفع نقدي — محاسب",
};

export function withdrawalStatusLabel(status: string): string {
  return WITHDRAWAL_STATUS_AR[status] ?? status;
}

export function withdrawalSourceLabel(source: string | null | undefined): string {
  if (!source) return "سحب";
  return WITHDRAWAL_SOURCE_AR[source] ?? source;
}

export interface DoctorWithdrawalLine {
  id: string;
  doctorId: string;
  doctorName: string;
  amount: number;
  status: WithdrawalStatus | string;
  source: string;
  effectiveDate: string;
}
