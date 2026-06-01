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
