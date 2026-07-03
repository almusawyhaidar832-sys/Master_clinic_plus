"use client";

import Link from "next/link";
import { Bell, Menu, Sun, Moon, Languages } from "lucide-react";
import { GlobalSyncButton } from "@/components/sync/GlobalSyncButton";
import { useTheme } from "@/contexts/ThemeContext";
import { useLanguage } from "@/contexts/LanguageContext";
import { cn } from "@/lib/utils";

interface HeaderProps {
  title: string;
  subtitle?: string;
  onMenuClick?: () => void;
  notificationCount?: number;
  /** زر المزامنة العامة — للمدير فقط */
  showGlobalSync?: boolean;
  clinicId?: string | null;
}

export function Header({
  title,
  subtitle,
  onMenuClick,
  notificationCount = 0,
  showGlobalSync = false,
  clinicId,
}: HeaderProps) {
  const { isDark, toggleTheme } = useTheme();
  const { lang, toggleLang, t } = useLanguage();

  return (
    <header className="mc-glass-header sticky top-0 z-30 flex h-16 items-center justify-between px-4 shadow-soft sm:px-6">
      {/* Left: menu + title */}
      <div className="flex items-center gap-3">
        {onMenuClick && (
          <button
            type="button"
            onClick={onMenuClick}
            className="rounded-lg p-2 text-slate-muted transition-colors hover:bg-surface lg:hidden"
            aria-label={t("ariaMenu")}
          >
            <Menu className="h-5 w-5" />
          </button>
        )}
        <div>
          <h1 className="border-s-[3px] border-primary/80 ps-2.5 text-lg font-bold tracking-tightest2 text-slate-text">
            {title}
          </h1>
          {subtitle && (
            <p className="mt-0.5 ps-2.5 text-xs text-slate-muted">{subtitle}</p>
          )}
        </div>
      </div>

      {/* Right: controls */}
      <div className="flex items-center gap-1">

        {showGlobalSync && <GlobalSyncButton clinicId={clinicId} />}

        {/* Language toggle */}
        <button
          type="button"
          onClick={toggleLang}
          title={lang === "ar" ? t("switchToEnglish") : t("switchToArabic")}
          className="flex items-center gap-1.5 rounded-lg px-2.5 py-2 text-xs font-bold text-slate-muted transition-colors hover:bg-surface hover:text-slate-text"
        >
          <Languages className="h-4 w-4" />
          <span className="hidden sm:inline">{lang === "ar" ? "EN" : "عر"}</span>
        </button>

        {/* Theme toggle */}
        <button
          type="button"
          onClick={toggleTheme}
          title={isDark ? t("themeDayMode") : t("themeNightMode")}
          className={cn(
            "relative flex h-8 w-14 items-center rounded-full border px-1 transition-all duration-300",
            isDark
              ? "border-slate-600 bg-slate-700"
              : "border-slate-200 bg-slate-100"
          )}
          aria-label={t("ariaToggleTheme")}
        >
          {/* Track icons */}
          <Sun  className="h-3.5 w-3.5 text-amber-400 opacity-80" />
          <Moon className="mr-auto h-3.5 w-3.5 text-slate-400 opacity-80" />
          {/* Thumb */}
          <span
            className={cn(
              "absolute top-0.5 flex h-6 w-6 items-center justify-center rounded-full shadow transition-all duration-300",
              isDark
                ? "right-0.5 bg-slate-900 text-primary"
                : "left-0.5 bg-white text-amber-500"
            )}
          >
            {isDark
              ? <Moon className="h-3.5 w-3.5" />
              : <Sun  className="h-3.5 w-3.5" />
            }
          </span>
        </button>

        {/* Notifications */}
        <Link
          href="/dashboard/notifications"
          className="relative rounded-lg p-2 text-slate-muted transition-colors hover:bg-surface hover:text-primary"
          aria-label={t("ariaNotifications")}
        >
          <Bell className="h-5 w-5" />
          {notificationCount > 0 && (
            <span className="absolute left-1 top-1 flex h-4 w-4 items-center justify-center rounded-full bg-debt-text text-[10px] font-bold text-white shadow-sm ring-2 ring-surface-card">
              {notificationCount > 9 ? "9+" : notificationCount}
            </span>
          )}
        </Link>
      </div>
    </header>
  );
}
