/** حقول الطبيب المالية من قاعدة البيانات — بدون financial_agreement (غير موجود في الجدول) */
export const DOCTOR_FINANCE_SELECT =
  "id, percentage, payment_type, materials_share, salary_amount" as const;

export const DOCTOR_FINANCE_WITH_NAME_SELECT =
  "id, full_name_ar, percentage, payment_type, materials_share, salary_amount" as const;
