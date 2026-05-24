"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";
import { useClinicProfile } from "@/contexts/ClinicProfileContext";
import {
  Home,
  TrendingUp,
  Stethoscope,
  Wallet,
  FileText,
} from "lucide-react";

const adminNav = [
  { href: "/admin", label: "الرئيسية", icon: Home },
  { href: "/admin/profits", label: "الأرباح", icon: TrendingUp },
  { href: "/admin/doctors", label: "الأطباء", icon: Stethoscope },
  { href: "/admin/withdrawals", label: "السحب", icon: Wallet },
  { href: "/admin/report", label: "التقرير", icon: FileText },
];

interface AdminMobileShellProps {
  children: React.ReactNode;
  notificationCount?: number;
}

export function AdminMobileShell({
  children,
  notificationCount = 0,
}: AdminMobileShellProps) {
  const pathname = usePathname();
  const { displayName, profile } = useClinicProfile();

  return (
    <div className="flex min-h-screen flex-col bg-surface pb-[4.5rem]">
      <header className="safe-top sticky top-0 z-30 bg-slate-text px-4 py-3 text-white shadow-premium">
        <div className="flex items-center justify-between gap-2">
          <div className="flex min-w-0 items-center gap-2">
            {profile?.logo_url && (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={profile.logo_url}
                alt=""
                className="h-9 w-9 flex-shrink-0 rounded-lg border border-white/20 bg-white object-contain p-0.5"
              />
            )}
            <div className="min-w-0">
              <p className="text-[10px] opacity-80">عرض المالك</p>
              <h1 className="truncate text-base font-bold sm:text-lg">
                {displayName}
              </h1>
            </div>
          </div>
          <Link
            href="/admin/withdrawals"
            className="relative rounded-lg bg-white/10 p-2"
          >
            <Wallet className="h-5 w-5" />
            {notificationCount > 0 && (
              <span className="absolute -left-0.5 -top-0.5 flex h-4 w-4 items-center justify-center rounded-full bg-primary text-[9px] font-bold">
                {notificationCount > 9 ? "9+" : notificationCount}
              </span>
            )}
          </Link>
        </div>
      </header>

      <main className="mx-auto w-full max-w-lg flex-1 px-4 py-4">{children}</main>

      <nav className="safe-bottom fixed bottom-0 left-0 right-0 z-40 border-t border-slate-border bg-surface-card shadow-[0_-4px_20px_rgba(15,23,42,0.08)]">
        <div className="mx-auto flex max-w-lg justify-around px-1 py-1.5">
          {adminNav.map(({ href, label, icon: Icon }) => {
            const active =
              pathname === href ||
              (href !== "/admin" && pathname.startsWith(href));
            return (
              <Link
                key={href}
                href={href}
                className={cn(
                  "flex min-w-[3rem] flex-col items-center gap-0.5 rounded-lg px-2 py-1 text-[9px] font-medium sm:text-[10px]",
                  active ? "text-primary" : "text-slate-muted"
                )}
              >
                <Icon className={cn("h-5 w-5", active && "stroke-[2.5]")} />
                {label}
              </Link>
            );
          })}
        </div>
      </nav>
    </div>
  );
}
