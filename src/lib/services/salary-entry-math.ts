import { calculateSalaryNet } from "@/lib/utils";
import type { SalaryEntry } from "@/types";

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
  return { advances, deductions, bonuses };
}

/** صافي شهر واحد — الراتب الأساسي ثابت + حركات هذا الشهر فقط */
export function computeStaffNetPay(
  baseSalary: number,
  entries: Pick<SalaryEntry, "entry_type" | "amount">[]
) {
  const { advances, deductions, bonuses } = summarizeSalaryEntries(entries);
  const netPayout = calculateSalaryNet(baseSalary, advances, deductions, bonuses);
  return { advances, deductions, bonuses, netPayout };
}
