"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";
import { DeveloperCredit } from "@/components/layout/DeveloperCredit";
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

function isNavItemActive(
  pathname: string,
  href: string,
  allHrefs: string[]
): boolean {
  if (pathname === href) return true;
  if (href === "/dashboard") return false;
  if (!pathname.startsWith(`${href}/`)) return false;
  const hasMoreSpecific = allHrefs.some(
    (other) =>
      other !== href &&
      other.length > href.length &&
      other.startsWith(`${href}/`) &&
      (pathname === other || pathname.startsWith(`${other}/`))
  );
  return !hasMoreSpecific;
}

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
        "relative w-[17rem] flex-shrink-0 flex-col overflow-hidden text-white",
        mobile ? "flex h-full" : "sticky top-0 hidden h-screen self-start lg:flex"
      )}
      style={{
        background:
          "radial-gradient(420px 260px at 100% 0%, rgba(15,76,111,0.55), transparent 70%), radial-gradient(360px 300px at 0% 100%, rgba(203,169,119,0.14), transparent 70%), linear-gradient(180deg, #0b1f3a 0%, #071429 100%)",
      }}
    >
      <div className="pointer-events-none absolute inset-y-0 start-0 w-px bg-gradient-to-b from-white/0 via-white/10 to-white/0" />

      {/* Brand */}
      <div className="relative px-5 pb-5 pt-6">
        <Link href="/dashboard" className="flex items-center gap-3">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src="/icons/pearl-192.png"
            alt="Pearl System"
            className="h-11 w-11 shrink-0 rounded-[14px] object-cover shadow-[0_10px_24px_-8px_rgba(0,0,0,0.7)] ring-1 ring-white/15"
          />
          <div className="min-w-0">
            <p dir="ltr" className="mc-text-champagne truncate text-lg font-bold leading-tight tracking-wide">
              Pearl System
            </p>
            <p className="truncate text-[11px] text-white/50">{t("appTagline")}</p>
          </div>
        </Link>

        <div className="mt-5 flex items-center gap-3 rounded-2xl border border-white/10 bg-white/[0.05] p-3 backdrop-blur">
          {clinicLogoUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={clinicLogoUrl}
              alt=""
              className="h-9 w-9 shrink-0 rounded-xl bg-white object-contain p-0.5"
            />
          ) : (
            <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-mc-pearl text-sm font-bold text-[#0b1f3a]">
              {(staffName || clinicName || "P").trim().charAt(0)}
            </span>
          )}
          <div className="min-w-0">
            <p className="truncate text-sm font-semibold text-white">
              {clinicName || t("appName")}
            </p>
            {staffName && (
              <p className="truncate text-[11px] text-[#dcc29a]/90">
                {staffLabel ? `${staffLabel}: ` : ""}
                {staffName}
              </p>
            )}
          </div>
        </div>
      </div>

      {/* Nav items — grouped visually */}
      <nav className="relative flex-1 space-y-1 overflow-y-auto px-3 pb-3 [scrollbar-color:rgba(255,255,255,0.15)_transparent] [scrollbar-width:thin]">
        {items.map((item, index) => {
          const Icon = iconMap[item.icon] ?? LayoutDashboard;
          const allHrefs = items.map((i) => i.href);
          const active = isNavItemActive(pathname, item.href, allHrefs);
          const group = sidebarGroupForHref(item.href);
          const prevGroup =
            index > 0 ? sidebarGroupForHref(items[index - 1].href) : null;
          const showGroupLabel = group !== prevGroup;

          return (
            <div key={item.href}>
              {showGroupLabel && (
                <p className="mb-2 mt-5 flex items-center gap-2 px-3 text-[10px] font-bold tracking-[0.12em] text-[#dcc29a]/70 first:mt-1">
                  {SIDEBAR_GROUP_LABELS[group]}
                  <span className="h-px flex-1 bg-gradient-to-l from-transparent to-white/10" />
                </p>
              )}
              <Link
                href={item.href}
                onClick={onNavigate}
                className={cn(
                  "group relative flex items-center gap-3 rounded-xl px-3 py-2.5 text-[13.5px] font-medium transition-all duration-200 ease-mc-out",
                  active
                    ? "bg-mc-pearl font-bold text-[#0b1f3a] shadow-[0_10px_24px_-10px_rgba(220,194,154,0.55)]"
                    : "text-white/65 hover:bg-white/[0.07] hover:text-white"
                )}
              >
                <span
                  className={cn(
                    "flex h-8 w-8 shrink-0 items-center justify-center rounded-lg transition-colors duration-200",
                    active
                      ? "bg-[#0b1f3a] text-[#dcc29a]"
                      : "bg-white/[0.06] text-white/70 group-hover:bg-white/10 group-hover:text-[#dcc29a]"
                  )}
                >
                  <Icon className="h-4 w-4" />
                </span>
                <span className="truncate">{item.label}</span>
              </Link>
            </div>
          );
        })}
      </nav>

      {/* Sign out */}
      <div className="relative space-y-2 border-t border-white/[0.08] p-3">
        <button
          type="button"
          onClick={onSignOut}
          className="group flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-[13.5px] font-medium text-white/60 transition-colors hover:bg-rose-500/10 hover:text-rose-200"
        >
          <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-white/[0.06] group-hover:bg-rose-500/15">
            <LogOut className="h-4 w-4" />
          </span>
          {t("logout")}
        </button>

        <DeveloperCredit className="mb-1" />
      </div>
    </aside>
  );
}
