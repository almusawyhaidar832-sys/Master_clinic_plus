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
      className="mc-tab-group"
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
            className={cn("mc-tab", active && "mc-tab--active")}
          >
            <Icon className="h-4 w-4 shrink-0" />
            {label}
          </Link>
        );
      })}
    </nav>
  );
}
