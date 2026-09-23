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
    <div className="flex min-h-dvh flex-col bg-surface pb-[calc(6rem+env(safe-area-inset-bottom,0px))]">
      <ClinicDataSyncBridge />
      <QueueRealtimeBridge portal="doctor" />
      <header
        className="safe-top sticky top-0 z-30 overflow-hidden text-white shadow-[0_16px_36px_-18px_rgba(11,31,58,0.8)]"
        style={{
          background:
            "radial-gradient(360px 160px at 100% 0%, rgba(255,255,255,0.10), transparent 70%), radial-gradient(300px 180px at 0% 100%, rgba(203,169,119,0.18), transparent 70%), linear-gradient(135deg, #0b1f3a 0%, #0e3558 55%, #0f4c6f 100%)",
        }}
      >
        <div className="pointer-events-none absolute inset-x-8 bottom-0 h-px bg-gradient-to-r from-transparent via-[#dcc29a]/40 to-transparent" />
        <div className="mx-auto flex max-w-3xl items-center gap-3 px-4 py-3.5">
          {profile?.logo_url ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={profile.logo_url}
              alt=""
              className="h-11 w-11 shrink-0 rounded-2xl bg-white object-contain p-0.5 ring-1 ring-white/20"
            />
          ) : (
            <div
              className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-mc-pearl text-sm font-bold text-[#0b1f3a] shadow-[0_8px_20px_-8px_rgba(220,194,154,0.7)]"
              aria-hidden
            >
              {doctorInitials(doctorName)}
            </div>
          )}
          <div className="min-w-0 flex-1">
            <h1 className="truncate text-[15px] font-bold leading-tight tracking-tight">{doctorName}</h1>
            <p className="mt-0.5 truncate text-[11px] text-[#dcc29a]/85">
              {doctorSpecialty} · {displayName}
            </p>
          </div>
          <div className="flex items-center gap-1 rounded-2xl border border-white/10 bg-white/[0.06] p-1 backdrop-blur">
            <button
              onClick={toggleLang}
              className="inline-flex h-9 w-9 items-center justify-center rounded-xl text-white/80 transition-colors hover:bg-white/10 active:scale-95"
              title={lang === "ar" ? "EN" : "عر"}
              aria-label={t("docChangeLang")}
            >
              <Languages className="h-[18px] w-[18px]" />
            </button>
            <button
              onClick={toggleTheme}
              className="inline-flex h-9 w-9 items-center justify-center rounded-xl text-white/80 transition-colors hover:bg-white/10 active:scale-95"
              title={isDark ? t("themeDayMode") : t("themeNightMode")}
              aria-label={t("docChangeTheme")}
            >
              {isDark ? <Sun className="h-4 w-4 text-[#dcc29a]" /> : <Moon className="h-4 w-4" />}
            </button>
            <Link
              href="/doctor/profile"
              className="inline-flex h-9 w-9 items-center justify-center rounded-xl text-white/85 transition-colors hover:bg-white/10 active:scale-95"
              title={t("docProfileTitle")}
              aria-label={t("navMyAccount")}
            >
              <UserCog className="h-[18px] w-[18px]" />
            </Link>
            <button
              type="button"
              onClick={() => void logoutFromCurrentPortal(router)}
              className="inline-flex h-9 w-9 items-center justify-center rounded-xl text-white/70 transition-colors hover:bg-rose-500/20 hover:text-rose-100 active:scale-95"
              title={t("logout")}
              aria-label={t("logout")}
            >
              <LogOut className="h-[18px] w-[18px]" />
            </button>
          </div>
        </div>
      </header>

      <main className="mc-app-main mx-auto w-full max-w-3xl flex-1 px-4 py-5">
        <div className="mb-3">
          <DoctorAlertsSetup />
        </div>
        {children}
      </main>

      <nav className="safe-bottom fixed inset-x-0 bottom-0 z-40 px-3 pb-3">
        <div className="mx-auto flex max-w-xl justify-around rounded-[26px] border border-white/10 p-1.5 shadow-[0_18px_40px_-14px_rgba(11,31,58,0.75)] backdrop-blur-xl [background:linear-gradient(135deg,rgba(11,31,58,0.94),rgba(14,53,88,0.94))]">
          {filteredNav.map(({ href, labelKey, icon }) => {
            const active = pathname === href;
            const Icon = NAV_ICON_MAP[icon] ?? Home;
            return (
              <Link
                key={href}
                href={href}
                className={cn(
                  "touch-target relative flex min-w-[3.5rem] flex-1 flex-col items-center justify-center gap-1 rounded-[20px] px-1.5 py-2 text-[10px] font-semibold transition-all duration-300 ease-mc-out mc-press",
                  active
                    ? "bg-mc-pearl text-[#0b1f3a] shadow-[0_8px_20px_-8px_rgba(220,194,154,0.8)]"
                    : "text-white/60 hover:text-white"
                )}
              >
                <Icon className={cn("h-5 w-5 transition-transform duration-300", active && "-translate-y-px")} />
                <span className="max-w-full truncate">{t(labelKey)}</span>
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
