/**
 * Navigation definitions — module-aware
 * Labels come from i18n via labelKey (useLanguage().t)
 */

import type { TranslationKey } from "@/i18n/translations";
import type { ModuleNavItem } from "@/hooks/useModuleNav";

// =============================================================================
// ACCOUNTANT / DASHBOARD nav
// =============================================================================
export const accountantModuleNav: ModuleNavItem[] = [
  { href: "/dashboard",              labelKey: "navExecutiveDashboard", icon: "dashboard" },
  { href: "/dashboard/ledger",       labelKey: "navAddSession",       icon: "patients",    requiredModule: "billing" },
  { href: "/dashboard/queue",        labelKey: "navWaitingRoom",      icon: "listOrdered", requiredModule: "patient_queue" },
  { href: "/dashboard/appointments", labelKey: "navAppointments",     icon: "calendarClock", requiredModule: "appointments" },
  { href: "/dashboard/assistants",   labelKey: "navAssistants",       icon: "userRound" },
  { href: "/dashboard/doctor-expenses", labelKey: "navGeneralExpenses", icon: "expenses" },
  { href: "/dashboard/patients",     labelKey: "navPatientFiles",     icon: "patients",    requiredModule: "patients" },
  { href: "/dashboard/reports",      labelKey: "navClinicReports",    icon: "profits",     requiredModule: "reports" },
  { href: "/dashboard/refunds",      labelKey: "navRefunds",          icon: "refunds",     requiredModule: "billing" },
  { href: "/dashboard/activity",     labelKey: "navAuditLog",         icon: "activity" },
  { href: "/dashboard/doctors",      labelKey: "navDoctors",          icon: "doctors" },
  { href: "/dashboard/withdrawals",  labelKey: "navWithdrawals",      icon: "withdrawals", requiredModule: "doctor_wallet" },
  { href: "/dashboard/salary",       labelKey: "navStaffSalaries",    icon: "salary" },
  { href: "/dashboard/employees",    labelKey: "navPayrollManage",    icon: "userCog" },
  { href: "/dashboard/lab",          labelKey: "navLab",              icon: "testTube",    requiredModule: "lab_integration" },
  { href: "/dashboard/pharmacy",     labelKey: "navPharmacy",         icon: "pill",        requiredModule: "pharmacy_link" },
  { href: "/dashboard/users",        labelKey: "navUsers",            icon: "userCog" },
  { href: "/dashboard/whatsapp",     labelKey: "navWhatsApp",         icon: "whatsapp",    requiredModule: "whatsapp" },
  { href: "/dashboard/booking",      labelKey: "navBookingPortal",    icon: "calendarClock", requiredModule: "online_booking" },
  { href: "/dashboard/settings",     labelKey: "navClinicProfile",    icon: "dashboard" },
];

export const ownerProfileNavItem: ModuleNavItem = {
  href: "/dashboard/profile",
  labelKey: "navPersonalProfile",
  icon: "userCog",
  roles: ["super_admin"],
};

export const superAdminModuleNav: ModuleNavItem[] = [
  ...accountantModuleNav,
  ownerProfileNavItem,
  {
    href: "/admin",
    labelKey: "navOwnerMobile",
    icon: "profits",
    roles: ["super_admin"],
  },
];

// =============================================================================
// ASSISTANT nav
// =============================================================================
export const assistantModuleNav: ModuleNavItem[] = [
  {
    href: "/assistant/dashboard",
    labelKey: "navAssistantBookings",
    icon: "calendarClock",
  },
];

// =============================================================================
// DOCTOR mobile nav
// =============================================================================
export const doctorModuleNav: ModuleNavItem[] = [
  { href: "/doctor",                  labelKey: "navHome",             icon: "home" },
  { href: "/doctor/financial-ledger", labelKey: "navFinancialLedger",  icon: "scrollText",    requiredModule: "doctor_wallet" },
  { href: "/doctor/queue",            labelKey: "navWaiting",          icon: "listOrdered",   requiredModule: "patient_queue" },
  { href: "/doctor/wallet",           labelKey: "wallet",              icon: "wallet",        requiredModule: "doctor_wallet" },
  { href: "/doctor/patients",         labelKey: "navPatientsShort",    icon: "users",         requiredModule: "patients" },
  { href: "/doctor/schedule",         labelKey: "schedule",            icon: "calendarClock", requiredModule: "appointments" },
  { href: "/doctor/profile",          labelKey: "navMyAccount",        icon: "userCog" },
];

export const doctorModuleQuickActions: ModuleNavItem[] = [
  { href: "/doctor/financial-ledger", labelKey: "navFinancialLedger",   icon: "scrollText",    requiredModule: "doctor_wallet" },
  { href: "/doctor/wallet",           labelKey: "wallet",               icon: "wallet",        requiredModule: "doctor_wallet" },
  { href: "/doctor/withdraw",         labelKey: "navWithdrawRequest",   icon: "arrowDownToLine", requiredModule: "doctor_wallet" },
  { href: "/doctor/patients",         labelKey: "navPatientCare",       icon: "users",         requiredModule: "patients" },
  { href: "/doctor/filter",           labelKey: "navFilterByDate",      icon: "calendar",      requiredModule: "reports" },
  { href: "/doctor/schedule",         labelKey: "navManageAppointments", icon: "calendarClock", requiredModule: "appointments" },
  { href: "/doctor/incomplete",       labelKey: "navIncompleteTreatments", icon: "alertCircle", requiredModule: "treatment_plans" },
  { href: "/doctor/statement",        labelKey: "navPatientStatement",  icon: "fileText",      requiredModule: "billing" },
  { href: "/doctor/dental-chart",     labelKey: "navDentalChart",       icon: "smile",         requiredModule: "dental_chart" },
  { href: "/doctor/vital-signs",      labelKey: "navVitalSigns",        icon: "activity",      requiredModule: "vital_signs" },
];

// Legacy re-exports — labels are keys; resolve with t() at render time
import type { NavItem } from "@/types";

/** @deprecated Use accountantModuleNav + useModuleNav() + t(labelKey) */
export const accountantNav: NavItem[] = accountantModuleNav.map((i) => ({
  href: i.href,
  label: i.labelKey,
  icon: i.icon,
  roles: i.roles,
}));

/** @deprecated Use superAdminModuleNav + useModuleNav() + t(labelKey) */
export const superAdminNav: NavItem[] = superAdminModuleNav.map((i) => ({
  href: i.href,
  label: i.labelKey,
  icon: i.icon,
  roles: i.roles,
}));

export type { TranslationKey };
