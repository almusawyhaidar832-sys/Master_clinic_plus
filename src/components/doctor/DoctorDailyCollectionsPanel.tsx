"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { Input } from "@/components/ui/Input";
import { Button } from "@/components/ui/Button";
import { Card, CardHeader, CardTitle } from "@/components/ui/Card";
import { Alert } from "@/components/ui/Alert";
import { authPortalHeaders } from "@/lib/auth/api-portal";
import { createClient } from "@/lib/supabase/client";
import { getDoctorForCurrentUser } from "@/lib/clinic-context";
import { useClinicSync } from "@/hooks/useClinicSync";
import {
  collectionStatusClass,
  collectionStatusLabel,
  type CollectionStatusFilter,
  type DailyCollectionsResult,
  type DailyCollectionRow,
} from "@/lib/ledger/daily-collections";
import type { DailyAssistantPayrollLine } from "@/lib/ledger/daily-assistant-payroll";
import { OutstandingDebtPanel } from "@/components/accountant/OutstandingDebtPanel";
import { FINANCIAL_EPSILON } from "@/lib/services/patient-financial-plan";
import { useLanguage } from "@/contexts/LanguageContext";
import { cn, formatCurrency, formatDate, todayISO, addDaysISO } from "@/lib/utils";
import {
  Calendar,
  RefreshCw,
  UserRound,
  Users,
} from "lucide-react";

const STATUS_TABS: { id: CollectionStatusFilter; labelKey: "all" | "paid" | "debtors" | "unpaid" | "atAccountant" }[] = [
  { id: "all", labelKey: "all" },
  { id: "paid", labelKey: "paid" },
  { id: "debtors", labelKey: "debtors" },
  { id: "unpaid", labelKey: "unpaid" },
  { id: "at_accountant", labelKey: "atAccountant" },
];

function SummaryChip({
  label,
  value,
  className,
}: {
  label: string;
  value: number | string;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "rounded-xl border border-slate-border bg-surface px-3 py-2 text-center",
        className
      )}
    >
      <p className="text-lg font-bold tabular-nums text-slate-text">{value}</p>
      <p className="text-[11px] text-slate-muted">{label}</p>
    </div>
  );
}

function DoctorPatientRow({ row }: { row: DailyCollectionRow }) {
  const debtAmount = Math.max(row.caseDebtTotal, row.remaining);

  return (
    <div className="flex flex-col gap-3 border-b border-slate-border/60 px-4 py-3 last:border-b-0 sm:flex-row sm:items-center sm:justify-between">
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <p className="font-semibold text-slate-text">{row.patientName}</p>
          <span
            className={cn(
              "inline-flex rounded-full px-2 py-0.5 text-[11px] font-medium",
              collectionStatusClass(row.paymentStatus)
            )}
          >
            {collectionStatusLabel(row.paymentStatus)}
          </span>
        </div>
        {row.paymentStatus === "paid_full" && row.visitPaidToday > 0 && (
          <p className="mt-1 text-xs font-semibold text-emerald-700">
            ✓ دفع {formatCurrency(row.visitPaidToday)}
            {row.visitDoctorShare > 0 &&
              ` · حصتك ${formatCurrency(row.visitDoctorShare)}`}
          </p>
        )}
        {(row.paymentStatus === "partial" ||
          (row.paymentStatus === "debtor" && row.visitPaidToday > 0)) &&
          row.visitDoctorShare > 0 && (
            <p className="mt-1 text-xs text-primary tabular-nums">
              حصتك من المدفوع: {formatCurrency(row.visitDoctorShare)}
            </p>
          )}
        {row.paymentStatus === "debtor" && debtAmount > 0 && (
          <p className="mt-1 text-xs font-bold text-debt-text tabular-nums">
            دين مسجّل: {formatCurrency(debtAmount)}
            {row.visitPaidToday > 0 &&
              ` · دفع اليوم: ${formatCurrency(row.visitPaidToday)}`}
          </p>
        )}
        {row.debtCases.length > 0 && (
          <p className="mt-0.5 text-[11px] text-slate-muted">
            {row.debtCases
              .map((c) => `${c.treatmentName}: ${formatCurrency(c.debt)}`)
              .join(" · ")}
          </p>
        )}
        <p className="mt-0.5 text-xs text-slate-muted">{row.sessionLabel}</p>
        {row.visitDate && (
          <p className="mt-0.5 text-[11px] text-slate-muted">
            {formatDate(new Date(row.visitDate + "T12:00:00"))}
          </p>
        )}
        {row.patientPhone && (
          <p className="mt-0.5 text-xs text-slate-muted" dir="ltr">
            {row.patientPhone}
          </p>
        )}
      </div>

      <div className="flex flex-wrap items-center gap-4 sm:justify-end">
        {row.requiredToday > FINANCIAL_EPSILON && (
          <div className="text-right">
            <p className="text-[11px] text-slate-muted">السعر الكلي</p>
            <p className="font-bold tabular-nums text-slate-text">
              {formatCurrency(row.requiredToday)}
            </p>
          </div>
        )}
        <div className="text-right">
          <p className="text-[11px] text-slate-muted">ما دفعه المراجع</p>
          <p
            className={cn(
              "text-lg font-bold tabular-nums",
              row.visitPaidToday > 0 ? "text-success-text" : "text-slate-muted"
            )}
          >
            {formatCurrency(row.visitPaidToday)}
          </p>
        </div>
        <div className="text-right">
          <p className="text-[11px] text-slate-muted">حصتك</p>
          <p
            className={cn(
              "text-lg font-bold tabular-nums",
              row.visitDoctorShare > 0 ? "text-primary" : "text-slate-muted"
            )}
          >
            {formatCurrency(row.visitDoctorShare)}
          </p>
        </div>
        <div className="text-right">
          <p className="text-[11px] text-slate-muted">
            {row.paymentStatus === "debtor" ? "الدين" : "المتبقي"}
          </p>
          <p
            className={cn(
              "font-bold tabular-nums",
              debtAmount > 0 ? "text-debt-text" : "text-success-text"
            )}
          >
            {formatCurrency(debtAmount)}
          </p>
        </div>
        {row.patientId && (
          <Link
            href={`/doctor/patients/${row.patientId}`}
            className="rounded-lg border border-slate-border px-3 py-1.5 text-xs font-medium text-slate-text hover:bg-surface"
          >
            الملف
          </Link>
        )}
      </div>
    </div>
  );
}

