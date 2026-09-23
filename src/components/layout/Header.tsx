"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { Bell, Menu, Sun, Moon, Languages } from "lucide-react";
import { GlobalSyncButton } from "@/components/sync/GlobalSyncButton";
import { useTheme } from "@/contexts/ThemeContext";
import { useLanguage } from "@/contexts/LanguageContext";

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
  const [today, setToday] = useState("");

  useEffect(() => {
    setToday(
      new Intl.DateTimeFormat(lang === "ar" ? "ar-IQ-u-nu-latn" : "en-GB", {
        weekday: "long",
        day: "numeric",
        month: "long",
        year: "numeric",
      }).format(new Date())
    );
  }, [lang]);

  return (
    <header className="mc-glass-header sticky top-0 z-30 flex h-[70px] items-center justify-between gap-3 px-4 sm:px-6 lg:px-8">
      <div className="flex min-w-0 items-center gap-3">
        {onMenuClick && (
          <button
            type="button"
            onClick={onMenuClick}
            className="flex h-10 w-10 items-center justify-center rounded-xl border border-slate-border bg-surface-card text-slate-text shadow-card transition-colors hover:border-premium-300 lg:hidden"
            aria-label={t("ariaMenu")}
          >
            <Menu className="h-5 w-5" />
          </button>
        )}
        <div className="min-w-0">
          <p className="hidden text-[11px] font-medium text-slate-muted sm:block">{today}</p>
          <h1 className="truncate text-lg font-bold tracking-tight text-slate-text sm:text-xl">
            {title}
          </h1>
          {subtitle && (
            <p className="truncate text-xs text-slate-muted">{subtitle}</p>
          )}
        </div>
      </div>

      <div className="flex shrink-0 items-center gap-2">
        {showGlobalSync && <GlobalSyncButton clinicId={clinicId} />}

        <div className="flex items-center gap-0.5 rounded-2xl border border-slate-border bg-surface-card p-1 shadow-card">
          <button
            type="button"
            onClick={toggleLang}
            title={lang === "ar" ? t("switchToEnglish") : t("switchToArabic")}
            className="flex h-9 items-center gap-1.5 rounded-xl px-2.5 text-xs font-bold text-slate-muted transition-colors hover:bg-surface hover:text-slate-text"
          >
            <Languages className="h-4 w-4" />
            <span className="hidden sm:inline">{lang === "ar" ? "EN" : "عر"}</span>
          </button>

          <button
            type="button"
            onClick={toggleTheme}
            title={isDark ? t("themeDayMode") : t("themeNightMode")}
            aria-label={t("ariaToggleTheme")}
            className="flex h-9 w-9 items-center justify-center rounded-xl text-slate-muted transition-colors hover:bg-surface hover:text-slate-text"
          >
            {isDark ? (
              <Sun className="h-4 w-4 text-premium-500" />
            ) : (
              <Moon className="h-4 w-4" />
            )}
          </button>

          <Link
            href="/dashboard/notifications"
            className="relative flex h-9 w-9 items-center justify-center rounded-xl text-slate-muted transition-colors hover:bg-surface hover:text-primary"
            aria-label={t("ariaNotifications")}
          >
            <Bell className="h-[18px] w-[18px]" />
            {notificationCount > 0 && (
              <span className="absolute end-1 top-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-debt-text px-1 text-[9px] font-bold text-white ring-2 ring-surface-card">
                {notificationCount > 9 ? "9+" : notificationCount}
              </span>
            )}
          </Link>
        </div>
      </div>
    </header>
  );
}
