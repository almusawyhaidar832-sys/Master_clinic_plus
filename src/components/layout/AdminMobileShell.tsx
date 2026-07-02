"use client";

import Link from "next/link";
import { useEffect } from "react";
import { usePathname, useRouter } from "next/navigation";
import { logoutFromCurrentPortal } from "@/lib/auth/logout-portal";
import { cn } from "@/lib/utils";
import { useClinicProfile } from "@/contexts/ClinicProfileContext";
import { useLanguage } from "@/contexts/LanguageContext";
import { useTheme } from "@/contexts/ThemeContext";
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
  Sun,
  Moon,
  Languages,
  Crown,
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
  const { lang, toggleLang, t } = useLanguage();
  const { isDark, toggleTheme } = useTheme();

  useEffect(() => {
    document.title = t("adminOwnerView");
    document.documentElement.classList.add("mcp-admin-portal");
    document.body.classList.add("mcp-admin-portal");
    return () => {
      document.documentElement.classList.remove("mcp-admin-portal");
      document.body.classList.remove("mcp-admin-portal");
    };
  }, [t]);

  return (
    <div className="flex min-h-dvh flex-col bg-surface pb-[calc(4.5rem+env(safe-area-inset-bottom,0px))]">
      <header className="safe-top mc-gradient-hero sticky top-0 z-30 px-4 py-3 text-white shadow-premium">
        <div className="flex items-center gap-2.5">
          {profile?.logo_url ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={profile.logo_url}
              alt=""
              className="h-9 w-9 shrink-0 rounded-xl border border-white/20 bg-white object-contain p-0.5 shadow-sm"
            />
          ) : (
            <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-white/10 ring-1 ring-white/15">
              <Crown className="h-5 w-5 text-premium-300" />
            </div>
          )}
          <div className="min-w-0 flex-1">
            <span className="mc-badge-premium">
              <Crown className="h-3 w-3" />
              {t("adminOwnerView")}
            </span>
            <h1 className="mt-1 truncate text-base font-bold tracking-tight">{displayName}</h1>
          </div>
          <div className="flex items-center gap-0.5">
            <Link
              href="/admin/profile"
              className="touch-target inline-flex items-center justify-center rounded-lg text-white/90 transition-colors hover:bg-white/10 active:scale-95"
              title={t("adminProfileTitle")}
              aria-label={t("adminNavAccount")}
            >
              <UserCog className="h-5 w-5" />
            </Link>
            <Link
              href="/admin/withdrawals"
              className="touch-target relative inline-flex items-center justify-center rounded-lg text-white/90 transition-colors hover:bg-white/10 active:scale-95"
              title={t("adminWithdrawalsTitle")}
              aria-label={t("adminWithdrawalsTitle")}
            >
              <Wallet className="h-5 w-5" />
              {notificationCount > 0 && (
                <span className="absolute -left-0.5 -top-0.5 flex h-4 w-4 items-center justify-center rounded-full bg-white text-[9px] font-bold text-primary shadow-sm ring-2 ring-primary-700/50">
                  {notificationCount > 9 ? "9+" : notificationCount}
                </span>
              )}
            </Link>
            <button
              type="button"
              onClick={() => void logoutFromCurrentPortal(router)}
              className="touch-target inline-flex items-center justify-center rounded-lg text-white/90 transition-colors hover:bg-white/10 active:scale-95"
              title={t("logout")}
              aria-label={t("logout")}
            >
              <LogOut className="h-5 w-5" />
            </button>
            <button
              type="button"
              onClick={toggleLang}
              className="touch-target inline-flex items-center justify-center rounded-lg text-white/80 transition-colors hover:bg-white/10 active:scale-95"
              title={lang === "ar" ? "EN" : "عر"}
              aria-label={t("docChangeLang")}
            >
              <Languages className="h-5 w-5" />
            </button>
            <button
              type="button"
              onClick={toggleTheme}
              className="touch-target inline-flex items-center justify-center rounded-lg text-white/80 transition-colors hover:bg-white/10 active:scale-95"
              title={isDark ? t("themeDayMode") : t("themeNightMode")}
              aria-label={t("docChangeTheme")}
            >
              {isDark ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
            </button>
          </div>
        </div>
      </header>

      <main className="mc-app-main flex-1 px-4 py-4">{children}</main>

      <nav className="safe-bottom fixed bottom-0 left-0 right-0 z-40 border-t border-slate-border/70 bg-surface-card/90 px-1 py-1.5 shadow-[0_-6px_20px_-4px_rgb(15_23_42/0.08)] backdrop-blur-md">
        <div className="flex justify-around">
          {adminNav.map(({ href, labelKey, icon: Icon }) => {
            const active =
              pathname === href ||
              (href !== "/admin" && pathname.startsWith(href));
            return (
              <Link
                key={href}
                href={href}
                className={cn(
                  "touch-target flex min-w-[3.25rem] flex-col items-center justify-center gap-0.5 rounded-xl px-2 py-1.5 text-[9px] font-medium transition-all duration-200 ease-mc-out active:scale-95 sm:text-[10px]",
                  active ? "bg-primary/10 text-primary" : "text-slate-muted hover:text-primary/70"
                )}
              >
                <Icon className={cn("h-5 w-5 transition-transform", active && "scale-110 stroke-[2.5]")} />
                {t(labelKey)}
              </Link>
            );
          })}
        </div>
      </nav>
    </div>
  );
}
