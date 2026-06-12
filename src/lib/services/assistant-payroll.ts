/** نسبة تحمّل الطبيب من راتب المساعد */
export interface AssistantSalaryInput {
  total_salary: number;
  doctor_share_percentage: number;
}

export interface AssistantSalaryBreakdown {
  totalSalary: number;
  doctorSharePercentage: number;
  doctorShare: number;
  clinicShare: number;
}

/**
 * تقسيم راتب المساعد:
 * حصة الطبيب = صافي الراتب × (نسبة الطبيب ÷ 100)
 * حصة العيادة = صافي الراتب − حصة الطبيب
 */
export function breakdownAssistantSalary(
  input: AssistantSalaryInput
): AssistantSalaryBreakdown {
  const totalSalary = Math.max(0, Number(input.total_salary) || 0);
  const doctorSharePercentage = Math.min(
    100,
    Math.max(0, Number(input.doctor_share_percentage) || 0)
  );
  const doctorShare =
    Math.round((totalSalary * doctorSharePercentage) / 100 * 100) / 100;
  const clinicShare = Math.round((totalSalary - doctorShare) * 100) / 100;
  return { totalSalary, doctorSharePercentage, doctorShare, clinicShare };
}

/** يتحقق أن مجموع الحصتين يساوي صافي الراتب (بعد التقريب) */
export function assistantBreakdownIsBalanced(
  breakdown: AssistantSalaryBreakdown
): boolean {
  const sum =
    Math.round((breakdown.doctorShare + breakdown.clinicShare) * 100) / 100;
  return sum === breakdown.totalSalary;
}

export interface AssistantPayrollLine {
  assistantId: string;
  assistantName: string;
  totalSalary: number;
  doctorSharePercentage: number;
  doctorDeduction: number;
  clinicShare: number;
}

export function buildAssistantPayrollLines(
  assistants: (AssistantSalaryInput & { id: string; full_name_ar: string })[]
): AssistantPayrollLine[] {
  return assistants.map((a) => {
    const b = breakdownAssistantSalary(a);
    return {
      assistantId: a.id,
      assistantName: a.full_name_ar,
      totalSalary: b.totalSalary,
      doctorSharePercentage: b.doctorSharePercentage,
      doctorDeduction: b.doctorShare,
      clinicShare: b.clinicShare,
    };
  });
}

/** من سجلات payroll_records المجمّدة لشهر محدد */
export function buildAssistantPayrollLinesFromRecords(
  records: {
    assistant_id: string;
    assistant_name_ar: string;
    total_salary: number;
    doctor_share_percentage: number;
    doctor_share_amount: number;
    clinic_share_amount: number;
  }[]
): AssistantPayrollLine[] {
  return records.map((r) => ({
    assistantId: r.assistant_id,
    assistantName: r.assistant_name_ar,
    totalSalary: Number(r.total_salary),
    doctorSharePercentage: Number(r.doctor_share_percentage),
    doctorDeduction: Number(r.doctor_share_amount),
    clinicShare: Number(r.clinic_share_amount),
  }));
}

export function totalAssistantPayrollDeduction(
  lines: AssistantPayrollLine[]
): number {
  return lines.reduce((s, l) => s + l.doctorDeduction, 0);
}

export interface DoctorExpenseDeduction {
  id: string;
  description: string;
  amount: number;
  percentageSplit: number;
  doctorShare: number;
  expenseDate: string;
}

export function doctorShareFromExpense(
  amount: number,
  percentageSplit: number
): number {
  const pct = Math.min(100, Math.max(0, Number(percentageSplit) || 0));
  return Math.round((Number(amount) * pct) / 100 * 100) / 100;
}

export interface SalaryAdjustmentLine {
  entryType: string;
  entryTypeLabel: string;
  amount: number;
  entryDate: string;
  notes?: string | null;
}

export interface DoctorMonthlySettlement {
  totalDoctorIncome: number;
  totalClinicExpenses: number;
  assistantPayrollDeduction: number;
  doctorNetProfit: number;
  assistantLines: AssistantPayrollLine[];
  expenseLines: DoctorExpenseDeduction[];
  /** طبيب راتب ثابت — تفاصيل الحركات */
  salaryBaseAmount?: number;
  salaryAdvances?: number;
  salaryDeductions?: number;
  salaryBonuses?: number;
  salaryNetAmount?: number;
  salaryAdjustmentLines?: SalaryAdjustmentLine[];
}

export function computeDoctorMonthlySettlement(
  totalDoctorIncome: number,
  expenseLines: DoctorExpenseDeduction[],
  assistantLines: AssistantPayrollLine[]
): DoctorMonthlySettlement {
  const totalClinicExpenses = expenseLines.reduce(
    (s, e) => s + e.doctorShare,
    0
  );
  const assistantPayrollDeduction =
    totalAssistantPayrollDeduction(assistantLines);
  const doctorNetProfit =
    Math.round(
      (totalDoctorIncome - totalClinicExpenses - assistantPayrollDeduction) *
        100
    ) / 100;

  return {
    totalDoctorIncome,
    totalClinicExpenses,
    assistantPayrollDeduction,
    doctorNetProfit,
    assistantLines,
    expenseLines,
  };
}
