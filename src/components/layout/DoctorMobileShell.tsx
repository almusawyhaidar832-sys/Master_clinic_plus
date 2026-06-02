"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";
import { useClinicProfile } from "@/contexts/ClinicProfileContext";
import { useClinicModules } from "@/contexts/ClinicModulesContext";
import { useModuleNav } from "@/hooks/useModuleNav";
import { useTheme } from "@/contexts/ThemeContext";
import { useLanguage } from "@/contexts/LanguageContext";
import { doctorModuleNav, doctorModuleQuickActions } from "@/config/navigation";
import { createClient } from "@/lib/supabase/client";
import { getAuthProfile, getDoctorForCurrentUser } from "@/lib/clinic-context";
import type { Doctor } from "@/types";
import {
  Wallet, ArrowDownToLine, Users, Calendar,
  CalendarClock, AlertCircle, FileText, Home,
  Smile, FilePen, Activity, Sun, Moon, Languages,
} from "lucide-react";

/** Maps icon string keys → Lucide components for the bottom nav */
const NAV_ICON_MAP: Record<string, React.ComponentType<{ className?: string }>> = {
  home:            Home,
  wallet:          Wallet,
  users:           Users,
  calendarClock:   CalendarClock,
  arrowDownToLine: ArrowDownToLine,
  calendar:        Calendar,
  alertCircle:     AlertCircle,
  fileText:        FileText,
  smile:           Smile,
  filePen:         FilePen,
  activity:        Activity,
};

/** Maps icon string keys for quick actions */
export const QUICK_ACTION_ICON_MAP = NAV_ICON_MAP;

export function DoctorMobileShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const { displayName, profile } = useClinicProfile();
  const { specialtyLabel, loading: modulesLoading } = useClinicModules();
  const { isDark, toggleTheme } = useTheme();
  const { lang, toggleLang } = useLanguage();

  const [doctor, setDoctor]       = useState<Doctor | null>(null);
  const [profileName, setProfileName] = useState<string>("");

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
    "طبيب";

  const doctorSpecialty =
    doctor?.specialty_ar?.trim() ||
    (modulesLoading ? "..." : specialtyLabel);

  const filteredNav = useModuleNav(doctorModuleNav);

  return (
    <div className="flex min-h-screen flex-col bg-surface pb-20">
      <header className="safe-top sticky top-0 z-30 bg-primary px-4 py-3 text-white shadow-premium">
        <div className="flex items-center gap-2">
          {profile?.logo_url && (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={profile.logo_url}
              alt=""
              className="h-8 w-8 rounded-lg border border-white/20 bg-white object-contain p-0.5"
            />
          )}
          <div className="flex-1 min-w-0">
            <p className="truncate text-xs opacity-90">
              {doctorSpecialty} — {displayName}
            </p>
            <h1 className="truncate text-base font-bold">{doctorName}</h1>
          </div>
          {/* Controls */}
          <div className="flex items-center gap-1">
            <button
              onClick={toggleLang}
              className="rounded-lg p-1.5 text-white/80 hover:bg-white/10"
              title={lang === "ar" ? "EN" : "عر"}
            >
              <Languages className="h-4 w-4" />
            </button>
            <button
              onClick={toggleTheme}
              className="rounded-lg p-1.5 text-white/80 hover:bg-white/10"
              title={isDark ? "Light" : "Dark"}
            >
              {isDark ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
            </button>
          </div>
        </div>
      </header>

      <main className="flex-1 px-4 py-4">{children}</main>

      <nav className="safe-bottom fixed bottom-0 left-0 right-0 z-40 border-t border-slate-border bg-surface-card px-2 py-2">
        <div className="flex justify-around">
          {filteredNav.map(({ href, label, icon }) => {
            const active = pathname === href;
            const Icon = NAV_ICON_MAP[icon] ?? Home;
            return (
              <Link
                key={href}
                href={href}
                className={cn(
                  "flex flex-col items-center gap-0.5 rounded-lg px-3 py-1.5 text-[10px] font-medium transition-colors",
                  active ? "text-primary" : "text-slate-muted"
                )}
              >
                <Icon className="h-5 w-5" />
                {label}
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
