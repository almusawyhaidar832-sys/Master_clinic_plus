"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";
import { APP_NAME, DEVELOPER } from "@/lib/constants";
import { DeveloperFooterLink } from "@/components/layout/DeveloperFooterLink";
import type { NavItem } from "@/types";
import {
  LayoutDashboard, Users, Stethoscope, Wallet, Receipt,
  UserCog, MessageCircle, TrendingUp, LogOut, FileText,
  ListOrdered, Package, FilePen, TestTube2, Pill, Globe,
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
};

interface SidebarProps {
  items: NavItem[];
  onSignOut?: () => void;
  clinicName?: string;
  staffName?: string;
  staffLabel?: string;
  clinicLogoUrl?: string | null;
}

export function Sidebar({
  items,
  onSignOut,
  clinicName,
  staffName,
  staffLabel,
  clinicLogoUrl,
}: SidebarProps) {
  const pathname = usePathname();
  const { t } = useLanguage();

  return (
    <aside className="hidden w-64 flex-shrink-0 flex-col border-l border-slate-border bg-surface-card lg:flex">
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
              {clinicName || APP_NAME}
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
              className={cn(
                "flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium transition-all",
                active
                  ? "bg-primary text-white shadow-sm"
                  : "text-slate-muted hover:bg-surface hover:text-slate-text"
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

        {/* Developer attribution */}
        <div className="rounded-xl border border-slate-border/60 bg-surface px-3 py-2 text-center">
          <p className="text-[10px] text-slate-muted leading-relaxed">
            تطوير وتصميم
          </p>
          <p className="text-xs font-bold text-primary">
            {DEVELOPER.nameAr}
          </p>
          <p className="text-[9px] text-slate-muted/70 mt-0.5">
            {DEVELOPER.roleAr} · {DEVELOPER.year}
          </p>
          <DeveloperFooterLink />
        </div>
      </div>
    </aside>
  );
}
