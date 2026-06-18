"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useClinicSync } from "@/hooks/useClinicSync";
import Link from "next/link";
import { cacheDoctorBalance, getCachedDoctorBalance } from "@/lib/offline-cache";
import { createClient } from "@/lib/supabase/client";
import { getDoctorForCurrentUser } from "@/lib/clinic-context";
import { isSalaryDoctor } from "@/lib/services/doctor-payment";
import {
  fetchDoctorWalletStats,
  type DoctorWalletStats,
} from "@/lib/services/doctor-wallet";
import { authPortalHeaders } from "@/lib/auth/api-portal";
import { useLanguage } from "@/contexts/LanguageContext";
import { Button } from "@/components/ui/Button";
import { DoctorPrivateBalance } from "@/components/doctor/DoctorPrivateBalance";
import { ArrowDownToLine, ScrollText, ChevronDown } from "lucide-react";
import { cn } from "@/lib/utils";

export default function DoctorWalletPage() {
  const { t, formatMoney } = useLanguage();
  const [stats, setStats] = useState<DoctorWalletStats | null>(null);
  const [offline, setOffline] = useState(false);
  const [doctorId, setDoctorId] = useState<string | null>(null);
  const [salaryDoctor, setSalaryDoctor] = useState(false);
  const [zeroHint, setZeroHint] = useState(false);
  const [lifetimeOpen, setLifetimeOpen] = useState(false);

  const load = useCallback(async () => {
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

    if (!navigator.onLine) {
      setOffline(true);
      const cached = getCachedDoctorBalance(doctor.id) ?? 0;
      setStats({
        availableBalance: cached,
        totalEarnings: 0,
        totalWithdrawn: 0,
        pendingAmount: 0,
        approvedAmount: 0,
        expenseDeductions: 0,
        payrollDeductions: 0,
        withdrawableLimit: Math.max(0, cached),
        isDebtor: cached < 0,
      });
      return;
    }

    let live: DoctorWalletStats | null = null;
    try {
      const res = await fetch("/api/doctor/wallet-stats", {
        credentials: "include",
        headers: authPortalHeaders("doctor"),
      });
      if (res.ok) {
        live = (await res.json()) as DoctorWalletStats;
      }
    } catch {
      /* fallback below */
    }

    if (!live) {
      live = await fetchDoctorWalletStats(supabase, doctor.id);
    }

    setStats(live);
    setZeroHint(!isSalary && live.totalEarnings <= 0);
    cacheDoctorBalance(live.availableBalance, doctor.id);
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
    <div className="space-y-4">
      {offline && (
        <p className="rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-800">
          {t("docOfflineCached")}
        </p>
      )}
      {!doctorId && stats?.availableBalance === 0 && (
        <p className="rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-800">
          {t("docNotLinkedDoctor")}
        </p>
      )}
      {doctorId && zeroHint && (
        <p className="rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-800 leading-relaxed">
          {t("docZeroBalanceHint")}
        </p>
      )}
      {salaryDoctor && (
        <p className="rounded-lg bg-primary/5 px-3 py-2 text-xs text-slate-text leading-relaxed">
          {t("docSalaryFixedNote")}
        </p>
      )}

      <div
        className={`rounded-2xl p-8 text-white shadow-premium ${
          stats?.isDebtor
            ? "bg-gradient-to-br from-red-600 to-red-800"
            : "bg-gradient-to-br from-primary to-primary-700"
        }`}
      >
        <p className="text-sm opacity-90">
          {salaryDoctor
            ? t("docRemainingSalaryWithdraw")
            : stats?.isDebtor
              ? t("docBalanceDebtLabel")
              : t("docWithdrawableBalanceLabel")}
        </p>
        <DoctorPrivateBalance
          amount={stats?.availableBalance ?? null}
          className="mt-2 text-4xl font-bold"
          isDebtor={stats?.isDebtor === true}
          showDebtLabel
        />
        {!salaryDoctor && stats != null && stats.withdrawableLimit >= 0 && (
          <p className="mt-3 text-xs opacity-90">
            {t("docWithdrawableLabel")}{" "}
            {formatMoney(Math.max(0, stats.withdrawableLimit))}
          </p>
        )}
      </div>

      {hasActiveRequests && activeRows.length > 0 && (
        <div className="space-y-2 rounded-xl border border-amber-200 bg-amber-50/80 p-4">
          <p className="text-sm font-semibold text-amber-900">
            {t("docWalletActiveTitle")}
          </p>
          {activeRows.map(({ label, value, highlight }) => (
            <div key={label} className="flex justify-between text-sm">
              <span className="text-amber-900/80">{label}</span>
              <span
                className={cn(
                  "font-semibold tabular-nums",
                  highlight ? "text-amber-800" : "text-slate-text"
                )}
              >
                {formatMoney(value)}
              </span>
            </div>
          ))}
        </div>
      )}

      {lifetimeRows.length > 0 && (
        <div className="rounded-xl border border-slate-border bg-surface-card overflow-hidden">
          <button
            type="button"
            onClick={() => setLifetimeOpen((o) => !o)}
            className="flex w-full items-center justify-between gap-2 px-4 py-3 text-sm font-medium text-slate-text hover:bg-slate-50"
          >
            <span>{t("docWalletLifetimeSummary")}</span>
            <ChevronDown
              className={cn(
                "h-4 w-4 shrink-0 text-slate-muted transition-transform",
                lifetimeOpen && "rotate-180"
              )}
            />
          </button>
          {lifetimeOpen && (
            <div className="space-y-2 border-t border-slate-border px-4 py-3">
              <p className="text-xs text-slate-muted leading-relaxed">
                {t("docWalletLifetimeHint")}
              </p>
              {lifetimeRows.map(({ label, value }) => (
                <div key={label} className="flex justify-between text-sm">
                  <span className="text-slate-muted">{label}</span>
                  <span className="font-medium tabular-nums text-slate-text">
                    {formatMoney(value)}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      <Link
        href="/doctor/financial-ledger?tab=operations"
        className="flex items-center justify-center gap-2 rounded-xl border border-slate-border bg-surface-card px-4 py-3 text-sm font-medium text-primary hover:bg-slate-50"
      >
        <ScrollText className="h-4 w-4" />
        {t("docWalletViewLedger")}
      </Link>

      {!salaryDoctor && (
        <Link href="/doctor/withdraw">
          <Button className="w-full">
            <ArrowDownToLine className="h-4 w-4" />
            {t("docNewWithdrawBtn")}
          </Button>
        </Link>
      )}

      {!salaryDoctor && (
        <p className="text-xs text-slate-muted text-center leading-relaxed">
          {t("docWithdrawNote")}
        </p>
      )}
    </div>
  );
}
