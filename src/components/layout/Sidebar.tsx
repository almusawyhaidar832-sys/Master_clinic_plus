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
  CalendarClock, UserRound, Activity,
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
};

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
        <Link href="/dashboard" className="flex items-center gap-2">
          {clinicLogoUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={clinicLogoUrl}
              alt=""
              className="h-9 w-9 rounded-lg border border-slate-border object-contain bg-white p-0.5"
            />
          ) : (
            <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-primary text-white font-bold text-sm">
              MC
            </div>
          )}
          <div className="min-w-0">
            <p className="truncate font-semibold text-slate-text leading-tight">
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

      {/* Nav items */}
      <nav className="flex-1 space-y-0.5 overflow-y-auto p-3">
        {items.map((item) => {
          const Icon = iconMap[item.icon] ?? LayoutDashboard;
          const active = pathname === item.href || (item.href !== "/dashboard" && pathname.startsWith(item.href + "/"));
          return (
            <Link
              key={item.href}
              href={item.href}
              onClick={onNavigate}
              className={cn(
                "flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium transition-all",
                active
                  ? "bg-primary text-white shadow-sm ring-1 ring-primary/20"
                  : "text-slate-muted hover:bg-primary/5 hover:text-primary-700"
              )}
            >
              <Icon className="h-4.5 w-4.5 flex-shrink-0" />
              {item.label}
            </Link>
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
