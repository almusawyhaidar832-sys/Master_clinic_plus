"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import { logoutFromCurrentPortal } from "@/lib/auth/logout-portal";
import { cn } from "@/lib/utils";
import { useClinicProfile } from "@/contexts/ClinicProfileContext";
import { useClinicModules } from "@/contexts/ClinicModulesContext";
import { useModuleNav } from "@/hooks/useModuleNav";
import { useTheme } from "@/contexts/ThemeContext";
import { useLanguage } from "@/contexts/LanguageContext";
import { doctorModuleNav, doctorModuleQuickActions } from "@/config/navigation";
import { ClinicDataSyncBridge } from "@/components/sync/ClinicDataSyncBridge";
import { QueueRealtimeBridge } from "@/components/queue/QueueRealtimeBridge";
import { DoctorAlertsSetup } from "@/components/doctor/DoctorAlertsSetup";
import { ensureServiceWorkerRegistration } from "@/lib/pwa/service-worker-ready";
import { createClient } from "@/lib/supabase/client";
import { getAuthProfile, getDoctorForCurrentUser } from "@/lib/clinic-context";
import type { Doctor } from "@/types";
import {
  Wallet, ArrowDownToLine, Users, Calendar,
  CalendarClock, AlertCircle, FileText, Home,
  Smile, FilePen, Activity, Sun, Moon, Languages,
  UserCog, LogOut, ListOrdered, ScrollText,
} from "lucide-react";

const NAV_ICON_MAP: Record<string, React.ComponentType<{ className?: string }>> = {
  home:            Home,
  wallet:          Wallet,
  users:           Users,
  calendarClock:   CalendarClock,
  arrowDownToLine: ArrowDownToLine,
  calendar:        Calendar,
  alertCircle:     AlertCircle,
  fileText:        FileText,
  scrollText:      ScrollText,
  smile:           Smile,
  filePen:         FilePen,
  activity:        Activity,
  userCog:         UserCog,
  listOrdered:     ListOrdered,
};

function doctorInitials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length >= 2) {
    return `${parts[0].charAt(0)}${parts[1].charAt(0)}`;
  }
  return parts[0]?.charAt(0) ?? "?";
}

/** Maps icon string keys for quick actions */
export const QUICK_ACTION_ICON_MAP = NAV_ICON_MAP;

