import type { DoctorPercentage, DoctorPaymentType, MaterialsCostShare } from "@/types";
import { isSalaryDoctor } from "@/lib/services/doctor-payment";

export type DoctorShareInput = {
  percentage: DoctorPercentage;
  materials_share: MaterialsCostShare;
  payment_type?: DoctorPaymentType | null;
  financial_agreement?: DoctorPaymentType | null;
};

/** Doctor payout from operation based on fixed agreement rules */
export function calculateDoctorShare(
  totalAmount: number,
  percentage: DoctorPercentage,
  materialsCost: number,
  materialsShare: MaterialsCostShare
): { doctorShare: number; clinicShare: number } {
  const pct = Number(percentage) / 100;
  const matSharePct = Number(materialsShare) / 100;
  const doctorGross = totalAmount * pct;
  const doctorMaterialsDeduction = materialsCost * matSharePct;
  const doctorShare = doctorGross - doctorMaterialsDeduction;
  const clinicShare = totalAmount - doctorShare;
  return {
    doctorShare: Math.round(doctorShare * 100) / 100,
    clinicShare: Math.round(clinicShare * 100) / 100,
  };
}

/**
 * تقسيم المبلغ حسب اتفاق الطبيب المالي.
 * salary → حصة الطبيب 0 والمبلغ كاملاً للعيادة.
 */
export function calculateDoctorShareForDoctor(
  totalAmount: number,
  doctor: DoctorShareInput | null,
  materialsCost: number
): { doctorShare: number; clinicShare: number } {
  const treatment = Math.max(0, totalAmount);
  if (treatment <= 0) {
    return { doctorShare: 0, clinicShare: 0 };
  }
  if (!doctor || isSalaryDoctor(doctor)) {
    return { doctorShare: 0, clinicShare: Math.round(treatment * 100) / 100 };
  }
  return calculateDoctorShare(
    treatment,
    doctor.percentage,
    materialsCost,
    doctor.materials_share
  );
}

/**
 * العلاج يُقسّم حسب نسبة الطبيب — الكشفية كاملة لصافي ربح العيادة (لا تدخل محفظة الطبيب).
 * طبيب الراتب: كل المبالغ للعيادة.
 */
export function splitTreatmentAndReviewFee(
  treatmentFinal: number,
  reviewFee: number,
  materialsCost: number,
  doctor: DoctorShareInput | null
): { doctorShare: number; clinicShare: number; agreedTotal: number } | null {
  const treatment = Math.max(0, treatmentFinal);
  const review = Math.max(0, reviewFee);
  if (treatment <= 0 && review <= 0) return null;

  if (!doctor || treatment <= 0) {
    return {
      doctorShare: 0,
      clinicShare: Math.round(review * 100) / 100,
      agreedTotal: Math.round((treatment + review) * 100) / 100,
    };
  }

  if (isSalaryDoctor(doctor)) {
    const agreedTotal = Math.round((treatment + review) * 100) / 100;
    return {
      doctorShare: 0,
      clinicShare: agreedTotal,
      agreedTotal,
    };
  }

  const split = calculateDoctorShare(
    treatment,
    doctor.percentage,
    materialsCost,
    doctor.materials_share
  );
  return {
    doctorShare: split.doctorShare,
    clinicShare: Math.round((split.clinicShare + review) * 100) / 100,
    agreedTotal: Math.round((treatment + review) * 100) / 100,
  };
}

/**
 * Net clinic profit — doctor withdrawals do NOT reduce clinic profit.
 * Doctor wallet is separate from clinic earnings.
 */
export function calculateClinicProfit(params: {
  clinicShareFromOperations: number;
  totalOutstandingDebts: number;
  totalStaffSalaries: number;
  totalExpenses: number;
  cashCollected?: number;
  doctorShareAccrued?: number;
}): {
  cashInflow: number;
  outstandingDebts: number;
  netProfit: number;
  doctorShareAccrued: number;
} {
  const {
    clinicShareFromOperations,
    totalOutstandingDebts,
    totalStaffSalaries,
    totalExpenses,
    cashCollected = 0,
    doctorShareAccrued = 0,
  } = params;

  const netProfit =
    clinicShareFromOperations - totalStaffSalaries - totalExpenses;

  return {
    cashInflow: cashCollected,
    outstandingDebts: totalOutstandingDebts,
    netProfit: Math.round(netProfit * 100) / 100,
    doctorShareAccrued,
  };
}
