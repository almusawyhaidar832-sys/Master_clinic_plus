"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { logoutFromCurrentPortal } from "@/lib/auth/logout-portal";
import { cn } from "@/lib/utils";
import { useClinicProfile } from "@/contexts/ClinicProfileContext";
import { useLanguage } from "@/contexts/LanguageContext";
import type { TranslationKey } from "@/i18n/translations";
import {
  Home,
  TrendingUp,
  Stethoscope,
  Wallet,
  FileText,
  Users,
  UserCog,
  LogOut,
  Activity,
} from "lucide-react";

const adminNav: Array<{
  href: string;
  labelKey: TranslationKey;
  icon: React.ComponentType<{ className?: string }>;
}> = [
  { href: "/admin",            labelKey: "adminNavHome",     icon: Home        },
  { href: "/admin/activity",   labelKey: "adminNavMonitor",  icon: Activity    },
  { href: "/admin/profits",    labelKey: "adminNavProfits",  icon: TrendingUp  },
  { href: "/admin/doctors",    labelKey: "adminNavDoctors",  icon: Stethoscope },
  { href: "/admin/team",       labelKey: "adminNavTeam",     icon: Users       },
  { href: "/admin/withdrawals",labelKey: "adminNavWithdraw", icon: Wallet      },
  { href: "/admin/report",     labelKey: "adminNavReport",   icon: FileText    },
  { href: "/admin/profile",    labelKey: "adminNavAccount",  icon: UserCog     },
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
  const router = useRouter();
  const { displayName, profile } = useClinicProfile();
  const { t } = useLanguage();

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
              <p className="text-[10px] opacity-80">{t("adminOwnerView")}</p>
              <h1 className="truncate text-base font-bold sm:text-lg">
                {displayName}
              </h1>
            </div>
          </div>
          <div className="flex items-center gap-1">
            <Link
              href="/admin/profile"
              className="touch-target inline-flex items-center justify-center rounded-lg bg-white/10 hover:bg-white/20"
              title={t("adminProfileTitle")}
              aria-label={t("adminNavAccount")}
            >
              <UserCog className="h-5 w-5" />
            </Link>
            <Link
              href="/admin/withdrawals"
              className="touch-target relative inline-flex items-center justify-center rounded-lg bg-white/10 hover:bg-white/20"
              title={t("adminWithdrawalsTitle")}
              aria-label={t("adminWithdrawalsTitle")}
            >
              <Wallet className="h-5 w-5" />
              {notificationCount > 0 && (
                <span className="absolute -left-0.5 -top-0.5 flex h-4 w-4 items-center justify-center rounded-full bg-primary text-[9px] font-bold">
                  {notificationCount > 9 ? "9+" : notificationCount}
                </span>
              )}
            </Link>
            <button
              type="button"
              onClick={() => void logoutFromCurrentPortal(router)}
              className="touch-target inline-flex items-center justify-center rounded-lg bg-white/10 hover:bg-white/20"
              title={t("logout")}
              aria-label={t("logout")}
            >
              <LogOut className="h-5 w-5" />
            </button>
          </div>
        </div>
      </header>

      <main className="mc-app-main mx-auto w-full max-w-lg flex-1 px-4 py-4">{children}</main>

      <nav className="safe-bottom fixed bottom-0 left-0 right-0 z-40 border-t border-slate-border bg-surface-card shadow-[0_-4px_20px_rgba(15,23,42,0.08)]">
        <div className="mx-auto flex max-w-lg justify-around px-1 py-1.5">
          {adminNav.map(({ href, labelKey, icon: Icon }) => {
            const active =
              pathname === href ||
              (href !== "/admin" && pathname.startsWith(href));
            return (
              <Link
                key={href}
                href={href}
                className={cn(
                  "touch-target flex min-w-[3.25rem] flex-col items-center justify-center gap-0.5 rounded-lg px-2 py-2 text-[9px] font-medium sm:text-[10px]",
                  active ? "text-primary" : "text-slate-muted"
                )}
              >
                <Icon className={cn("h-5 w-5", active && "stroke-[2.5]")} />
                {t(labelKey)}
              </Link>
            );
          })}
        </div>
      </nav>
    </div>
  );
}
