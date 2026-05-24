/** Fixed dropdown options — no free-text for doctor agreements */

export const DOCTOR_PERCENTAGE_OPTIONS = [
  { value: "10", label: "10%" },
  { value: "20", label: "20%" },
  { value: "30", label: "30%" },
  { value: "40", label: "40%" },
  { value: "50", label: "50%" },
  { value: "60", label: "60%" },
  { value: "70", label: "70%" },
  { value: "80", label: "80%" },
] as const;

export const MATERIALS_SHARE_OPTIONS = [
  { value: "0", label: "0% — على العيادة بالكامل" },
  { value: "10", label: "10%" },
  { value: "20", label: "20%" },
  { value: "30", label: "30%" },
  { value: "40", label: "40%" },
  { value: "50", label: "50% — تقسيم مناصفة" },
] as const;

export const USER_ROLE_LABELS: Record<string, string> = {
  super_admin: "مدير النظام",
  accountant: "محاسب / استقبال",
  doctor: "طبيب",
};

export const STAFF_SLOTS = 7;

export const APP_NAME = "ماستر كلينك بلس";
export const APP_NAME_EN = "Master Clinic Plus";
