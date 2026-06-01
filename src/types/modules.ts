/**
 * Master Clinic Plus — Dynamic Module System Types
 * Single source of truth for all module/specialty definitions
 */

// =============================================================================
// CLINIC SPECIALTY
// =============================================================================
export type ClinicSpecialty =
  | "dental"           // طب الأسنان
  | "general_medicine" // الطب العام / باطنية
  | "cosmetic"         // تجميل
  | "pediatrics"       // طب الأطفال
  | "ophthalmology"    // طب العيون
  | "physiotherapy"    // علاج طبيعي
  | "custom";          // مخصص

export const SPECIALTY_LABELS: Record<ClinicSpecialty, string> = {
  dental:           "طب الأسنان",
  general_medicine: "الطب العام / باطنية",
  cosmetic:         "تجميل وجماليات",
  pediatrics:       "طب الأطفال",
  ophthalmology:    "طب العيون",
  physiotherapy:    "العلاج الطبيعي",
  custom:           "مخصص",
};

// =============================================================================
// MODULE KEYS
// =============================================================================
/** All available feature modules in the system */
export type ClinicModuleKey =
  // ---- CORE (always available) -------------------------------------------
  | "appointments"      // المواعيد
  | "patients"          // ملفات المرضى
  | "billing"           // الفواتير والمدفوعات
  | "reports"           // التقارير المالية
  | "doctor_wallet"     // محفظة الطبيب
  | "whatsapp"          // واتساب
  | "patient_queue"     // غرفة الانتظار الحية
  | "online_booking"    // الحجز الإلكتروني
  // ---- DENTAL ------------------------------------------------------------
  | "dental_chart"      // مخطط الأسنان التفاعلي
  | "ortho_schedule"    // جدول التقويم (جلسات)
  | "lab_prosthetics"   // مختبر الأطراف الصناعية (كراون/جسور)
  // ---- GENERAL MEDICINE --------------------------------------------------
  | "lab_integration"   // تكامل المختبر (تحاليل)
  | "pharmacy_link"     // الصيدلية الخارجية
  | "vital_signs"       // العلامات الحيوية
  // ---- SHARED CLINICAL ---------------------------------------------------
  | "smart_prescriptions" // الوصفات الذكية / القوالب
  | "inventory"           // المخزون والمواد الاستهلاكية
  | "treatment_plans"     // خطط العلاج
  // ---- SPECIALTY-SPECIFIC ------------------------------------------------
  | "photo_gallery"     // معرض الصور (تجميل)
  | "growth_chart"      // منحنى النمو (أطفال)
  | "vision_chart"      // جدول بصري (عيون)
  | "session_plans"     // خطط الجلسات (علاج طبيعي)
  | "progress_tracking"; // تتبع التقدم (علاج طبيعي)

// =============================================================================
// MODULE METADATA
// =============================================================================
export interface ModuleMeta {
  key: ClinicModuleKey;
  label: string;
  description: string;
  icon: string;         // lucide icon name
  /** Which specialties this module is relevant for (empty = all) */
  specialties: ClinicSpecialty[];
  /** Core modules cannot be disabled */
  isCore: boolean;
}

