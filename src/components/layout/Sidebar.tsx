"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";
import { APP_NAME } from "@/lib/constants";
import type { NavItem } from "@/types";
import {
  LayoutDashboard,
  Users,
  Stethoscope,
  Wallet,
  Receipt,
  UserCog,
  MessageCircle,
  TrendingUp,
  LogOut,
  FileText,
  type LucideIcon,
} from "lucide-react";

const iconMap: Record<string, LucideIcon> = {
  dashboard: LayoutDashboard,
  patients: Users,
  doctors: Stethoscope,
  expenses: Receipt,
  salary: UserCog,
  whatsapp: MessageCircle,
  profits: TrendingUp,
  withdrawals: Wallet,
  report: FileText,
};

interface SidebarProps {
  items: NavItem[];
  onSignOut?: () => void;
  clinicName?: string;
  clinicLogoUrl?: string | null;
}

export function Sidebar({
  items,
  onSignOut,
  clinicName,
  clinicLogoUrl,
}: SidebarProps) {
  const pathname = usePathname();

  return (
    <aside className="hidden w-64 flex-shrink-0 flex-col border-l border-slate-border bg-surface-card lg:flex">
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
            <p className="text-xs text-slate-muted">إدارة العيادات</p>
          </div>
        </Link>
      </div>

      <nav className="flex-1 space-y-1 p-4">
        {items.map((item) => {
          const Icon = iconMap[item.icon] || LayoutDashboard;
          const active = pathname === item.href || pathname.startsWith(item.href + "/");
          return (
            <Link
              key={item.href}
              href={item.href}
              className={cn(
                "flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition-colors",
                active
                  ? "bg-primary text-white shadow-sm"
                  : "text-slate-muted hover:bg-surface hover:text-slate-text"
              )}
            >
              <Icon className="h-5 w-5 flex-shrink-0" />
              {item.label}
            </Link>
          );
        })}
      </nav>

      <div className="border-t border-slate-border p-4">
        <button
          type="button"
          onClick={onSignOut}
          className="flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium text-slate-muted hover:bg-debt/30 hover:text-debt-text transition-colors"
        >
          <LogOut className="h-5 w-5" />
          تسجيل الخروج
        </button>
      </div>
    </aside>
  );
}
