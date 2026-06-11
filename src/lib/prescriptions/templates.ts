import type { PrescriptionTemplate } from "@/lib/prescriptions/types";

/** قوالب جاهزة — الطبيب يعدّل عليها قبل الحفظ */
export const PRESCRIPTION_TEMPLATES: PrescriptionTemplate[] = [
  {
    id: "dental_pain",
    name_ar: "ألم أسنان + التهاب",
    diagnosis_ar: "ألم أسنان / التهاب لثة",
    medications: [
      {
        drug_name_ar: "Amoxicillin 500mg",
        dosage: "500mg",
        frequency: "3 مرات يومياً",
        duration: "5 أيام",
        instructions: "بعد الأكل",
      },
      {
        drug_name_ar: "Ibuprofen 400mg",
        dosage: "400mg",
        frequency: "عند اللزوم للألم",
        duration: "3 أيام",
        instructions: "لا تتجاوز 3 حبات يومياً",
      },
    ],
  },
  {
    id: "general_cold",
    name_ar: "برد / احتقان",
    diagnosis_ar: "التهاب فيروسي علوي",
    medications: [
      {
        drug_name_ar: "Paracetamol 500mg",
        dosage: "500mg",
        frequency: "كل 8 ساعات عند الحرارة",
        duration: "3 أيام",
      },
      {
        drug_name_ar: "م saline nasal",
        dosage: "بخاخ",
        frequency: "3 مرات يومياً",
        duration: "5 أيام",
      },
    ],
  },
  {
    id: "antibiotic_basic",
    name_ar: "مضاد حيوي أساسي",
    medications: [
      {
        drug_name_ar: "Amoxicillin 500mg",
        dosage: "500mg",
        frequency: "3 مرات يومياً",
        duration: "7 أيام",
        instructions: "أكمل الجرعة كاملة",
      },
    ],
  },
  {
    id: "blank",
    name_ar: "وصفة فارغة",
    medications: [{ drug_name_ar: "" }],
  },
];
