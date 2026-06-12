"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";
import { getDoctorForCurrentUser, getAuthProfile } from "@/lib/clinic-context";
import { fetchDoctorWalletStats } from "@/lib/services/doctor-wallet";
import { fetchUnreadNotificationCount } from "@/lib/services/clinic-stats";
import { todayISO } from "@/lib/utils";
import { doctorQuickActions, QUICK_ACTION_ICON_MAP } from "@/components/layout/DoctorMobileShell";
import { useModuleNav } from "@/hooks/useModuleNav";
import { useLanguage } from "@/contexts/LanguageContext";
import { cn } from "@/lib/utils";
import { Bell, TrendingUp, Wallet, ArrowDownToLine } from "lucide-react";
import { useClinicSync } from "@/hooks/useClinicSync";

export function DoctorHomeDashboard() {
  const { t, formatMoney } = useLanguage();
  const quickActions = useModuleNav(doctorQuickActions);
  const [doctorName, setDoctorName] = useState("");
  const [specialty, setSpecialty]   = useState("");
  const [wallet, setWallet] = useState<{
    availableBalance: number;
    totalEarnings: number;
    totalWithdrawn: number;
    pendingAmount: number;
  } | null>(null);
  const [todayOps, setTodayOps] = useState(0);
  const [notifications, setNotifications] = useState(0);
  const [doctorId, setDoctorId] = useState<string | null>(null);
  const [clinicId, setClinicId] = useState<string | null>(null);

  const load = useCallback(async () => {
    const supabase = createClient();
    const doctor = await getDoctorForCurrentUser(supabase);
    if (!doctor) return;

    const profile = await getAuthProfile(supabase);
    setDoctorId(doctor.id);
    setClinicId(profile?.clinic_id ?? null);

    setDoctorName(doctor.full_name_ar);
    setSpecialty(doctor.specialty_ar ?? "");

    const [stats, opsRes, notifCount] = await Promise.all([
      fetchDoctorWalletStats(supabase, doctor.id),
      supabase
        .from("patient_operations")
        .select("id", { count: "exact", head: true })
        .eq("doctor_id", doctor.id)
        .eq("operation_date", todayISO()),
      profile
        ? fetchUnreadNotificationCount(supabase, profile.id)
        : Promise.resolve(0),
    ]);

    setWallet(stats);
    setTodayOps(opsRes.count ?? 0);
    setNotifications(notifCount);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  useClinicSync({
    topics: ["sessions", "refunds", "financial", "notifications"],
    clinicId,
    doctorId,
    onRefresh: load,
    enabled: !!doctorId,
  });

  return (
    <div className="space-y-5 animate-fade-in">
      {doctorName && (
        <div className="rounded-xl border border-slate-100 bg-white px-4 py-3 shadow-sm">
          <p className="text-xs text-slate-500">{t("welcome")}</p>
          <p className="text-lg font-bold text-slate-text">{doctorName}</p>
          {specialty && (
            <p className="text-xs text-primary">{specialty}</p>
          )}
        </div>
      )}

      <div className="rounded-2xl bg-gradient-to-br from-primary to-primary-700 p-5 text-white shadow-premium">
        <div className="flex items-start justify-between">
          <div>
            <p className="text-xs opacity-90">{t("currentBalance")}</p>
            <p className="mt-1 text-3xl font-bold tabular-nums">
              {wallet ? (
                <>
                  {wallet.availableBalance < 0 ? "−" : ""}
                  {formatMoney(Math.abs(wallet.availableBalance))}
                  {wallet.availableBalance < 0 && (
                    <span className="mr-1 text-sm font-bold">{t("debtLabel")}</span>
                  )}
                </>
              ) : (
                "…"
              )}
            </p>
          </div>
          <Wallet className="h-8 w-8 opacity-80" />
        </div>
        <div className="mt-4 grid grid-cols-3 gap-2 text-center text-[10px]">
          <div className="rounded-lg bg-white/10 p-2">
            <p className="opacity-80">{t("earningsShort")}</p>
            <p className="font-semibold">
              {wallet ? formatMoney(wallet.totalEarnings) : "—"}
            </p>
          </div>
          <div className="rounded-lg bg-white/10 p-2">
            <p className="opacity-80">{t("withdrawnShort")}</p>
            <p className="font-semibold">
              {wallet ? formatMoney(wallet.totalWithdrawn) : "—"}
            </p>
          </div>
          <div className="rounded-lg bg-white/10 p-2">
            <p className="opacity-80">{t("pendingShort")}</p>
            <p className="font-semibold">
              {wallet ? formatMoney(wallet.pendingAmount) : "—"}
            </p>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <Link
          href="/doctor/withdraw"
          className="flex items-center gap-3 rounded-xl border border-primary/30 bg-primary/5 p-3 transition active:scale-[0.98]"
        >
          <ArrowDownToLine className="h-5 w-5 text-primary" />
          <span className="text-sm font-semibold text-slate-text">{t("navWithdrawRequest")}</span>
        </Link>
        <Link
          href="/doctor/wallet"
          className="flex items-center gap-3 rounded-xl border border-slate-border bg-surface-card p-3 transition active:scale-[0.98]"
        >
          <TrendingUp className="h-5 w-5 text-primary" />
          <span className="text-sm font-semibold text-slate-text">{t("walletDetails")}</span>
        </Link>
      </div>

      <div className="flex gap-3 text-sm">
        <div className="flex-1 rounded-xl border border-slate-border bg-surface-card p-3 text-center">
          <p className="text-2xl font-bold text-primary">{todayOps}</p>
          <p className="text-xs text-slate-muted">{t("todayOperations")}</p>
        </div>
        <Link
          href="/doctor/notifications"
          className="relative flex flex-1 items-center justify-center gap-2 rounded-xl border border-slate-border bg-surface-card p-3"
        >
          <Bell className="h-5 w-5 text-primary" />
          {notifications > 0 ? (
            <span className="flex h-5 min-w-[1.25rem] items-center justify-center rounded-full bg-primary px-1 text-[10px] font-bold text-white">
              {notifications > 9 ? "9+" : notifications}
            </span>
          ) : null}
          <span className="text-xs text-slate-muted">{t("notifications")}</span>
        </Link>
      </div>

      <p className="text-sm text-slate-muted">{t("tasks")}</p>
      <div className="grid gap-3">
        {quickActions.map(({ href, labelKey, icon }) => {
          const Icon = QUICK_ACTION_ICON_MAP[icon] ?? Wallet;
          return (
          <Link
            key={href}
            href={href}
            className={cn(
              "flex items-center gap-4 rounded-xl border border-slate-border bg-surface-card p-4 shadow-card transition-shadow active:scale-[0.98]"
            )}
          >
            <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-primary/10 text-primary">
              <Icon className="h-6 w-6" />
            </div>
            <div>
              <p className="font-semibold text-slate-text">{t(labelKey)}</p>
            </div>
          </Link>
          );
        })}
      </div>
    </div>
  );
}
