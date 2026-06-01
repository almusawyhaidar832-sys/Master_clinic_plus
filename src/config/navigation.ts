import type { NavItem } from "@/types";

export const accountantNav: NavItem[] = [
  { href: "/dashboard", label: "لوحة التحكم", icon: "dashboard" },
  { href: "/dashboard/ledger", label: "إدخال جلسة", icon: "patients" },
  { href: "/dashboard/patients", label: "ملفات المرضى", icon: "patients" },
  { href: "/dashboard/reports", label: "تقارير العيادة", icon: "profits" },
  { href: "/dashboard/doctors", label: "الأطباء", icon: "doctors" },
  { href: "/dashboard/withdrawals", label: "طلبات السحب", icon: "withdrawals" },
  { href: "/dashboard/expenses", label: "المصروفات", icon: "expenses" },
  { href: "/dashboard/salary", label: "رواتب الموظفين", icon: "salary" },
  { href: "/dashboard/whatsapp", label: "واتساب", icon: "whatsapp" },
  { href: "/dashboard/settings", label: "ملف العيادة", icon: "dashboard" },
];

/** Desktop sidebar for super_admin when using /dashboard routes */
export const superAdminNav: NavItem[] = [
  ...accountantNav,
  { href: "/admin", label: "لوحة المالك (جوال)", icon: "profits", roles: ["super_admin"] },
];
