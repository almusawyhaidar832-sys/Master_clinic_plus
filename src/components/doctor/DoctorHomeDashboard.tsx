"use client";

import { useCallback, useEffect, useRef, useState } from "react";
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
import { Bell, CalendarCheck, TrendingUp, Wallet, ArrowDownToLine, ChevronLeft } from "lucide-react";
import { DoctorPrivateBalance } from "@/components/doctor/DoctorPrivateBalance";
import { useClinicSync } from "@/hooks/useClinicSync";
import { reconcilePendingDoctorWallet } from "@/lib/services/doctor-wallet-pending";

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
  const loadGenerationRef = useRef(0);

  const load = useCallback(async () => {
    const loadGeneration = ++loadGenerationRef.current;
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
      const res = await fetch(
        `/api/doctor/wallet-stats?_t=${Date.now()}`,
        {
          credentials: "include",
          headers: authPortalHeaders("doctor"),
          cache: "no-store",
        }
      );
      if (res.ok) {
        stats = (await res.json()) as DoctorWalletStats;
      }
    } catch {
      /* fallback below */
    }
    if (!stats) {
      stats = await fetchDoctorWalletStats(supabase, doctor.id);
    }

    stats = reconcilePendingDoctorWallet(doctor.id, stats);

    if (loadGeneration !== loadGenerationRef.current) return;

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
    <div className="space-y-6 animate-fade-in">
      {doctorName && (
        <div className="px-1">
          <p className="text-sm text-slate-muted">{t("welcome")} 👋</p>
          <p className="mt-0.5 truncate text-2xl font-bold tracking-tight text-slate-text">
            {doctorName}
          </p>
          {specialty && (
            <p className="mt-1 inline-flex items-center gap-1.5 rounded-full border border-premium-200 bg-premium-50 px-2.5 py-0.5 text-[11px] font-semibold text-premium-700">
              <span className="h-1.5 w-1.5 rounded-full bg-premium-400" />
              {specialty}
            </p>
          )}
        </div>
      )}

      <section className="mc-hero rounded-[28px] p-5 sm:p-6">
        <div className="pointer-events-none absolute -end-14 -top-16 h-52 w-52 rounded-full border border-white/[0.07]" />
        <div className="pointer-events-none absolute -end-2 -top-6 h-32 w-32 rounded-full border border-white/[0.09]" />
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src="/icons/pearl-192.png"
          alt=""
          aria-hidden
          className="pointer-events-none absolute -bottom-6 -start-6 h-32 w-32 rounded-[36px] opacity-[0.08] mix-blend-screen"
        />

        <div className="relative flex items-start justify-between gap-3">
          <div className="min-w-0 flex-1">
            <p className="flex items-center gap-1.5 text-xs font-medium text-white/65">
              <Wallet className="h-3.5 w-3.5 text-[#dcc29a]" />
              {t("currentBalance")}
            </p>
            <DoctorPrivateBalance
              amount={wallet?.availableBalance ?? null}
              className="mc-text-champagne mt-2 text-[34px] font-black leading-none tracking-tight"
              isDebtor={(wallet?.availableBalance ?? 0) < 0}
              showDebtLabel
              iconClassName="text-white/70 hover:text-white"
            />
          </div>
          <span dir="ltr" className="text-[10px] font-semibold tracking-[0.25em] text-white/35">
            PEARL SYSTEM
          </span>
        </div>

        {((wallet?.pendingAmount ?? 0) > 0 || (wallet?.approvedAmount ?? 0) > 0) && (
          <div className="relative mt-5 grid grid-cols-2 gap-2 text-[11px]">
            {(wallet?.pendingAmount ?? 0) > 0 && (
              <div className="rounded-2xl border border-white/10 bg-white/[0.07] px-3 py-2.5 backdrop-blur">
                <p className="text-white/60">{t("pendingShort")}</p>
                <p className="mt-0.5 text-sm font-bold tabular-nums">
                  {formatMoney(wallet?.pendingAmount ?? 0)}
                </p>
              </div>
            )}
            {(wallet?.approvedAmount ?? 0) > 0 && (
              <div className="rounded-2xl border border-white/10 bg-white/[0.07] px-3 py-2.5 backdrop-blur">
                <p className="text-white/60">{t("docApprovedUnpaid")}</p>
                <p className="mt-0.5 text-sm font-bold tabular-nums">
                  {formatMoney(wallet?.approvedAmount ?? 0)}
                </p>
              </div>
            )}
          </div>
        )}

        <div className="relative mt-5 grid grid-cols-2 gap-2.5">
          <Link
            href="/doctor/withdraw"
            className="flex items-center justify-center gap-2 rounded-2xl bg-mc-pearl py-3 text-sm font-bold text-[#0b1f3a] shadow-[0_12px_26px_-10px_rgba(220,194,154,0.75)] transition-transform active:scale-[0.98]"
          >
            <ArrowDownToLine className="h-4 w-4" />
            {t("navWithdrawRequest")}
          </Link>
          <Link
            href="/doctor/wallet"
            className="flex items-center justify-center gap-2 rounded-2xl border border-white/15 bg-white/[0.08] py-3 text-sm font-semibold text-white backdrop-blur transition-colors hover:bg-white/[0.14] active:scale-[0.98]"
          >
            <TrendingUp className="h-4 w-4 text-[#dcc29a]" />
            {t("walletDetails")}
          </Link>
        </div>
      </section>

      <div className="grid grid-cols-2 gap-3">
        <div className="rounded-3xl border border-slate-border bg-surface-card p-4 shadow-card">
          <span className="mc-icon-tile h-10 w-10">
            <CalendarCheck className="h-[18px] w-[18px]" />
          </span>
          <p className="mt-3 text-3xl font-black tabular-nums tracking-tight text-slate-text">{todayOps}</p>
          <p className="text-xs font-medium text-slate-muted">{t("todayOperations")}</p>
        </div>
        <Link
          href="/doctor/notifications"
          className="group relative rounded-3xl border border-slate-border bg-surface-card p-4 shadow-card transition-all hover:border-premium-300/70 hover:shadow-elevated active:scale-[0.98]"
        >
          <span className="relative inline-flex">
            <span className="mc-icon-tile h-10 w-10">
              <Bell className="h-[18px] w-[18px]" />
            </span>
            {notifications > 0 && (
              <span className="absolute -end-1.5 -top-1.5 flex h-5 min-w-5 items-center justify-center rounded-full bg-debt-text px-1 text-[10px] font-bold text-white ring-2 ring-surface-card">
                {notifications > 9 ? "9+" : notifications}
              </span>
            )}
          </span>
          <p className="mt-3 text-3xl font-black tabular-nums tracking-tight text-slate-text">{notifications}</p>
          <p className="text-xs font-medium text-slate-muted">{t("notifications")}</p>
        </Link>
      </div>

      <section>
        <div className="mb-3 flex items-center gap-3 px-1">
          <h2 className="no-accent text-sm font-bold text-slate-text">{t("tasks")}</h2>
          <span className="h-px flex-1 bg-gradient-to-l from-transparent to-slate-border" />
        </div>
        <div className="grid grid-cols-2 gap-3">
          {quickActions.map(({ href, labelKey, icon }) => {
            const Icon = QUICK_ACTION_ICON_MAP[icon] ?? Wallet;
            return (
              <Link
                key={href}
                href={href}
                className="group flex min-h-[112px] flex-col justify-between gap-3 rounded-3xl border border-slate-border bg-surface-card p-4 shadow-card transition-all duration-300 ease-mc-out hover:-translate-y-0.5 hover:border-premium-300/70 hover:shadow-elevated active:scale-[0.98]"
              >
                <span className="flex items-start justify-between">
                  <span className="mc-icon-tile h-11 w-11 transition-transform duration-300 group-hover:scale-105">
                    <Icon className="h-5 w-5" />
                  </span>
                  <ChevronLeft className="h-4 w-4 text-slate-muted/40 transition-all group-hover:-translate-x-0.5 group-hover:text-premium-500 ltr:rotate-180" />
                </span>
                <span className="text-sm font-bold leading-snug text-slate-text">{t(labelKey)}</span>
              </Link>
            );
          })}
        </div>
      </section>
    </div>
  );
}