function AssistantPayrollRow({ line }: { line: DailyAssistantPayrollLine }) {
  const isConfirmed = line.statusLabel === "صرف مؤكّد";

  return (
    <div className="flex flex-col gap-3 border-b border-slate-border/60 bg-amber-50/30 px-4 py-3 last:border-b-0 sm:flex-row sm:items-center sm:justify-between">
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <UserRound className="h-4 w-4 shrink-0 text-amber-700" />
          <p className="font-semibold text-slate-text">
            مساعد: {line.assistantName}
          </p>
          <span
            className={cn(
              "inline-flex rounded-full px-2 py-0.5 text-[11px] font-medium",
              isConfirmed
                ? "bg-emerald-100 text-emerald-800"
                : "bg-amber-100 text-amber-900"
            )}
          >
            {line.statusLabel}
          </span>
        </div>
        <p className="mt-1 text-xs text-slate-muted">
          نسبتك من الأجر: {line.doctorSharePct}%
        </p>
      </div>

      <div className="flex flex-wrap items-center gap-4 sm:justify-end">
        <div className="text-right">
          <p className="text-[11px] text-slate-muted">أجر المساعد</p>
          <p className="font-bold tabular-nums text-slate-text">
            {formatCurrency(line.totalSalary)}
          </p>
        </div>
        <div className="text-right">
          <p className="text-[11px] text-slate-muted">يُخصم منك</p>
          <p className="font-bold tabular-nums text-red-700">
            − {formatCurrency(line.doctorDeduction)}
          </p>
        </div>
      </div>
    </div>
  );
}

interface DoctorDailyCollectionsPanelProps {
  refreshKey?: number;
}

