"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";
import { getDoctorForCurrentUser, getAuthProfile } from "@/lib/clinic-context";
import {
  fetchDoctorWalletStats,
  type DoctorWalletStats,
} from "@/lib/services/doctor-wallet";
import { authPortalHeaders } from "@/lib/auth/api-portal";
import { fetchUnreadNotificationCountViaApi } from "@/lib/notifications/client";
import { todayISO } from "@/lib/utils";
import { doctorQuickActions, QUICK_ACTION_ICON_MAP } from "@/components/layout/DoctorMobileShell";
import { useModuleNav } from "@/hooks/useModuleNav";
import { useLanguage } from "@/contexts/LanguageContext";
import { cn } from "@/lib/utils";
import { Bell, TrendingUp, Wallet, ArrowDownToLine, ChevronLeft } from "lucide-react";
import { DoctorPrivateBalance } from "@/components/doctor/DoctorPrivateBalance";
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
    approvedAmount: number;
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

    const [opsRes, notifCount] = await Promise.all([
      supabase
        .from("patient_operations")
        .select("id", { count: "exact", head: true })
        .eq("doctor_id", doctor.id)
        .eq("operation_date", todayISO()),
      fetchUnreadNotificationCountViaApi("doctor"),
    ]);

    let stats: DoctorWalletStats | null = null;
    try {
      const res = await fetch("/api/doctor/wallet-stats", {
        credentials: "include",
        headers: authPortalHeaders("doctor"),
      });
      if (res.ok) {
        stats = (await res.json()) as DoctorWalletStats;
      }
    } catch {
      /* fallback below */
    }
    if (!stats) {
      stats = await fetchDoctorWalletStats(supabase, doctor.id);
    }

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
        <div className="flex items-center gap-3 rounded-mc-xl border border-slate-border bg-surface-card px-4 py-3.5 shadow-card mc-hover-lift">
          <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-base font-bold text-primary">
            {doctorName.trim().charAt(0)}
          </div>
          <div className="min-w-0">
            <p className="text-xs text-slate-muted">{t("welcome")}</p>
            <p className="truncate text-lg font-bold tracking-tight text-slate-text">{doctorName}</p>
            {specialty && (
              <p className="text-xs font-medium text-primary">{specialty}</p>
            )}
          </div>
        </div>
      )}

      <div className="relative overflow-hidden rounded-mc-2xl bg-mc-navy p-5 text-white shadow-premium ring-1 ring-primary/20">
        <div className="pointer-events-none absolute -end-10 -top-14 h-48 w-48 rounded-full bg-white/5 blur-2xl" />
        <div className="pointer-events-none absolute -start-8 bottom-[-3rem] h-40 w-40 rounded-full bg-premium-400/10 blur-2xl" />
        <div className="relative flex items-start justify-between">
          <div className="min-w-0 flex-1">
            <p className="text-xs text-white/70">{t("currentBalance")}</p>
            <DoctorPrivateBalance
              amount={wallet?.availableBalance ?? null}
              className="mt-1 text-3xl font-extrabold tracking-tight"
              isDebtor={(wallet?.availableBalance ?? 0) < 0}
              showDebtLabel
            />
          </div>
          <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-white/10 ring-1 ring-white/15">
            <Wallet className="h-5 w-5" />
          </div>
        </div>
        <div className="relative mt-4 grid gap-2 text-center text-[10px]">
          {(wallet?.pendingAmount ?? 0) > 0 && (
            <div className="rounded-xl border border-white/10 bg-white/10 p-2 backdrop-blur-sm">
              <p className="text-white/70">{t("pendingShort")}</p>
              <p className="font-bold tabular-nums">
                {formatMoney(wallet?.pendingAmount ?? 0)}
              </p>
            </div>
          )}
          {(wallet?.approvedAmount ?? 0) > 0 && (
            <div className="rounded-xl border border-white/10 bg-white/10 p-2 backdrop-blur-sm">
              <p className="text-white/70">{t("docApprovedUnpaid")}</p>
              <p className="font-bold tabular-nums">
                {formatMoney(wallet?.approvedAmount ?? 0)}
              </p>
            </div>
          )}
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <Link
          href="/doctor/withdraw"
          className="mc-hover-lift flex items-center gap-3 rounded-xl border border-primary/25 bg-primary/[0.06] p-3 active:scale-[0.98]"
        >
          <span className="mc-icon-badge-primary">
            <ArrowDownToLine className="h-5 w-5" />
          </span>
          <span className="text-sm font-semibold text-slate-text">{t("navWithdrawRequest")}</span>
        </Link>
        <Link
          href="/doctor/wallet"
          className="mc-hover-lift flex items-center gap-3 rounded-xl border border-slate-border bg-surface-card p-3 active:scale-[0.98]"
        >
          <span className="mc-icon-badge-soft">
            <TrendingUp className="h-5 w-5" />
          </span>
          <span className="text-sm font-semibold text-slate-text">{t("walletDetails")}</span>
        </Link>
      </div>

      <div className="flex gap-3 text-sm">
        <div className="mc-stat-primary flex-1">
          <p className="mc-stat-value">{todayOps}</p>
          <p className="mc-stat-label">{t("todayOperations")}</p>
        </div>
        <Link
          href="/doctor/notifications"
          className="mc-stat-neutral relative flex flex-1 items-center justify-center gap-2"
        >
          <Bell className="h-5 w-5 text-primary" />
          {notifications > 0 ? (
            <span className="flex h-5 min-w-[1.25rem] items-center justify-center rounded-full bg-debt-text px-1 text-[10px] font-bold text-white">
              {notifications > 9 ? "9+" : notifications}
            </span>
          ) : null}
          <span className="text-xs text-slate-muted">{t("notifications")}</span>
        </Link>
      </div>

      <p className="text-sm font-semibold text-slate-muted">{t("tasks")}</p>
      <div className="grid gap-3">
        {quickActions.map(({ href, labelKey, icon }) => {
          const Icon = QUICK_ACTION_ICON_MAP[icon] ?? Wallet;
          return (
          <Link
            key={href}
            href={href}
            className={cn(
              "mc-hover-lift group flex items-center gap-4 rounded-xl border border-slate-border bg-surface-card p-4 shadow-card active:scale-[0.98]"
            )}
          >
            <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary transition-colors group-hover:bg-primary group-hover:text-white">
              <Icon className="h-6 w-6" />
            </div>
            <div className="min-w-0 flex-1">
              <p className="font-semibold text-slate-text">{t(labelKey)}</p>
            </div>
            <ChevronLeft className="h-4 w-4 shrink-0 text-slate-muted/50 transition-transform group-hover:-translate-x-0.5" />
          </Link>
          );
        })}
      </div>
    </div>
  );
}
