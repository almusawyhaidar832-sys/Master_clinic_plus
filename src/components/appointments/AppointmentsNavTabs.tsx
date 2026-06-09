"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";
import { CalendarClock, CalendarRange } from "lucide-react";

const TABS = [
  {
    href: "/dashboard/appointments",
    label: "حجز وإدارة",
    icon: CalendarClock,
    exact: true,
  },
  {
    href: "/dashboard/appointments/schedule",
    label: "جدول المواعيد",
    icon: CalendarRange,
    exact: false,
  },
] as const;

export function AppointmentsNavTabs() {
  const pathname = usePathname();

  return (
    <nav
      className="flex gap-1 rounded-xl border border-slate-border bg-surface p-1"
      aria-label="أقسام الحجوزات"
    >
      {TABS.map(({ href, label, icon: Icon, exact }) => {
        const active = exact
          ? pathname === href
          : pathname === href || pathname.startsWith(`${href}/`);
        return (
          <Link
            key={href}
            href={href}
            className={cn(
              "flex flex-1 items-center justify-center gap-2 rounded-lg px-3 py-2.5 text-sm font-semibold transition-colors",
              active
                ? "bg-primary text-white shadow-sm"
                : "text-slate-muted hover:bg-white hover:text-slate-text"
            )}
          >
            <Icon className="h-4 w-4 shrink-0" />
            {label}
          </Link>
        );
      })}
    </nav>
  );
}
