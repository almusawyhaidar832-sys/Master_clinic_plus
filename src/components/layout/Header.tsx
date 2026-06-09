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
  const { lang, toggleLang } = useLanguage();

  return (
    <header className="sticky top-0 z-30 flex h-16 items-center justify-between border-b border-slate-border bg-surface-card/95 px-4 backdrop-blur sm:px-6">
      {/* Left: menu + title */}
      <div className="flex items-center gap-3">
        {onMenuClick && (
          <button
            type="button"
            onClick={onMenuClick}
            className="rounded-lg p-2 text-slate-muted hover:bg-surface lg:hidden"
            aria-label="القائمة"
          >
            <Menu className="h-5 w-5" />
          </button>
        )}
        <div>
          <h1 className="text-lg font-semibold text-slate-text">{title}</h1>
          {subtitle && <p className="text-xs text-slate-muted">{subtitle}</p>}
        </div>
      </div>

      {/* Right: controls */}
      <div className="flex items-center gap-1">

        {showGlobalSync && <GlobalSyncButton clinicId={clinicId} />}

        {/* Language toggle */}
        <button
          type="button"
          onClick={toggleLang}
          title={lang === "ar" ? "Switch to English" : "التبديل للعربية"}
          className="flex items-center gap-1.5 rounded-lg px-2.5 py-2 text-xs font-bold text-slate-muted transition-colors hover:bg-surface hover:text-slate-text"
        >
          <Languages className="h-4 w-4" />
          <span className="hidden sm:inline">{lang === "ar" ? "EN" : "عر"}</span>
        </button>

        {/* Theme toggle */}
        <button
          type="button"
          onClick={toggleTheme}
          title={isDark ? "وضع النهار" : "وضع الليل"}
          className={cn(
            "relative flex h-8 w-14 items-center rounded-full border px-1 transition-all duration-300",
            isDark
              ? "border-slate-600 bg-slate-700"
              : "border-slate-200 bg-slate-100"
          )}
          aria-label="تبديل المظهر"
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
          className="relative rounded-lg p-2 text-slate-muted hover:bg-surface"
          aria-label="الإشعارات"
        >
          <Bell className="h-5 w-5" />
          {notificationCount > 0 && (
            <span className="absolute left-1 top-1 flex h-4 w-4 items-center justify-center rounded-full bg-primary text-[10px] font-bold text-white">
              {notificationCount > 9 ? "9+" : notificationCount}
            </span>
          )}
        </Link>
      </div>
    </header>
  );
}