export function DoctorDailyCollectionsPanel({
  refreshKey = 0,
}: DoctorDailyCollectionsPanelProps) {
  const { t, dateLocale } = useLanguage();
  const [doctorId, setDoctorId] = useState<string | null>(null);
  const [clinicId, setClinicId] = useState<string | null>(null);
  const [dateFrom, setDateFrom] = useState(todayISO());
  const [dateTo, setDateTo] = useState(todayISO());
  const [statusFilter, setStatusFilter] =
    useState<CollectionStatusFilter>("all");
  const [result, setResult] = useState<DailyCollectionsResult | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [appliedFrom, setAppliedFrom] = useState(todayISO());
  const [appliedTo, setAppliedTo] = useState(todayISO());

  const effectiveTo = dateTo >= dateFrom ? dateTo : dateFrom;

  const statusLabels: Record<(typeof STATUS_TABS)[number]["labelKey"], string> = {
    all: t("docDailyFilterAll"),
    paid: t("docDailyFilterPaid"),
    debtors: t("docDailyFilterDebtors"),
    unpaid: t("docDailyFilterUnpaid"),
    atAccountant: t("docDailyFilterAtAccountant"),
  };

  useEffect(() => {
    async function loadDoctor() {
      const supabase = createClient();
      const doctor = await getDoctorForCurrentUser(supabase);
      if (!doctor) {
        setDoctorId(null);
        setClinicId(null);
        return;
      }
      setDoctorId(doctor.id);
      setClinicId(doctor.clinic_id);
    }
    void loadDoctor();
  }, []);

  const loadCollections = useCallback(async () => {
    if (!doctorId) {
      setResult(null);
      setLoading(false);
      return;
    }

    setLoading(true);
    setError("");

    const repairKey =
      clinicId && doctorId
        ? `mc:doctor-shares-auto-repair:v4:${clinicId}:${doctorId}`
        : "";
    const needSync =
      repairKey &&
      typeof window !== "undefined" &&
      !sessionStorage.getItem(repairKey);

    const params = new URLSearchParams({
      date_from: dateFrom,
      date_to: effectiveTo,
      status_filter: statusFilter,
    });
    if (needSync) params.set("sync_shares", "1");

    try {
      const res = await fetch(`/api/doctor/daily-collections?${params}`, {
        credentials: "include",
        headers: authPortalHeaders("doctor"),
      });
      const json = (await res.json()) as {
        result?: DailyCollectionsResult;
        error?: string;
      };

      if (!res.ok) {
        setError(json.error ?? t("docDailyLoadFailed"));
        setResult(null);
        return;
      }

      if (needSync && res.ok && typeof window !== "undefined") {
        sessionStorage.setItem(repairKey, "1");
      }

      setResult(json.result ?? null);
      setAppliedFrom(dateFrom);
      setAppliedTo(effectiveTo);
    } catch {
      setError(t("errServerConnection"));
      setResult(null);
    } finally {
      setLoading(false);
    }
  }, [doctorId, clinicId, dateFrom, effectiveTo, statusFilter, t]);

  useEffect(() => {
    if (!doctorId) return;
    void loadCollections();
  }, [loadCollections, doctorId, refreshKey]);

  useClinicSync({
    topics: ["sessions", "financial"],
    clinicId,
    doctorId,
    onRefresh: loadCollections,
    enabled: !!doctorId,
  });

  const periodLabel = useMemo(() => {
    if (appliedFrom === appliedTo) {
      return formatDate(new Date(appliedFrom + "T12:00:00"), dateLocale);
    }
    return `${formatDate(new Date(appliedFrom + "T12:00:00"), dateLocale)} — ${formatDate(new Date(appliedTo + "T12:00:00"), dateLocale)}`;
  }, [appliedFrom, appliedTo, dateLocale]);

  const mySummary = result?.doctors[0] ?? null;

  const setToday = () => {
    const today = todayISO();
    setDateFrom(today);
    setDateTo(today);
  };

  const setLast7Days = () => {
    const today = todayISO();
    setDateFrom(addDaysISO(today, -6));
    setDateTo(today);
  };

  return (
    <div className="space-y-4">
      <p className="text-sm text-slate-muted">{t("docDailyStatementIntro")}</p>

      <Card>
        <div className="grid gap-4 sm:grid-cols-2">
          <Input
            label={t("docFromDate")}
            type="date"
            value={dateFrom}
            onChange={(e) => setDateFrom(e.target.value)}
            dir="ltr"
            className="text-left"
          />
          <Input
            label={t("docToDate")}
            type="date"
            value={dateTo}
            min={dateFrom}
            onChange={(e) => setDateTo(e.target.value)}
            dir="ltr"
            className="text-left"
          />
        </div>

        <div className="mt-3 flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={setToday}
            className="rounded-full border border-slate-border px-3 py-1 text-xs font-medium text-slate-muted hover:bg-surface"
          >
            {t("docToday")}
          </button>
          <button
            type="button"
            onClick={setLast7Days}
            className="rounded-full border border-slate-border px-3 py-1 text-xs font-medium text-slate-muted hover:bg-surface"
          >
            {t("docLast7Days")}
          </button>
          <Button
            type="button"
            size="sm"
            variant="outline"
            onClick={() => void loadCollections()}
            disabled={loading}
          >
            {loading ? (
              <RefreshCw className="h-4 w-4 animate-spin" />
            ) : (
              <RefreshCw className="h-4 w-4" />
            )}
            {t("refresh")}
          </Button>
        </div>

        <div className="mt-4 flex flex-wrap gap-2">
          {STATUS_TABS.map((tab) => (
            <button
              key={tab.id}
              type="button"
              onClick={() => setStatusFilter(tab.id)}
              className={cn(
                "rounded-full px-4 py-1.5 text-sm font-medium transition-colors",
                statusFilter === tab.id
                  ? "bg-primary text-white"
                  : "bg-surface text-slate-muted hover:bg-surface/80"
              )}
            >
              {statusLabels[tab.labelKey]}
            </button>
          ))}
        </div>
      </Card>

      {error && <Alert variant="error">{error}</Alert>}

      {result && !loading && mySummary && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <Users className="h-4 w-4 text-primary" />
              {t("docDailySummary")} {periodLabel}
            </CardTitle>
          </CardHeader>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
            <SummaryChip label={t("docDailySessions")} value={mySummary.stats.totalPatients} />
            <SummaryChip
              label={t("docDailyFilterPaid")}
              value={mySummary.stats.paidFull + mySummary.stats.partial}
              className="border-emerald-200 bg-emerald-50/50"
            />
            <SummaryChip
              label={t("docDailyFilterDebtors")}
              value={mySummary.stats.debtors}
              className="border-orange-200 bg-orange-50/50"
            />
            <SummaryChip
              label={t("docDailyCollected")}
              value={formatCurrency(mySummary.stats.totalCollected)}
            />
            <SummaryChip
              label={t("docDailyYourShare")}
              value={formatCurrency(mySummary.stats.doctorShareToday)}
              className="border-primary/30 bg-primary/5"
            />
            {mySummary.stats.assistantDoctorDeduction > 0 && (
              <SummaryChip
                label={t("docDailyAssistantDeduction")}
                value={`− ${formatCurrency(mySummary.stats.assistantDoctorDeduction)}`}
                className="border-red-200 bg-red-50/50"
              />
            )}
            {mySummary.stats.netDoctorShareToday > 0 && (
              <SummaryChip
                label={t("docDailyNetShare")}
                value={formatCurrency(mySummary.stats.netDoctorShareToday)}
                className="border-emerald-300 bg-emerald-50/70"
              />
            )}
            <SummaryChip
              label={t("docDailyRemaining")}
              value={formatCurrency(mySummary.stats.totalRemaining)}
              className="border-amber-200 bg-amber-50/50"
            />
          </div>
        </Card>
      )}

      {loading && (
        <div className="space-y-3">
          {[1, 2, 3].map((i) => (
            <div
              key={i}
              className="h-20 animate-pulse rounded-xl bg-surface"
            />
          ))}
        </div>
      )}

      {!loading && result && !mySummary?.rows.length && !mySummary?.assistantPayroll.length && (
        <Alert variant="info">
          {t("docDailyNoData")} {periodLabel}
        </Alert>
      )}

      {!loading && mySummary && (mySummary.rows.length > 0 || mySummary.assistantPayroll.length > 0) && (
        <Card className="overflow-hidden p-0">
          <div className="border-b border-slate-border bg-surface-card px-4 py-3">
            <p className="flex items-center gap-2 text-sm font-bold text-slate-text">
              <Calendar className="h-4 w-4 text-primary" />
              {t("docDailyPatientList")}
            </p>
          </div>
          <div>
            {mySummary.rows.map((row) => (
              <DoctorPatientRow key={row.id} row={row} />
            ))}
            {mySummary.assistantPayroll.length > 0 && (
              <div className="border-t border-amber-200/60">
                <p className="bg-amber-50/60 px-4 py-2 text-xs font-semibold text-amber-900">
                  {t("docDailyAssistantPayroll")}
                </p>
                {mySummary.assistantPayroll.map((line) => (
                  <AssistantPayrollRow key={line.id} line={line} />
                ))}
              </div>
            )}
          </div>
        </Card>
      )}

      {!loading && clinicId && doctorId && (
        <OutstandingDebtPanel clinicId={clinicId} doctorId={doctorId} embedded />
      )}
    </div>
  );
}
