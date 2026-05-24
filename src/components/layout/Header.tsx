"use client";

import Link from "next/link";
import { Bell, Menu } from "lucide-react";

interface HeaderProps {
  title: string;
  subtitle?: string;
  onMenuClick?: () => void;
  notificationCount?: number;
}

export function Header({
  title,
  subtitle,
  onMenuClick,
  notificationCount = 0,
}: HeaderProps) {
  return (
    <header className="sticky top-0 z-30 flex h-16 items-center justify-between border-b border-slate-border bg-surface-card/95 px-4 backdrop-blur sm:px-6">
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
          {subtitle && (
            <p className="text-xs text-slate-muted">{subtitle}</p>
          )}
        </div>
      </div>

      <Link
        href="/dashboard/withdrawals"
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
    </header>
  );
}
