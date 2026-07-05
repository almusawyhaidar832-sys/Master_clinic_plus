"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";
import { DeveloperCredit } from "@/components/layout/DeveloperCredit";
import { DeveloperFooterLink } from "@/components/layout/DeveloperFooterLink";
import type { NavItem } from "@/types";
import {
  LayoutDashboard, Users, Stethoscope, Wallet, Receipt,
  UserCog, MessageCircle, TrendingUp, LogOut, FileText,
  ListOrdered, Package, FilePen, TestTube2, Pill, Globe, Undo2,
  CalendarClock, UserRound, Activity, ScrollText,
  type LucideIcon,
} from "lucide-react";
import { useLanguage } from "@/contexts/LanguageContext";

const iconMap: Record<string, LucideIcon> = {
  dashboard:   LayoutDashboard,
  patients:    Users,
  doctors:     Stethoscope,
  expenses:    Receipt,
  salary:      UserCog,
  whatsapp:    MessageCircle,
  profits:     TrendingUp,
  withdrawals: Wallet,
  report:      FileText,
  listOrdered: ListOrdered,
  package:     Package,
  filePen:     FilePen,
  testTube:    TestTube2,
  pill:        Pill,
  globe:       Globe,
  refunds:     Undo2,
  calendarClock: CalendarClock,
  userRound:     UserRound,
  activity:      Activity,
  scrollText:    ScrollText,
};

type SidebarGroup = "operations" | "finance" | "administration";

const SIDEBAR_GROUP_LABELS: Record<SidebarGroup, string> = {
  operations: "العمليات",
  finance: "المالية",
  administration: "الإدارة",
};

function sidebarGroupForHref(href: string): SidebarGroup {
  if (
    href === "/dashboard" ||
    href.startsWith("/dashboard/ledger") ||
    href.startsWith("/dashboard/queue") ||
    href.startsWith("/dashboard/appointments") ||
    href.startsWith("/dashboard/assistants") ||
    href.startsWith("/dashboard/patients")
  ) {
    return "operations";
  }
  if (
    href.startsWith("/dashboard/doctor-expenses") ||
    href.startsWith("/dashboard/reports") ||
    href.startsWith("/dashboard/refunds") ||
    href.startsWith("/dashboard/withdrawals") ||
    href.startsWith("/dashboard/salary") ||
    href.startsWith("/dashboard/employees")
  ) {
    return "finance";
  }
  return "administration";
}

interface SidebarProps {
  items: NavItem[];
  onSignOut?: () => void;
  clinicName?: string;
  staffName?: string;
  staffLabel?: string;
  clinicLogoUrl?: string | null;
  /** Drawer menu on small screens — must stay visible (desktop sidebar uses hidden lg:flex) */
  mobile?: boolean;
  onNavigate?: () => void;
}

export function Sidebar({
  items,
  onSignOut,
  clinicName,
  staffName,
  staffLabel,
  clinicLogoUrl,
  mobile = false,
  onNavigate,
}: SidebarProps) {
  const pathname = usePathname();
  const { t } = useLanguage();

  return (
    <aside
      className={cn(
        "w-64 flex-shrink-0 flex-col border-l border-slate-border bg-surface-card",
        mobile ? "flex h-full" : "hidden lg:flex"
      )}
    >
      {/* Logo */}
      <div className="border-b border-slate-border px-6 py-5">
        <Link href="/dashboard" className="flex items-center gap-2.5">
          {clinicLogoUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={clinicLogoUrl}
              alt=""
              className="h-10 w-10 rounded-xl border border-slate-border object-contain bg-surface-card p-0.5 shadow-sm"
            />
          ) : (
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-mc-navy text-sm font-bold tracking-tight text-white shadow-elevated ring-1 ring-white/10">
              MC
            </div>
          )}
          <div className="min-w-0">
            <p className="truncate font-bold tracking-tight text-slate-text leading-tight">
              {clinicName || t("appName")}
            </p>
            {staffName ? (
              <p className="truncate text-xs font-medium text-primary">
                {staffLabel ? `${staffLabel}: ` : ""}
                {staffName}
              </p>
            ) : (
              <p className="text-xs text-slate-muted">{t("appTagline")}</p>
            )}
          </div>
        </Link>
      </div>

      {/* Nav items — grouped visually */}
      <nav className="flex-1 space-y-1 overflow-y-auto p-3">
        {items.map((item, index) => {
          const Icon = iconMap[item.icon] ?? LayoutDashboard;
          const active =
            pathname === item.href ||
            (item.href !== "/dashboard" && pathname.startsWith(item.href + "/"));
          const group = sidebarGroupForHref(item.href);
          const prevGroup =
            index > 0 ? sidebarGroupForHref(items[index - 1].href) : null;
          const showGroupLabel = group !== prevGroup;

          return (
            <div key={item.href}>
              {showGroupLabel && (
                <p className="mc-section-divider mb-2 mt-3 px-1 first:mt-0">
                  {SIDEBAR_GROUP_LABELS[group]}
                </p>
              )}
              <Link
                href={item.href}
                onClick={onNavigate}
                className={cn(
                  "group relative flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium transition-all duration-200 ease-mc-out",
                  active
                    ? "bg-mc-navy text-white shadow-elevated"
                    : "text-slate-muted hover:bg-primary/[0.06] hover:text-primary-700"
                )}
              >
                {active && (
                  <span className="absolute inset-y-1.5 start-0 w-1 rounded-full bg-premium-400" />
                )}
                <Icon
                  className={cn(
                    "h-4.5 w-4.5 flex-shrink-0 transition-transform duration-200",
                    !active && "group-hover:scale-110"
                  )}
                />
                {item.label}
              </Link>
            </div>
          );
        })}
      </nav>

      {/* Sign out */}
      <div className="border-t border-slate-border p-3 space-y-2">
        <button
          type="button"
          onClick={onSignOut}
          className="flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium text-slate-muted transition-colors hover:bg-red-50 hover:text-red-600 dark:hover:bg-red-950/40"
        >
          <LogOut className="h-4 w-4" />
          {t("logout")}
        </button>

        <DeveloperCredit variant="sidebar" className="mb-1" />
        <DeveloperFooterLink />
      </div>
    </aside>
  );
}
