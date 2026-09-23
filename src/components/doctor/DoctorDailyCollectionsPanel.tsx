"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { Input } from "@/components/ui/Input";
import { Alert } from "@/components/ui/Alert";
import { authPortalHeaders } from "@/lib/auth/api-portal";
import { createClient } from "@/lib/supabase/client";
import { getDoctorForCurrentUser } from "@/lib/clinic-context";
import { useClinicSync } from "@/hooks/useClinicSync";
import { DailyCollectionsCacheBanner } from "@/components/ledger/DailyCollectionsCacheBanner";
import {
  fetchDailyCollectionsCached,
  readDailyCollectionsCacheEntry,
  readLatestDailyCollectionsCacheEntry,
} from "@/lib/ledger/daily-collections-cache";
import {
  collectionStatusClass,
  collectionStatusLabel,
  filterDailyCollectionsResult,
  type CollectionStatusFilter,
  type DailyCollectionsResult,
  type DailyCollectionRow,
} from "@/lib/ledger/daily-collections";
import type { DailyAssistantPayrollLine } from "@/lib/ledger/daily-assistant-payroll";
import type { DoctorWithdrawalLine } from "@/lib/withdrawals/display";
import { withdrawalStatusLabel } from "@/lib/withdrawals/display";
import type { DoctorBalanceTopUpLine } from "@/lib/ledger/daily-doctor-balance-topups";
import {
  DoctorExpenseRow,
  StatementExpenseSection,
} from "@/components/ledger/StatementExpenseRows";
import { OutstandingDebtPanel } from "@/components/accountant/OutstandingDebtPanel";
import { FINANCIAL_EPSILON } from "@/lib/services/patient-financial-plan";
import { useLanguage } from "@/contexts/LanguageContext";
import { cn, formatCurrency, formatDate, todayISO, addDaysISO } from "@/lib/utils";
import {
  Calendar,
  CalendarDays,
  RefreshCw,
  Printer,
  ArrowDownToLine,
  ArrowUpToLine,
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

type SummaryTone = "default" | "navy" | "success" | "warning" | "danger" | "gold";

const SUMMARY_TONE_DOT: Record<SummaryTone, string> = {
  default: "bg-slate-muted/40",
  navy: "bg-primary-500",
  success: "bg-success-text",
  warning: "bg-warning-text",
  danger: "bg-debt-text",
  gold: "bg-premium-400",
};

const SUMMARY_TONE_VALUE: Record<SummaryTone, string> = {
  default: "text-slate-text",
  navy: "text-primary-700 dark:text-primary-300",
  success: "text-success-text",
  warning: "text-warning-text",
  danger: "text-debt-text",
  gold: "text-premium-700",
};

function SummaryChip({
  label,
  value,
  tone = "default",
}: {
  label: string;
  value: number | string;
  tone?: SummaryTone;
}) {
  return (
    <div className="rounded-2xl border border-slate-border bg-surface-card px-3.5 py-3 shadow-card">
      <p className="flex items-center gap-1.5 text-[11px] font-medium text-slate-muted">
        <span className={cn("h-1.5 w-1.5 shrink-0 rounded-full", SUMMARY_TONE_DOT[tone])} />
        <span className="truncate">{label}</span>
      </p>
      <p
        className={cn(
          "mt-1.5 text-base font-black leading-tight tracking-tight tabular-nums sm:text-lg",
          SUMMARY_TONE_VALUE[tone]
        )}
      >
        {value}
      </p>
    </div>
  );
}

function AmountCell({
  label,
  value,
  valueClassName,
}: {
  label: string;
  value: string;
  valueClassName?: string;
}) {
  return (
    <div className="min-w-0 rounded-xl bg-surface px-2.5 py-2 text-center">
      <p className="truncate text-[10px] font-medium text-slate-muted">{label}</p>
      <p className={cn("mt-0.5 truncate text-sm font-bold tabular-nums", valueClassName)}>
        {value}
      </p>
    </div>
  );
}

function SectionHead({
  icon: Icon,
  title,
  tone,
}: {
  icon: typeof Calendar;
  title: string;
  tone: "navy" | "warning" | "danger" | "success";
}) {
  return (
    <div className="flex items-center gap-2.5 border-t border-slate-border bg-surface px-4 py-2.5">
      <span
        className={cn(
          "mc-kpi__icon h-7 w-7 rounded-lg",
          {
            navy: "mc-tone-navy",
            warning: "mc-tone-warning",
            danger: "mc-tone-danger",
            success: "mc-tone-success",
          }[tone]
        )}
      >
        <Icon className="h-3.5 w-3.5" />
      </span>
      <p className="text-xs font-bold text-slate-text">{title}</p>
    </div>
  );
}

function DoctorPatientRow({ row }: { row: DailyCollectionRow }) {
  const debtAmount = Math.max(row.caseDebtTotal, row.remaining);

  return (
    <div className="flex flex-col gap-3 border-b border-slate-border px-4 py-4 last:border-b-0">
      <div className="flex items-start gap-3">
        <span className="mc-icon-tile h-10 w-10">
          <UserRound className="h-[18px] w-[18px]" />
        </span>
        <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <p className="font-bold text-slate-text">{row.patientName}</p>
          <span
            className={cn(
              "inline-flex rounded-full px-2 py-0.5 text-[11px] font-semibold",
              collectionStatusClass(row.paymentStatus)
            )}
          >
            {collectionStatusLabel(row.paymentStatus)}
          </span>
        </div>
        {row.paymentStatus === "paid_full" && row.visitPaidToday > 0 && (
          <p className="mt-1 text-xs font-semibold text-success-text">
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
        <p className="mt-1 text-xs text-slate-muted">{row.sessionLabel}</p>
        <div className="mt-0.5 flex flex-wrap items-center gap-x-3 gap-y-0.5">
          {row.visitDate && (
            <p className="text-[11px] text-slate-muted">
              {formatDate(new Date(row.visitDate + "T12:00:00"))}
            </p>
          )}
          {row.patientPhone && (
            <p className="text-[11px] text-slate-muted" dir="ltr">
              {row.patientPhone}
            </p>
          )}
        </div>
        </div>
        {row.patientId && (
          <Link
            href={`/doctor/patients/${row.patientId}`}
            className="mc-btn-soft min-h-[40px] shrink-0 rounded-xl px-3 py-1.5 text-xs"
          >
            الملف
          </Link>
        )}
      </div>

      <div
        className={cn(
          "grid gap-2",
          row.requiredToday > FINANCIAL_EPSILON ? "grid-cols-2 sm:grid-cols-4" : "grid-cols-3"
        )}
      >
        {row.requiredToday > FINANCIAL_EPSILON && (
          <AmountCell
            label="السعر الكلي"
            value={formatCurrency(row.requiredToday)}
            valueClassName="text-slate-text"
          />
        )}
        <AmountCell
          label="ما دفعه المراجع"
          value={formatCurrency(row.visitPaidToday)}
          valueClassName={row.visitPaidToday > 0 ? "text-success-text" : "text-slate-muted"}
        />
        <AmountCell
          label="حصتك"
          value={formatCurrency(row.visitDoctorShare)}
          valueClassName={
            row.visitDoctorShare > 0
              ? "text-primary-700 dark:text-primary-300"
              : "text-slate-muted"
          }
        />
        <AmountCell
          label={row.paymentStatus === "debtor" ? "الدين" : "المتبقي"}
          value={formatCurrency(debtAmount)}
          valueClassName={debtAmount > 0 ? "text-debt-text" : "text-success-text"}
        />
      </div>
    </div>
  );
}

function AssistantPayrollRow({ line }: { line: DailyAssistantPayrollLine }) {
  const isConfirmed = line.statusLabel === "صرف مؤكّد";
  const isCorrection = Boolean(line.isCorrection);

  return (
    <div className="flex items-center gap-3 border-b border-slate-border px-4 py-3.5 last:border-b-0">
      <span
        className={cn(
          "mc-kpi__icon h-10 w-10 rounded-xl",
          isCorrection ? "mc-tone-success" : "mc-tone-warning"
        )}
      >
        <UserRound className="h-4 w-4" />
      </span>
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <p className="truncate text-sm font-bold text-slate-text">
            مساعد: {line.assistantName}
          </p>
          <span
            className={cn(
              "inline-flex rounded-full px-2 py-0.5 text-[10px] font-semibold ring-1 ring-inset",
              isCorrection
                ? "mc-tone-navy"
                : isConfirmed
                  ? "mc-tone-success"
                  : "mc-tone-warning"
            )}
          >
            {isCorrection ? "تصحيح (استرجاع)" : line.statusLabel}
          </span>
        </div>
        <p className="mt-0.5 text-[11px] text-slate-muted">
          نسبتك من الأجر: {line.doctorSharePct}%
          <span className="mx-1.5 text-slate-border">•</span>
          {isCorrection ? "المبلغ المسترجع" : "أجر المساعد"}{" "}
          <span className="font-semibold tabular-nums text-slate-text">
            {formatCurrency(Math.abs(line.totalSalary))}
          </span>
        </p>
      </div>
      <div className="shrink-0 text-end">
        <p className="text-[10px] text-slate-muted">
          {isCorrection ? "يُرجع لك" : "يُخصم منك"}
        </p>
        <p
          className={cn(
            "text-sm font-black tabular-nums",
            isCorrection ? "text-success-text" : "text-debt-text"
          )}
        >
          {isCorrection ? "+" : "−"} {formatCurrency(Math.abs(line.doctorDeduction))}
        </p>
      </div>
    </div>
  );
}

function WithdrawalRow({ line }: { line: DoctorWithdrawalLine }) {
  const isPending = line.status === "pending";
  return (
    <div className="flex items-center gap-3 border-b border-slate-border px-4 py-3.5 last:border-b-0">
      <span
        className={cn(
          "mc-kpi__icon h-10 w-10 rounded-xl",
          isPending ? "mc-tone-warning" : "mc-tone-danger"
        )}
      >
        <ArrowDownToLine className="h-4 w-4" />
      </span>
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <p className="truncate text-sm font-bold text-slate-text">{line.source}</p>
          <span
            className={cn(
              "inline-flex rounded-full px-2 py-0.5 text-[10px] font-semibold ring-1 ring-inset",
              isPending ? "mc-tone-warning" : "mc-tone-danger"
            )}
          >
            {withdrawalStatusLabel(line.status)}
          </span>
        </div>
        <p className="mt-0.5 text-[11px] text-slate-muted">
          {formatDate(line.effectiveDate)}
        </p>
      </div>
      <div className="shrink-0 text-end">
        <p className="text-[10px] text-slate-muted">
          {isPending ? "طلب سحب رصيد" : "سحب رصيد"}
        </p>
        <p
          className={cn(
            "text-sm font-black tabular-nums",
            isPending ? "text-warning-text" : "text-debt-text"
          )}
        >
          − {formatCurrency(line.amount)}
        </p>
      </div>
    </div>
  );
}

function BalanceTopUpRow({ line }: { line: DoctorBalanceTopUpLine }) {
  return (
    <div className="flex items-center gap-3 border-b border-slate-border px-4 py-3.5 last:border-b-0">
      <span className="mc-kpi__icon mc-tone-success h-10 w-10 rounded-xl">
        <ArrowUpToLine className="h-4 w-4" />
      </span>
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-bold text-slate-text">{line.label}</p>
        <p className="mt-0.5 text-[11px] text-slate-muted">
          {formatDate(line.effectiveDate)}
        </p>
      </div>
      <div className="shrink-0 text-end">
        <p className="text-[10px] text-slate-muted">شحن رصيد</p>
        <p className="text-sm font-black tabular-nums text-success-text">
          + {formatCurrency(line.amount)}
        </p>
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
  const [queryFrom, setQueryFrom] = useState(todayISO());
  const [queryTo, setQueryTo] = useState(todayISO());
  const [rawResult, setRawResult] = useState<DailyCollectionsResult | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [offlineView, setOfflineView] = useState(false);
  const [cachedAt, setCachedAt] = useState<number | null>(null);
  const [error, setError] = useState("");
  const [appliedFrom, setAppliedFrom] = useState(todayISO());
  const [appliedTo, setAppliedTo] = useState(todayISO());
  const loadGenerationRef = useRef(0);

  const effectiveTo = dateTo >= dateFrom ? dateTo : dateFrom;
  const queryEffectiveTo = queryTo >= queryFrom ? queryTo : queryFrom;

  const result = useMemo(
    () =>
      rawResult
        ? filterDailyCollectionsResult(rawResult, statusFilter)
        : null,
    [rawResult, statusFilter]
  );

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
    if (!doctorId || !clinicId) {
      setRawResult(null);
      setLoading(false);
      setRefreshing(false);
      return;
    }

    const loadGeneration = ++loadGenerationRef.current;
    const query = {
      portal: "doctor" as const,
      clinicId,
      doctorId,
      dateFrom: queryFrom,
      dateTo: queryEffectiveTo,
    };
    const hasCachedSnapshot = Boolean(
      readDailyCollectionsCacheEntry(query) ||
        readLatestDailyCollectionsCacheEntry({
          portal: query.portal,
          clinicId: query.clinicId,
          doctorId: query.doctorId,
        })
    );

    if (!hasCachedSnapshot) {
      setLoading(true);
    } else {
      setRefreshing(true);
    }
    setError("");
    setOfflineView(false);

    const outcome = await fetchDailyCollectionsCached({
      query,
      apiPath: "/api/doctor/daily-collections",
      headers: authPortalHeaders("doctor"),
      onCacheHit: (result, at) => {
        if (loadGeneration !== loadGenerationRef.current) return;
        setRawResult(result);
        setCachedAt(at);
        setAppliedFrom(queryFrom);
        setAppliedTo(queryEffectiveTo);
        setLoading(false);
      },
    });

    if (loadGeneration !== loadGenerationRef.current) return;

    if (!outcome.result && outcome.source === "none") {
      setError(
        outcome.offline ? t("docDailyOfflineCacheMiss") : t("docDailyLoadFailed")
      );
    } else {
      setError("");
    }

    setRawResult(outcome.result);
    setCachedAt(outcome.cachedAt);
    setOfflineView(outcome.offline && outcome.source === "cache");
    setAppliedFrom(queryFrom);
    setAppliedTo(queryEffectiveTo);
    setLoading(false);
    setRefreshing(false);
  }, [doctorId, clinicId, queryFrom, queryEffectiveTo, t]);

  useEffect(() => {
    if (!doctorId) return;
    void loadCollections();
  }, [loadCollections, doctorId, refreshKey]);

  const refreshCollections = useCallback(() => {
    const to = effectiveTo;
    if (dateFrom === queryFrom && to === queryEffectiveTo) {
      void loadCollections();
      return;
    }
    setQueryFrom(dateFrom);
    setQueryTo(to);
  }, [dateFrom, effectiveTo, queryFrom, queryEffectiveTo, loadCollections]);

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
    setQueryFrom(today);
    setQueryTo(today);
  };

  const setLast7Days = () => {
    const today = todayISO();
    const from = addDaysISO(today, -6);
    setDateFrom(from);
    setDateTo(today);
    setQueryFrom(from);
    setQueryTo(today);
  };

  return (
    <div className="space-y-4">
      <p className="px-1 text-xs leading-relaxed text-slate-muted">{t("docDailyStatementIntro")}</p>

      <section className="mc-panel">
        <div className="space-y-3 p-4">
          <div className="grid grid-cols-2 gap-2.5">
            <Input
              label={t("docFromDate")}
              type="date"
              value={dateFrom}
              onChange={(e) => setDateFrom(e.target.value)}
              dir="ltr"
              className="h-11 rounded-xl text-left"
            />
            <Input
              label={t("docToDate")}
              type="date"
              value={dateTo}
              min={dateFrom}
              onChange={(e) => setDateTo(e.target.value)}
              dir="ltr"
              className="h-11 rounded-xl text-left"
            />
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={setToday}
              className="mc-chip min-h-[40px] text-xs"
            >
              <CalendarDays className="h-3.5 w-3.5" />
              {t("docToday")}
            </button>
            <button
              type="button"
              onClick={setLast7Days}
              className="mc-chip min-h-[40px] text-xs"
            >
              {t("docLast7Days")}
            </button>
            <span className="ms-auto flex items-center gap-2">
              <button
                type="button"
                className="mc-btn-soft min-h-[40px] px-3"
                onClick={() => void refreshCollections()}
                disabled={loading}
              >
                {loading || refreshing ? (
                  <RefreshCw className="h-4 w-4 animate-spin" />
                ) : (
                  <RefreshCw className="h-4 w-4" />
                )}
                {t("refresh")}
              </button>
              <button
                type="button"
                className="mc-btn-soft min-h-[40px] px-3"
                onClick={() => window.print()}
                disabled={!result}
              >
                <Printer className="h-4 w-4" />
                {t("print")}
              </button>
            </span>
          </div>
        </div>

        <div className="-mb-px flex gap-2 overflow-x-auto border-t border-slate-border bg-surface px-4 py-3 [scrollbar-width:none]">
          {STATUS_TABS.map((tab) => (
            <button
              key={tab.id}
              type="button"
              onClick={() => setStatusFilter(tab.id)}
              className={cn(
                "mc-chip min-h-[40px] shrink-0 whitespace-nowrap text-xs",
                statusFilter === tab.id && "mc-chip--active"
              )}
            >
              {statusLabels[tab.labelKey]}
            </button>
          ))}
        </div>
      </section>

      <DailyCollectionsCacheBanner
        refreshing={refreshing}
        offline={offlineView}
        cachedAt={cachedAt}
        refreshingLabel={t("docDailyCacheRefreshing")}
        offlineLabel={t("docDailyCacheOffline")}
      />

      {error && <Alert variant="error">{error}</Alert>}

      {result && mySummary && (
        <section className="space-y-3">
          <div className="flex items-center gap-3 px-1">
            <h3 className="no-accent flex items-center gap-2 text-sm font-bold text-slate-text">
              <Users className="h-4 w-4 text-premium-500" />
              {t("docDailySummary")} {periodLabel}
            </h3>
            <span className="h-px flex-1 bg-gradient-to-l from-transparent to-slate-border" />
          </div>

          <div className="mc-hero grid grid-cols-2 gap-3 rounded-[24px] p-4">
            <div className="relative">
              <p className="text-[11px] font-medium text-white/65">{t("docDailyYourShare")}</p>
              <p className="mc-text-champagne mt-1 text-2xl font-black leading-none tracking-tight tabular-nums">
                {formatCurrency(mySummary.stats.doctorShareToday)}
              </p>
            </div>
            <div className="relative border-s border-white/10 ps-3">
              <p className="text-[11px] font-medium text-white/65">{t("docDailyCollected")}</p>
              <p className="mt-1 text-xl font-bold leading-none tracking-tight tabular-nums text-white">
                {formatCurrency(mySummary.stats.totalCollected)}
              </p>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-3">
            <SummaryChip label={t("docDailySessions")} value={mySummary.stats.totalPatients} tone="navy" />
            <SummaryChip
              label={t("docDailyFilterPaid")}
              value={mySummary.stats.paidFull + mySummary.stats.partial}
              tone="success"
            />
            <SummaryChip
              label={t("docDailyFilterDebtors")}
              value={mySummary.stats.debtors}
              tone="warning"
            />
            {mySummary.stats.assistantDoctorDeduction > 0 && (
              <SummaryChip
                label={t("docDailyAssistantDeduction")}
                value={`− ${formatCurrency(mySummary.stats.assistantDoctorDeduction)}`}
                tone="danger"
              />
            )}
            {mySummary.stats.netDoctorShareToday > 0 && (
              <SummaryChip
                label={t("docDailyNetShare")}
                value={formatCurrency(mySummary.stats.netDoctorShareToday)}
                tone="success"
              />
            )}
            {mySummary.stats.totalWithdrawnInPeriod > 0 && (
              <SummaryChip
                label={t("docDailyWithdrawn")}
                value={`− ${formatCurrency(mySummary.stats.totalWithdrawnInPeriod)}`}
                tone="danger"
              />
            )}
            {mySummary.stats.totalPendingWithdrawalInPeriod > 0 && (
              <SummaryChip
                label={t("docDailyWithdrawalPending")}
                value={`− ${formatCurrency(mySummary.stats.totalPendingWithdrawalInPeriod)}`}
                tone="warning"
              />
            )}
            {mySummary.stats.totalToppedUpInPeriod > 0 && (
              <SummaryChip
                label={t("docDailyToppedUp")}
                value={`+ ${formatCurrency(mySummary.stats.totalToppedUpInPeriod)}`}
                tone="success"
              />
            )}
            {mySummary.stats.totalDoctorExpenseDeduction > 0 && (
              <SummaryChip
                label="خصم فواتير صرفية"
                value={`− ${formatCurrency(mySummary.stats.totalDoctorExpenseDeduction)}`}
                tone="danger"
              />
            )}
            {mySummary.stats.availableBalance != null && (
              <SummaryChip
                label={t("docDailyBalanceRemaining")}
                value={formatCurrency(mySummary.stats.availableBalance)}
                tone="gold"
              />
            )}
            {mySummary.stats.withdrawableLimit != null &&
              mySummary.stats.withdrawableLimit !==
                mySummary.stats.availableBalance && (
                <SummaryChip
                  label={t("docDailyWithdrawable")}
                  value={formatCurrency(mySummary.stats.withdrawableLimit)}
                  tone="navy"
                />
              )}
            <SummaryChip
              label={t("docDailyRemaining")}
              value={formatCurrency(mySummary.stats.totalRemaining)}
              tone="warning"
            />
          </div>
        </section>
      )}

      {loading && !rawResult && (
        <div className="space-y-3">
          {[1, 2, 3].map((i) => (
            <div key={i} className="mc-skeleton h-24 rounded-2xl" />
          ))}
        </div>
      )}

      {result && !mySummary?.rows.length && !mySummary?.assistantPayroll.length && !mySummary?.withdrawals.length && !mySummary?.balanceTopups.length && !mySummary?.doctorExpenses.length && (
        <Alert variant="info">
          {t("docDailyNoData")} {periodLabel}
        </Alert>
      )}

      {mySummary && (mySummary.rows.length > 0 || mySummary.assistantPayroll.length > 0 || mySummary.withdrawals.length > 0 || mySummary.balanceTopups.length > 0 || mySummary.doctorExpenses.length > 0) && (
        <section className="mc-panel">
          <div className="mc-panel-head !px-4">
            <h3 className="mc-panel-title no-accent">
              <Calendar />
              {t("docDailyPatientList")}
            </h3>
          </div>
          <div>
            {mySummary.rows.map((row) => (
              <DoctorPatientRow key={row.id} row={row} />
            ))}
            {mySummary.doctorExpenses.length > 0 && (
              <StatementExpenseSection
                title="فواتير صرفيتك (خصم حسب نسبتك)"
                tone="violet"
              >
                {mySummary.doctorExpenses.map((line) => (
                  <DoctorExpenseRow key={line.id} line={line} forDoctor />
                ))}
              </StatementExpenseSection>
            )}
            {mySummary.assistantPayroll.length > 0 && (
              <div>
                <SectionHead
                  icon={UserRound}
                  title={t("docDailyAssistantPayroll")}
                  tone="warning"
                />
                {mySummary.assistantPayroll.map((line) => (
                  <AssistantPayrollRow key={line.id} line={line} />
                ))}
              </div>
            )}
            {mySummary.withdrawals.length > 0 && (
              <div>
                <SectionHead
                  icon={ArrowDownToLine}
                  title={t("docDailyWithdrawals")}
                  tone="danger"
                />
                {mySummary.withdrawals.map((line) => (
                  <WithdrawalRow key={line.id} line={line} />
                ))}
              </div>
            )}
            {mySummary.balanceTopups.length > 0 && (
              <div>
                <SectionHead
                  icon={ArrowUpToLine}
                  title={t("docDailyBalanceTopUps")}
                  tone="success"
                />
                {mySummary.balanceTopups.map((line) => (
                  <BalanceTopUpRow key={line.id} line={line} />
                ))}
              </div>
            )}
          </div>
        </section>
      )}

      {!loading && clinicId && doctorId && (
        <OutstandingDebtPanel clinicId={clinicId} doctorId={doctorId} embedded />
      )}
    </div>
  );
}
