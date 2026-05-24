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

/** Net clinic profit snapshot */
export function calculateClinicProfit(params: {
  totalRevenue: number;
  totalOutstandingDebts: number;
  totalDoctorPayouts: number;
  totalStaffSalaries: number;
  totalExpenses: number;
}): {
  cashInflow: number;
  outstandingDebts: number;
  netProfit: number;
} {
  const {
    totalRevenue,
    totalOutstandingDebts,
    totalDoctorPayouts,
    totalStaffSalaries,
    totalExpenses,
  } = params;

  const netProfit =
    totalRevenue - totalDoctorPayouts - totalStaffSalaries - totalExpenses;

  return {
    cashInflow: totalRevenue,
    outstandingDebts: totalOutstandingDebts,
    netProfit: Math.round(netProfit * 100) / 100,
  };
}

/** Salary slip: Base - Advances - Deductions = Net */
export function calculateSalaryNet(
  baseSalary: number,
  advances: number,
  deductions: number
): number {
  return Math.max(0, baseSalary - advances - deductions);
}
