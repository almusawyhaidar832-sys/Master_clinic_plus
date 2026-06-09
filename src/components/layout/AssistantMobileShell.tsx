"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import { logoutFromCurrentPortal } from "@/lib/auth/logout-portal";
import { cn } from "@/lib/utils";
import { useClinicProfile } from "@/contexts/ClinicProfileContext";
import { assistantModuleNav } from "@/config/navigation";
import { createClient } from "@/lib/supabase/client";
import {
  getAssistantForCurrentUser,
  getAuthProfile,
} from "@/lib/clinic-context";
import type { Assistant, Doctor } from "@/types";
import { CalendarClock, LogOut } from "lucide-react";
import { ClinicDataSyncBridge } from "@/components/sync/ClinicDataSyncBridge";

export function AssistantMobileShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const { displayName } = useClinicProfile();
  const [assistant, setAssistant] = useState<Assistant | null>(null);
  const [doctorName, setDoctorName] = useState("");

  useEffect(() => {
    async function load() {
      const supabase = createClient();
      const [asst, profile] = await Promise.all([
        getAssistantForCurrentUser(supabase),
        getAuthProfile(supabase),
      ]);
      setAssistant(asst);

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
    <div className="flex min-h-screen flex-col bg-slate-50" dir="rtl">
      <ClinicDataSyncBridge />
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
            خروج
          </button>
        </div>
      </header>

      <main className="mx-auto w-full max-w-lg flex-1 px-4 py-4">{children}</main>

      <nav className="safe-bottom sticky bottom-0 border-t border-slate-200 bg-white px-2 py-2">
        <div className="mx-auto flex max-w-lg justify-center gap-2">
          {assistantModuleNav.map((item) => {
            const active = pathname === item.href;
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
                <CalendarClock className="h-5 w-5" />
                {item.label}
              </Link>
            );
          })}
        </div>
      </nav>
    </div>
  );
}