export const MODULE_REGISTRY: ModuleMeta[] = [
  // CORE
  { key: "appointments",       label: "المواعيد",               description: "جدولة وإدارة مواعيد المرضى",      icon: "CalendarClock",   specialties: [], isCore: true  },
  { key: "patients",           label: "ملفات المرضى",           description: "قاعدة بيانات المرضى الكاملة",    icon: "Users",           specialties: [], isCore: true  },
  { key: "billing",            label: "الفواتير",               description: "إدخال الجلسات والمدفوعات",        icon: "Receipt",         specialties: [], isCore: true  },
  { key: "reports",            label: "التقارير",               description: "تقارير مالية وإحصائية شاملة",    icon: "BarChart3",       specialties: [], isCore: true  },
  { key: "doctor_wallet",      label: "محفظة الطبيب",           description: "الأرباح والسحوبات",               icon: "Wallet",          specialties: [], isCore: true  },
  { key: "whatsapp",           label: "واتساب",                 description: "إشعارات ورسائل تلقائية",          icon: "MessageCircle",   specialties: [], isCore: true  },
  { key: "patient_queue",      label: "غرفة الانتظار",          description: "نظام الأدوار والنداء الصوتي",     icon: "ListOrdered",     specialties: [], isCore: true  },
  { key: "online_booking",     label: "الحجز الإلكتروني",       description: "بوابة حجز المرضى + QR",           icon: "Globe",           specialties: [], isCore: true  },
  // DENTAL
  { key: "dental_chart",       label: "مخطط الأسنان",           description: "رسم تفاعلي لحالة الأسنان",        icon: "Smile",           specialties: ["dental"],                        isCore: false },
  { key: "ortho_schedule",     label: "جدول التقويم",           description: "متابعة جلسات التقويم",            icon: "CalendarDays",    specialties: ["dental"],                        isCore: false },
  { key: "lab_prosthetics",    label: "مختبر الأطراف",          description: "طلبات الكراون والجسور للمختبر",  icon: "FlaskConical",    specialties: ["dental"],                        isCore: false },
  // GENERAL MEDICINE
  { key: "lab_integration",    label: "تحاليل المختبر",         description: "إرسال طلبات واستلام نتائج",       icon: "TestTube2",       specialties: ["general_medicine","pediatrics"],  isCore: false },
  { key: "pharmacy_link",      label: "الصيدلية",               description: "إرسال الوصفات للصيدلية مباشرة",  icon: "Pill",            specialties: ["general_medicine","pediatrics"],  isCore: false },
  { key: "vital_signs",        label: "العلامات الحيوية",       description: "ضغط، حرارة، وزن، سكر",           icon: "Activity",        specialties: ["general_medicine","pediatrics"],  isCore: false },
  // SHARED CLINICAL
  { key: "smart_prescriptions",label: "الوصفات الذكية",        description: "قوالب جاهزة وطباعة احترافية",    icon: "FilePen",         specialties: [],                                isCore: false },
  { key: "inventory",          label: "المخزون",                description: "مواد استهلاكية وتنبيه النفاد",   icon: "Package",         specialties: [],                                isCore: false },
  { key: "treatment_plans",    label: "خطط العلاج",             description: "علاجات متعددة الجلسات والأقساط", icon: "ClipboardList",   specialties: [],                                isCore: false },
  // SPECIALTY-SPECIFIC
  { key: "photo_gallery",      label: "معرض الصور",             description: "توثيق قبل وبعد التدخل",          icon: "Image",           specialties: ["cosmetic"],                      isCore: false },
  { key: "growth_chart",       label: "منحنى النمو",            description: "متابعة نمو الطفل",               icon: "TrendingUp",      specialties: ["pediatrics"],                    isCore: false },
  { key: "vision_chart",       label: "جدول الرؤية",            description: "قياس حدة البصر",                 icon: "Eye",             specialties: ["ophthalmology"],                 isCore: false },
  { key: "session_plans",      label: "خطط الجلسات",            description: "برامج العلاج الطبيعي",           icon: "Dumbbell",        specialties: ["physiotherapy"],                 isCore: false },
  { key: "progress_tracking",  label: "تتبع التقدم",            description: "قياس تحسن المريض",               icon: "LineChart",       specialties: ["physiotherapy"],                 isCore: false },
];

// =============================================================================
// DEFAULT MODULES PER SPECIALTY (mirrors DB function)
// =============================================================================
const CORE_MODULES: ClinicModuleKey[] = [
  "appointments", "patients", "billing", "reports",
  "doctor_wallet", "whatsapp", "patient_queue", "online_booking",
];

export const SPECIALTY_DEFAULT_MODULES: Record<ClinicSpecialty, ClinicModuleKey[]> = {
  dental: [
    ...CORE_MODULES,
    "dental_chart", "ortho_schedule", "lab_prosthetics",
    "smart_prescriptions", "inventory",
  ],
  general_medicine: [
    ...CORE_MODULES,
    "lab_integration", "pharmacy_link", "vital_signs",
    "smart_prescriptions", "inventory",
  ],
  cosmetic: [
    ...CORE_MODULES,
    "treatment_plans", "photo_gallery", "smart_prescriptions",
  ],
  pediatrics: [
    ...CORE_MODULES,
    "lab_integration", "pharmacy_link", "vital_signs",
    "growth_chart", "smart_prescriptions",
  ],
  ophthalmology: [
    ...CORE_MODULES,
    "vision_chart", "lab_integration", "smart_prescriptions", "inventory",
  ],
  physiotherapy: [
    ...CORE_MODULES,
    "session_plans", "progress_tracking", "inventory",
  ],
  custom: MODULE_REGISTRY.map((m) => m.key), // كل الموديولات مفعلة
};

// =============================================================================
// CLINIC SETTINGS (DB row shape)
// =============================================================================
export interface ClinicSettings {
  id: string;
  clinic_id: string;
  specialty: ClinicSpecialty;
  enabled_modules: ClinicModuleKey[];
  module_config: Record<string, unknown>;
}
