import type { DoctorPercentage, MaterialsCostShare } from "@/types";

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
 * العلاج يُقسّم حسب نسبة الطبيب — الكشفية كاملة لصافي ربح العيادة (لا تدخل محفظة الطبيب).
 */
export function splitTreatmentAndReviewFee(
  treatmentFinal: number,
  reviewFee: number,
  materialsCost: number,
  doctor: { percentage: DoctorPercentage; materials_share: MaterialsCostShare } | null
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