export function DoctorMobileShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const { displayName, profile } = useClinicProfile();
  const { specialtyLabel, loading: modulesLoading } = useClinicModules();
  const { isDark, toggleTheme } = useTheme();
  const { lang, toggleLang, t, bi } = useLanguage();

  const [doctor, setDoctor]       = useState<Doctor | null>(null);
  const [profileName, setProfileName] = useState<string>("");

  useEffect(() => {
    document.title = t("docAppTitle");
    document.documentElement.classList.add("mcp-doctor-portal");
    document.body.classList.add("mcp-doctor-portal");
    void ensureServiceWorkerRegistration();
    return () => {
      document.documentElement.classList.remove("mcp-doctor-portal");
      document.body.classList.remove("mcp-doctor-portal");
    };
  }, [t]);

  useEffect(() => {
    async function loadDoctor() {
      const supabase = createClient();
      const [doc, authProfile] = await Promise.all([
        getDoctorForCurrentUser(supabase),
        getAuthProfile(supabase),
      ]);
      setDoctor(doc);
      setProfileName(authProfile?.full_name ?? "");
    }
    loadDoctor();
  }, []);

  const doctorName =
    doctor?.full_name_ar?.trim() ||
    profileName.trim() ||
    t("docDefaultName");

  const doctorSpecialty =
    doctor?.specialty_ar?.trim() ||
    (modulesLoading ? "..." : specialtyLabel);

  const filteredNav = useModuleNav(doctorModuleNav);

  return (
    <div className="flex min-h-dvh flex-col bg-surface pb-[calc(4.5rem+env(safe-area-inset-bottom,0px))]">
      <ClinicDataSyncBridge />
      <QueueRealtimeBridge portal="doctor" />
      <header className="safe-top mc-gradient-hero sticky top-0 z-30 border-b border-white/10 px-4 py-3 text-white shadow-premium backdrop-blur-sm">
        <div className="flex items-center gap-2.5">
          {profile?.logo_url ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={profile.logo_url}
              alt=""
              className="h-10 w-10 rounded-xl border border-white/20 bg-surface-card object-contain p-0.5 shadow-sm"
            />
          ) : (
            <div
              className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-white/15 text-sm font-bold text-white ring-2 ring-white/20 shadow-glass"
              aria-hidden
            >
              {doctorInitials(doctorName)}
            </div>
          )}
          <div className="min-w-0 flex-1">
            <p className="truncate text-xs text-white/75">
              {doctorSpecialty} — {displayName}
            </p>
            <h1 className="truncate text-base font-bold tracking-tight">{doctorName}</h1>
          </div>
          {/* Controls */}
          <div className="flex items-center gap-0.5">
            <Link
              href="/doctor/profile"
              className="touch-target inline-flex items-center justify-center rounded-lg text-white/90 transition-colors hover:bg-white/10 active:scale-95"
              title={t("docProfileTitle")}
              aria-label={t("navMyAccount")}
            >
              <UserCog className="h-5 w-5" />
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
              onClick={toggleLang}
              className="touch-target inline-flex items-center justify-center rounded-lg text-white/80 transition-colors hover:bg-white/10 active:scale-95"
              title={lang === "ar" ? "EN" : "عر"}
              aria-label={t("docChangeLang")}
            >
              <Languages className="h-5 w-5" />
            </button>
            <button
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

      <main className="mc-app-main flex-1 px-4 py-4">
        <div className="mb-3">
          <DoctorAlertsSetup />
        </div>
        {children}
      </main>

      <nav className="safe-bottom fixed bottom-0 left-0 right-0 z-40 border-t border-slate-border/70 bg-surface-card/90 px-2 py-1.5 shadow-[0_-6px_20px_-4px_rgb(15_23_42/0.08)] backdrop-blur-md">
        <div className="flex justify-around">
          {filteredNav.map(({ href, labelKey, icon }) => {
            const active = pathname === href;
            const Icon = NAV_ICON_MAP[icon] ?? Home;
            return (
              <Link
                key={href}
                href={href}
                className={cn(
                  "touch-target flex min-w-[3.25rem] flex-col items-center justify-center gap-0.5 rounded-2xl px-2.5 py-1.5 text-[10px] font-medium transition-all duration-200 ease-mc-out mc-press",
                  active
                    ? "bg-white text-primary shadow-soft ring-1 ring-primary/10"
                    : "text-slate-muted hover:bg-primary/[0.06] hover:text-primary"
                )}
              >
                <Icon className={cn("h-5 w-5 transition-transform", active && "scale-110")} />
                {t(labelKey)}
              </Link>
            );
          })}
        </div>
      </nav>
    </div>
  );
}

/**
 * Dynamic quick actions for the doctor home screen.
 * Filtered by enabled modules via useModuleNav() at the call site.
 * @example
 *   const actions = useModuleNav(doctorModuleQuickActions);
 */
export { doctorModuleQuickActions as doctorQuickActions };

// Legacy static export kept for backward compatibility with existing pages
export const doctorQuickActionsStatic = [
  { href: "/doctor/wallet",     label: "المحفظة",            icon: Wallet,          desc: "الرصيد القابل للسحب"  },
  { href: "/doctor/withdraw",   label: "طلب سحب",            icon: ArrowDownToLine, desc: "إشعار فوري للمحاسب"   },
  { href: "/doctor/patients",   label: "رعاية المرضى",       icon: Users,           desc: "السجل الطبي والمالي"  },
  { href: "/doctor/filter",     label: "تصفية بالتاريخ",     icon: Calendar,        desc: "يوم أو فترة مخصصة"   },
  { href: "/doctor/schedule",   label: "إدارة المواعيد",     icon: CalendarClock,   desc: "حجز وقفل الساعات"    },
  { href: "/doctor/incomplete", label: "علاجات غير مكتملة",  icon: AlertCircle,     desc: "لا تُنسى أبداً"       },
  { href: "/doctor/statement",  label: "كشف حساب مريض",      icon: FileText,        desc: "طباعة ومشاركة"       },
];
