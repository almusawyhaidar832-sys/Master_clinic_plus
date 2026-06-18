/** نوع تعويض مساعد الطبيب */
export type AssistantCompensationMode = "monthly_fixed" | "daily_wage";

export function normalizeAssistantCompensationMode(
  value: string | null | undefined
): AssistantCompensationMode {
  return value === "daily_wage" ? "daily_wage" : "monthly_fixed";
}

export function isDailyWageAssistant(
  mode: string | null | undefined
): boolean {
  return normalizeAssistantCompensationMode(mode) === "daily_wage";
}

export const ASSISTANT_COMPENSATION_LABELS: Record<
  AssistantCompensationMode,
  string
> = {
  monthly_fixed: "راتب شهري ثابت",
  daily_wage: "أجر يومي متغير",
};
