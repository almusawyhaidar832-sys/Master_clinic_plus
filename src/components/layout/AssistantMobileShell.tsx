"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import { logoutFromCurrentPortal } from "@/lib/auth/logout-portal";
import { cn } from "@/lib/utils";
import { useClinicProfile } from "@/contexts/ClinicProfileContext";
import { useModuleNav } from "@/hooks/useModuleNav";
import { assistantModuleNav } from "@/config/navigation";
import { useLanguage } from "@/contexts/LanguageContext";
import { createClient } from "@/lib/supabase/client";
import {
  getAssistantForCurrentUser,
  getAuthProfile,
} from "@/lib/clinic-context";
import type { Doctor } from "@/types";
import {
  CalendarClock,
  ListOrdered,
  LogOut,
} from "lucide-react";
import { ClinicDataSyncBridge } from "@/components/sync/ClinicDataSyncBridge";
import { QueueRealtimeBridge } from "@/components/queue/QueueRealtimeBridge";
import { AssistantAlertsSetup } from "@/components/assistant/AssistantAlertsSetup";
import { ensureServiceWorkerRegistration } from "@/lib/pwa/service-worker-ready";

const NAV_ICON_MAP: Record<string, React.ComponentType<{ className?: string }>> = {
  calendarClock: CalendarClock,
  listOrdered: ListOrdered,
};

export function AssistantMobileShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const { displayName } = useClinicProfile();
  const { t, isRTL } = useLanguage();
  const filteredNav = useModuleNav(assistantModuleNav);
  const [doctorName, setDoctorName] = useState("");

  useEffect(() => {
    document.title = t("navAssistantBookings");
    document.documentElement.classList.add("mcp-assistant-portal");
    document.body.classList.add("mcp-assistant-portal");
    void ensureServiceWorkerRegistration();

    const onControllerChange = () => {
      window.location.reload();
    };
    navigator.serviceWorker?.addEventListener(
      "controllerchange",
      onControllerChange
    );

    return () => {
      document.documentElement.classList.remove("mcp-assistant-portal");
      document.body.classList.remove("mcp-assistant-portal");
      navigator.serviceWorker?.removeEventListener(
        "controllerchange",
        onControllerChange
      );
    };
  }, [t]);

  useEffect(() => {
    async function load() {
      const supabase = createClient();
      const [asst, profile] = await Promise.all([
        getAssistantForCurrentUser(supabase),
        getAuthProfile(supabase),
      ]);

      if (asst?.doctor_id) {
        const { data: doctor } = await supabase
          .from("doctors")
          .select("full_name_ar")
          .eq("id", asst.doctor_id)
          .maybeSingle();
        setDoctorName((doctor as Doctor | null)?.full_name_ar ?? "");
      } else {
        setDoctorName(profile?.full_name ?? "");
      }
    }
    load();
  }, []);

  return (
    <div className="flex min-h-screen flex-col bg-slate-50" dir={isRTL ? "rtl" : "ltr"}>
      <ClinicDataSyncBridge portal="assistant" />
      <QueueRealtimeBridge portal="assistant" />
      <header className="safe-top sticky top-0 z-20 border-b border-slate-200 bg-white/95 px-4 py-3 backdrop-blur">
        <div className="mx-auto flex max-w-lg items-center justify-between gap-3">
          <div className="min-w-0">
            <p className="truncate text-sm font-bold text-slate-800">
              {displayName || "عيادتي"}
            </p>
            <p className="truncate text-xs text-slate-500">
              مساعد · {doctorName ? `د. ${doctorName}` : "حجوزات الطبيب"}
            </p>
          </div>
          <button
            type="button"
            onClick={() => logoutFromCurrentPortal(router)}
            className="flex items-center gap-1 rounded-xl border border-slate-200 px-3 py-2 text-xs text-slate-600 hover:bg-slate-50"
          >
            <LogOut className="h-3.5 w-3.5" />
            {t("logout")}
          </button>
        </div>
      </header>

      <main className="mc-app-main mx-auto w-full max-w-lg flex-1 px-4 py-4">
        <div className="mb-4">
          <AssistantAlertsSetup />
        </div>
        {children}
      </main>

      <nav className="safe-bottom sticky bottom-0 border-t border-slate-200 bg-white px-2 py-2">
        <div className="mx-auto flex max-w-lg justify-center gap-2">
          {filteredNav.map((item) => {
            const active = pathname === item.href;
            const Icon = NAV_ICON_MAP[item.icon] ?? CalendarClock;
            return (
              <Link
                key={item.href}
                href={item.href}
                className={cn(
                  "flex flex-1 flex-col items-center gap-1 rounded-xl px-3 py-2 text-xs font-medium transition-colors",
                  active
                    ? "bg-teal-50 text-teal-700"
                    : "text-slate-500 hover:bg-slate-50"
                )}
              >
                <Icon className="h-5 w-5" />
                {t(item.labelKey)}
              </Link>
            );
          })}
        </div>
      </nav>
    </div>
  );
}
