"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useClinicSync } from "@/hooks/useClinicSync";
import Link from "next/link";
import { cacheDoctorBalance } from "@/lib/offline-cache";
import {
  readDoctorWalletCache,
  writeDoctorWalletCache,
} from "@/lib/offline/doctor-wallet-cache";
import { isBrowserOffline } from "@/lib/offline/network";
import { OfflineViewBanner } from "@/components/offline/OfflineViewBanner";
import { createClient } from "@/lib/supabase/client";
import { getDoctorForCurrentUser } from "@/lib/clinic-context";
import { isSalaryDoctor } from "@/lib/services/doctor-payment";
import {
  fetchDoctorWalletStats,
  type DoctorWalletStats,
} from "@/lib/services/doctor-wallet";
import { authPortalHeaders } from "@/lib/auth/api-portal";
import {
  doctorSharesRepairKey,
  markSharesRepairDone,
  needsSharesRepair,
} from "@/lib/finance/doctor-shares-repair-session";
import { useLanguage } from "@/contexts/LanguageContext";
import { PageHeader } from "@/components/ui/PageHeader";
import { DoctorPrivateBalance } from "@/components/doctor/DoctorPrivateBalance";
import {
  ArrowDownToLine,
  ScrollText,
  ChevronDown,
  ChevronLeft,
  Wallet,
  Info,
  Clock,
  Hourglass,
  BarChart3,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { reconcilePendingDoctorWallet } from "@/lib/services/doctor-wallet-pending";

export default function DoctorWalletPage() {
  const { t, bi, formatMoney } = useLanguage();
  const [stats, setStats] = useState<DoctorWalletStats | null>(null);
  const [offlineView, setOfflineView] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [cachedAt, setCachedAt] = useState<number | null>(null);
  const [doctorId, setDoctorId] = useState<string | null>(null);
  const [salaryDoctor, setSalaryDoctor] = useState(false);
  const [zeroHint, setZeroHint] = useState(false);
  const [lifetimeOpen, setLifetimeOpen] = useState(false);
  const loadGenerationRef = useRef(0);

  const load = useCallback(async () => {
    const loadGeneration = ++loadGenerationRef.current;
    const supabase = createClient();
    const doctor = await getDoctorForCurrentUser(supabase);

    if (!doctor) {
      setStats({
        availableBalance: 0,
        totalEarnings: 0,
        totalWithdrawn: 0,
        pendingAmount: 0,
        approvedAmount: 0,
        expenseDeductions: 0,
        payrollDeductions: 0,
        withdrawableLimit: 0,
        isDebtor: false,
      });
      return;
    }

    setDoctorId(doctor.id);
    const isSalary = isSalaryDoctor(doctor);
    setSalaryDoctor(isSalary);

    const cachedWallet = readDoctorWalletCache(doctor.id);
    if (cachedWallet) {
      setStats(cachedWallet.stats);
      setCachedAt(cachedWallet.cachedAt);
      if (isBrowserOffline()) {
        setOfflineView(true);
        setRefreshing(false);
        return;
      }
      setOfflineView(true);
      setRefreshing(true);
    } else if (isBrowserOffline()) {
      setOfflineView(true);
      setRefreshing(false);
      setStats({
        availableBalance: 0,
        totalEarnings: 0,
        totalWithdrawn: 0,
        pendingAmount: 0,
        approvedAmount: 0,
        expenseDeductions: 0,
        payrollDeductions: 0,
        withdrawableLimit: 0,
        isDebtor: false,
      });
      return;
    }

    let live: DoctorWalletStats | null = null;
    const repairKey = doctorSharesRepairKey(doctor.id);
    const needSync = needsSharesRepair(repairKey);
    const walletUrl = needSync
      ? `/api/doctor/wallet-stats?sync_shares=1&_t=${Date.now()}`
      : `/api/doctor/wallet-stats?_t=${Date.now()}`;
    try {
      const res = await fetch(walletUrl, {
        credentials: "include",
        headers: authPortalHeaders("doctor"),
        cache: "no-store",
      });
      if (res.ok) {
        live = (await res.json()) as DoctorWalletStats;
        if (needSync) {
          markSharesRepairDone({
            doctorId: doctor.id,
            clinicId: (doctor as { clinic_id?: string }).clinic_id ?? null,
          });
        }
      }
    } catch {
      /* fallback below */
    }

    if (!live) {
      live = await fetchDoctorWalletStats(supabase, doctor.id);
    }

    live = reconcilePendingDoctorWallet(doctor.id, live);

    if (loadGeneration !== loadGenerationRef.current) return;

    setStats(live);
    setZeroHint(!isSalary && live.totalEarnings <= 0);
    cacheDoctorBalance(live.availableBalance, doctor.id);
    writeDoctorWalletCache(doctor.id, live);
    setOfflineView(false);
    setRefreshing(false);
    setCachedAt(Date.now());
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  useClinicSync({
    topics: ["sessions", "refunds", "financial"],
    doctorId,
    onRefresh: load,
    enabled: !!doctorId,
  });

  const hasActiveRequests =
    !salaryDoctor &&
    ((stats?.pendingAmount ?? 0) > 0 || (stats?.approvedAmount ?? 0) > 0);

  const activeRows = useMemo(
    () =>
      !salaryDoctor
        ? [
            {
              label: t("docPendingRequests"),
              value: stats?.pendingAmount ?? 0,
              highlight: true,
            },
            {
              label: t("docApprovedUnpaid"),
              value: stats?.approvedAmount ?? 0,
              highlight: true,
            },
          ].filter((r) => r.value > 0)
        : [],
    [salaryDoctor, stats?.pendingAmount, stats?.approvedAmount, t]
  );

  const lifetimeRows = useMemo(
    () =>
      [
        {
          label: t("docTotalEarningsLabel"),
          value: stats?.totalEarnings ?? 0,
          show: (stats?.totalEarnings ?? 0) > 0,
        },
        {
          label: t("docDoctorExpenses"),
          value: stats?.expenseDeductions ?? 0,
          show: (stats?.expenseDeductions ?? 0) > 0,
        },
        {
          label: t("docAssistantDeductions").replace(/:$/, ""),
          value: stats?.payrollDeductions ?? 0,
          show: (stats?.payrollDeductions ?? 0) > 0,
        },
        {
          label: salaryDoctor ? t("docSalaryPaidOut") : t("docWithdrawnPaid"),
          value: stats?.totalWithdrawn ?? 0,
          show: (stats?.totalWithdrawn ?? 0) > 0,
        },
      ].filter((r) => r.show),
    [salaryDoctor, stats, t]
  );

  return (
    <div className="space-y-5 animate-fade-in">
      <PageHeader
        title={t("wallet")}
        eyebrow={bi("بوابة الطبيب", "Doctor portal")}
        subtitle={t("walletDetails")}
        icon={Wallet}
        className="!mb-0"
      />

      <OfflineViewBanner
        refreshing={refreshing}
        offline={offlineView}
        cachedAt={cachedAt}
        refreshingLabel={t("offlineViewRefreshing")}
        offlineLabel={t("offlineViewCachedAt")}
      />
      {!doctorId && stats?.availableBalance === 0 && (
        <p className="flex items-start gap-2.5 rounded-2xl border border-warning-border bg-warning px-4 py-3 text-xs leading-relaxed text-warning-text">
          <Info className="mt-0.5 h-4 w-4 shrink-0" />
          {t("docNotLinkedDoctor")}
        </p>
      )}
      {doctorId && zeroHint && (
        <p className="flex items-start gap-2.5 rounded-2xl border border-warning-border bg-warning px-4 py-3 text-xs leading-relaxed text-warning-text">
          <Info className="mt-0.5 h-4 w-4 shrink-0" />
          {t("docZeroBalanceHint")}
        </p>
      )}
      {salaryDoctor && (
        <p className="flex items-start gap-2.5 rounded-2xl border border-slate-border bg-surface-card px-4 py-3 text-xs leading-relaxed text-slate-text shadow-card">
          <Info className="mt-0.5 h-4 w-4 shrink-0 text-premium-500" />
          {t("docSalaryFixedNote")}
        </p>
      )}

      <section
        className={cn(
          "mc-hero rounded-[28px] p-5 sm:p-6",
          stats?.isDebtor && "ring-2 ring-inset ring-red-400/40"
        )}
      >
        <div className="pointer-events-none absolute -end-14 -top-16 h-52 w-52 rounded-full border border-white/[0.07]" />
        <div className="pointer-events-none absolute -end-2 -top-6 h-32 w-32 rounded-full border border-white/[0.09]" />
        {stats?.isDebtor && (
          <div className="pointer-events-none absolute inset-0 bg-gradient-to-br from-red-500/25 via-transparent to-transparent" />
        )}
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
              {salaryDoctor
                ? t("docRemainingSalaryWithdraw")
                : stats?.isDebtor
                  ? t("docBalanceDebtLabel")
                  : t("docWithdrawableBalanceLabel")}
            </p>
            <DoctorPrivateBalance
              amount={stats?.availableBalance ?? null}
              className={cn(
                "mt-2 text-[34px] font-black leading-none tracking-tight sm:text-4xl",
                stats?.isDebtor ? "text-red-200" : "mc-text-champagne"
              )}
              isDebtor={stats?.isDebtor === true}
              showDebtLabel
              iconClassName="text-white/70 hover:text-white"
            />
          </div>
          <span dir="ltr" className="text-[10px] font-semibold tracking-[0.25em] text-white/35">
            PEARL
          </span>
        </div>

        {!salaryDoctor && stats != null && stats.withdrawableLimit >= 0 && (
          <div className="relative mt-5 flex items-center justify-between gap-3 rounded-2xl border border-white/10 bg-white/[0.07] px-4 py-3 backdrop-blur">
            <span className="flex items-center gap-2 text-[11px] text-white/65">
              <ArrowDownToLine className="h-3.5 w-3.5 text-[#dcc29a]" />
              {t("docWithdrawableLabel")}
            </span>
            <span className="text-sm font-bold tabular-nums text-white">
              {formatMoney(Math.max(0, stats.withdrawableLimit))}
            </span>
          </div>
        )}

        {!salaryDoctor && !offlineView && (
          <Link
            href="/doctor/withdraw"
            className="relative mt-4 flex min-h-[48px] items-center justify-center gap-2 rounded-2xl bg-mc-pearl py-3 text-sm font-bold text-[#0b1f3a] shadow-[0_12px_26px_-10px_rgba(220,194,154,0.75)] transition-transform active:scale-[0.98]"
          >
            <ArrowDownToLine className="h-4 w-4" />
            {t("docNewWithdrawBtn")}
          </Link>
        )}
      </section>

      {hasActiveRequests && activeRows.length > 0 && (
        <section className="mc-panel">
          <div className="mc-panel-head !px-4">
            <h2 className="mc-panel-title no-accent">
              <Clock />
              {t("docWalletActiveTitle")}
            </h2>
          </div>
          <div className="divide-y divide-slate-border">
            {activeRows.map(({ label, value, highlight }) => (
              <div key={label} className="flex min-h-[56px] items-center gap-3 px-4 py-3">
                <span className="mc-kpi__icon mc-tone-warning h-9 w-9 rounded-xl">
                  <Hourglass className="h-4 w-4" />
                </span>
                <span className="min-w-0 flex-1 text-sm font-medium text-slate-text">{label}</span>
                <span
                  className={cn(
                    "shrink-0 text-sm font-bold tabular-nums",
                    highlight ? "text-warning-text" : "text-slate-text"
                  )}
                >
                  {formatMoney(value)}
                </span>
              </div>
            ))}
          </div>
        </section>
      )}

      {lifetimeRows.length > 0 && (
        <section className="mc-panel">
          <button
            type="button"
            onClick={() => setLifetimeOpen((o) => !o)}
            className="flex min-h-[56px] w-full items-center justify-between gap-3 px-4 py-3 text-start transition-colors hover:bg-surface"
          >
            <span className="flex items-center gap-3">
              <span className="mc-icon-tile h-9 w-9 rounded-xl">
                <BarChart3 className="h-4 w-4" />
              </span>
              <span className="text-sm font-bold text-slate-text">{t("docWalletLifetimeSummary")}</span>
            </span>
            <ChevronDown
              className={cn(
                "h-4 w-4 shrink-0 text-slate-muted transition-transform",
                lifetimeOpen && "rotate-180"
              )}
            />
          </button>
          {lifetimeOpen && (
            <div className="border-t border-slate-border">
              <p className="bg-surface px-4 py-2.5 text-[11px] leading-relaxed text-slate-muted">
                {t("docWalletLifetimeHint")}
              </p>
              <div className="divide-y divide-slate-border">
                {lifetimeRows.map(({ label, value }) => (
                  <div key={label} className="flex min-h-[48px] items-center justify-between gap-3 px-4 py-2.5 text-sm">
                    <span className="flex items-center gap-2.5 text-slate-muted">
                      <span className="h-1.5 w-1.5 rounded-full bg-premium-400" />
                      {label}
                    </span>
                    <span className="font-bold tabular-nums text-slate-text">
                      {formatMoney(value)}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </section>
      )}

      <Link
        href="/doctor/financial-ledger?tab=operations"
        className="group flex min-h-[60px] items-center gap-3 rounded-2xl border border-slate-border bg-surface-card px-4 py-3 shadow-card transition-all hover:border-premium-300 hover:shadow-elevated active:scale-[0.99]"
      >
        <span className="mc-icon-tile h-10 w-10">
          <ScrollText className="h-[18px] w-[18px]" />
        </span>
        <span className="flex-1 text-sm font-bold text-slate-text">{t("docWalletViewLedger")}</span>
        <ChevronLeft className="h-4 w-4 text-slate-muted/50 transition-all group-hover:-translate-x-0.5 group-hover:text-premium-500 ltr:rotate-180" />
      </Link>

      {!salaryDoctor && (
        <p className="flex items-start gap-2 rounded-2xl bg-surface px-4 py-3 text-xs leading-relaxed text-slate-muted">
          <Info className="mt-0.5 h-3.5 w-3.5 shrink-0 text-premium-500" />
          {t("docWithdrawNote")}
        </p>
      )}
    </div>
  );
}
