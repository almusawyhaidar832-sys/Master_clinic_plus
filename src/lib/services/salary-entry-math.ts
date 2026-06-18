import { calculateSalaryNet } from "@/lib/utils";
import type { SalaryEntry } from "@/types";
import type { AssistantCompensationMode } from "@/lib/services/assistant-compensation";
import { isDailyWageAssistant } from "@/lib/services/assistant-compensation";
export function summarizeSalaryEntries(
  entries: Pick<SalaryEntry, "entry_type" | "amount">[]
) {
  const advances = entries
    .filter((e) => e.entry_type === "advance")
    .reduce((s, e) => s + Number(e.amount ?? 0), 0);
  const deductions = entries
    .filter((e) => e.entry_type === "deduction" || e.entry_type === "absence")
    .reduce((s, e) => s + Number(e.amount ?? 0), 0);
  const bonuses = entries
    .filter((e) => e.entry_type === "bonus")
    .reduce((s, e) => s + Number(e.amount ?? 0), 0);
  const dailyWages = entries
    .filter((e) => e.entry_type === "daily_wage")
    .reduce((s, e) => s + Number(e.amount ?? 0), 0);
  return { advances, deductions, bonuses, dailyWages };
}

/** صافي شهر واحد — الراتب الأساسي ثابت + حركات هذا الشهر فقط */
export function computeStaffNetPay(
  baseSalary: number,
  entries: Pick<SalaryEntry, "entry_type" | "amount">[]
) {
  const { advances, deductions, bonuses, dailyWages } =
    summarizeSalaryEntries(entries);
  const netPayout = calculateSalaryNet(
    baseSalary,
    advances,
    deductions,
    bonuses
  );
  return { advances, deductions, bonuses, dailyWages, netPayout };
}

/** صافي مساعد طبيب — شهري ثابت أو مجموع أيام العمل */
export function computeAssistantNetPay(
  compensationMode: AssistantCompensationMode | string | null | undefined,
  baseSalary: number,
  entries: Pick<SalaryEntry, "entry_type" | "amount">[]
) {
  const { advances, deductions, bonuses, dailyWages } =
    summarizeSalaryEntries(entries);

  if (isDailyWageAssistant(compensationMode)) {
    const netPayout = Math.max(
      0,
      Math.round((dailyWages + bonuses - advances - deductions) * 100) / 100
    );
    return { advances, deductions, bonuses, dailyWages, netPayout };
  }

  const netPayout = calculateSalaryNet(baseSalary, advances, deductions, bonuses);
  return { advances, deductions, bonuses, dailyWages, netPayout };
}
