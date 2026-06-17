import type { DoctorShareInput } from "@/lib/finance";
import type { Doctor } from "@/types";

export function doctorToShareInput(doctor: Doctor | null): DoctorShareInput | null {
  if (!doctor) return null;
  return {
    percentage: doctor.percentage,
    materials_share: doctor.materials_share,
    payment_type: doctor.payment_type,
    financial_agreement: doctor.financial_agreement,
  };
}
