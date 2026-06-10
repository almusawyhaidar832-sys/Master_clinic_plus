/**
 * Navigation definitions — module-aware
 * Each item can declare a `requiredModule` that must be enabled
 * for it to appear in the sidebar/bottom-nav.
 * useModuleNav() filters this list at runtime.
 */

import type { ModuleNavItem } from "@/hooks/useModuleNav";

// =============================================================================
// ACCOUNTANT / DASHBOARD nav
// =============================================================================
export const accountantModuleNav: ModuleNavItem[] = [
  // Core — always visible
  { href: "/dashboard",             label: "الربح والتحكم",      icon: "dashboard"    },
  { href: "/dashboard/ledger",      label: "إدخال جلسة",         icon: "patients",    requiredModule: "billing"            },
  { href: "/dashboard/queue",       label: "غرفة الانتظار",      icon: "listOrdered", requiredModule: "patient_queue"      },
  { href: "/dashboard/appointments", label: "الحجوزات",          icon: "calendarClock", requiredModule: "appointments"     },
  { href: "/dashboard/assistants",  label: "إدارة المساعدين",    icon: "userRound"                                      },
  { href: "/dashboard/doctor-expenses", label: "صرفيات عامة",    icon: "expenses"                                     },
  { href: "/dashboard/patients",    label: "ملفات المرضى",        icon: "patients",    requiredModule: "patients"           },
  { href: "/dashboard/reports",     label: "تقارير العيادة",      icon: "profits",     requiredModule: "reports"            },
  { href: "/dashboard/refunds",     label: "إدارة المرتجعات",     icon: "refunds",     requiredModule: "billing"            },
  { href: "/dashboard/activity",    label: "سجل المراقبة",        icon: "activity"                                      },
  { href: "/dashboard/doctors",     label: "الأطباء",             icon: "doctors"      },
  { href: "/dashboard/withdrawals", label: "طلبات السحب",         icon: "withdrawals", requiredModule: "doctor_wallet"      },
  { href: "/dashboard/salary",      label: "رواتب الموظفين",      icon: "salary"       },
  { href: "/dashboard/employees",  label: "إدارة الرواتب",       icon: "userCog"      },
  // Module-gated
  { href: "/dashboard/prescriptions",label: "الوصفات الذكية",    icon: "filePen",     requiredModule: "smart_prescriptions"},
  { href: "/dashboard/lab",         label: "المختبر",             icon: "testTube",    requiredModule: "lab_integration"    },
  { href: "/dashboard/pharmacy",    label: "الصيدلية",            icon: "pill",        requiredModule: "pharmacy_link"      },
  // Always at bottom
  { href: "/dashboard/users",       label: "المستخدمون",          icon: "userCog"                                          },
  { href: "/dashboard/whatsapp",    label: "واتساب",              icon: "whatsapp",    requiredModule: "whatsapp"           },
  { href: "/dashboard/booking",     label: "بوابة الحجوزات",      icon: "calendarClock", requiredModule: "online_booking" },
  { href: "/dashboard/settings",    label: "ملف العيادة",         icon: "dashboard"    },
];

/** المالك فقط — ليس للمحاسب */
export const ownerProfileNavItem: ModuleNavItem = {
  href: "/dashboard/profile",
  label: "الملف الشخصي",
  icon: "userCog",
  roles: ["super_admin"],
};

/** Super admin sees all + platform admin link */
export const superAdminModuleNav: ModuleNavItem[] = [
  ...accountantModuleNav,
  ownerProfileNavItem,
  {
    href: "/admin",
    label: "لوحة المالك (جوال)",
    icon: "profits",
    roles: ["super_admin"],
  },
];

// =============================================================================
// ASSISTANT nav — حجوزات الطبيب فقط
// =============================================================================
export const assistantModuleNav: ModuleNavItem[] = [
  {
    href: "/assistant/dashboard",
    label: "حجوزات طبيبي",
    icon: "calendarClock",
  },
];

// =============================================================================
// DOCTOR mobile nav
// =============================================================================
export const doctorModuleNav: ModuleNavItem[] = [
  { href: "/doctor",           label: "الرئيسية",    icon: "home"         },
  { href: "/doctor/financial-ledger", label: "السجل المالي", icon: "scrollText", requiredModule: "doctor_wallet" },
  { href: "/doctor/queue",     label: "الانتظار",    icon: "listOrdered", requiredModule: "patient_queue"  },
  { href: "/doctor/wallet",    label: "المحفظة",     icon: "wallet",      requiredModule: "doctor_wallet"  },
  { href: "/doctor/patients",  label: "المرضى",      icon: "users",       requiredModule: "patients"       },
  { href: "/doctor/schedule",  label: "المواعيد",    icon: "calendarClock",requiredModule: "appointments"  },
  { href: "/doctor/profile",   label: "حسابي",       icon: "userCog"      },
];

// Doctor quick actions — shown on home screen grid
export const doctorModuleQuickActions: ModuleNavItem[] = [
  { href: "/doctor/financial-ledger", label: "السجل المالي",          icon: "scrollText",    requiredModule: "doctor_wallet"      },
  { href: "/doctor/wallet",      label: "المحفظة",               icon: "wallet",        requiredModule: "doctor_wallet"      },
  { href: "/doctor/withdraw",    label: "طلب سحب",               icon: "arrowDownToLine",requiredModule: "doctor_wallet"     },
  { href: "/doctor/patients",    label: "رعاية المرضى",          icon: "users",         requiredModule: "patients"           },
  { href: "/doctor/filter",      label: "تصفية بالتاريخ",        icon: "calendar",      requiredModule: "reports"            },
  { href: "/doctor/schedule",    label: "إدارة المواعيد",        icon: "calendarClock", requiredModule: "appointments"       },
  { href: "/doctor/incomplete",  label: "علاجات غير مكتملة",     icon: "alertCircle",   requiredModule: "treatment_plans"    },
  { href: "/doctor/statement",   label: "كشف حساب مريض",         icon: "fileText",      requiredModule: "billing"            },
  { href: "/doctor/dental-chart",label: "مخطط الأسنان",          icon: "smile",         requiredModule: "dental_chart"       },
  { href: "/doctor/prescriptions",label: "وصفة طبية",            icon: "filePen",       requiredModule: "smart_prescriptions"},
  { href: "/doctor/vital-signs", label: "العلامات الحيوية",      icon: "activity",      requiredModule: "vital_signs"        },
];

// =============================================================================
// Legacy re-exports (backward compat — existing pages import these)
// =============================================================================
import type { NavItem } from "@/types";

/** @deprecated Use accountantModuleNav + useModuleNav() instead */
export const accountantNav: NavItem[] = accountantModuleNav.map((i) => ({
  href: i.href,
  label: i.label,
  icon: i.icon,
  roles: i.roles,
}));

/** @deprecated Use superAdminModuleNav + useModuleNav() instead */
export const superAdminNav: NavItem[] = superAdminModuleNav.map((i) => ({
  href: i.href,
  label: i.label,
  icon: i.icon,
  roles: i.roles,
}));
