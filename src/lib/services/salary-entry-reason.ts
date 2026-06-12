import type { SalaryEntryType } from "@/types";

/** أنواع تتطلب سبباً مكتوباً من المحاسب */
export const SALARY_REASON_REQUIRED_TYPES: SalaryEntryType[] = [
  "deduction",
  "absence",
  "bonus",
];

export function isSalaryReasonRequired(entryType: string): boolean {
  return SALARY_REASON_REQUIRED_TYPES.includes(entryType as SalaryEntryType);
}

export function salaryReasonFieldLabel(entryType: string): string {
  switch (entryType) {
    case "deduction":
    case "absence":
      return "سبب الخصم";
    case "bonus":
      return "سبب المكافأة";
    default:
      return "ملاحظات (اختياري)";
  }
}

export function salaryReasonPlaceholder(entryType: string): string {
  switch (entryType) {
    case "deduction":
      return "مثال: تأخر عن العمل — خصم يومين";
    case "absence":
      return "مثال: غياب بدون إذن يوم 5";
    case "bonus":
      return "مثال: مكافأة أداء أو حضور ممتاز";
    default:
      return "اختياري — سبب السلفة إن وُجد";
  }
}

export function validateSalaryEntryReason(
  entryType: string,
  notesAr?: string | null
): string | null {
  if (!isSalaryReasonRequired(entryType)) return null;
  if (!notesAr?.trim()) {
    return entryType === "bonus"
      ? "سبب المكافأة مطلوب"
      : "سبب الخصم مطلوب";
  }
  if (notesAr.trim().length < 3) {
    return "اكتب سبباً أوضح (3 أحرف على الأقل)";
  }
  return null;
}
