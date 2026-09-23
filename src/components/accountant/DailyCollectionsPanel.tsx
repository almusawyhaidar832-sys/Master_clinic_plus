"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import Link from "next/link";
import { Input } from "@/components/ui/Input";
import { Select } from "@/components/ui/Select";
import { Alert } from "@/components/ui/Alert";
import { PageHeader } from "@/components/ui/PageHeader";
import { useLanguage } from "@/contexts/LanguageContext";
import { authPortalHeaders } from "@/lib/auth/api-portal";
import { createClient } from "@/lib/supabase/client";
import { useActiveClinicId } from "@/hooks/useActiveClinicId";
import { useClinicSync } from "@/hooks/useClinicSync";
import { buildLedgerPayUrl } from "@/lib/ledger/navigation";
import {
  collectionStatusClass,
  collectionStatusLabel,
  filterDailyCollectionsResult,
  type CollectionStatusFilter,
  type DailyCollectionsResult,
  type DailyCollectionRow,
  type DoctorDailySummary,
} from "@/lib/ledger/daily-collections";
import type { DailyAssistantPayrollLine } from "@/lib/ledger/daily-assistant-payroll";
import type { DoctorWithdrawalLine } from "@/lib/withdrawals/display";
import { withdrawalStatusLabel } from "@/lib/withdrawals/display";
import type { ClinicBalanceTopUpLine } from "@/lib/services/balance-topup";
import type { DoctorBalanceTopUpLine } from "@/lib/ledger/daily-doctor-balance-topups";
import type { DailyDoctorExpenseLine } from "@/lib/ledger/daily-statement-expenses";
import { BalanceTopUpButton } from "@/components/finance/BalanceTopUpModal";
import type { BalanceTopUpSuccessDetail } from "@/lib/services/balance-topup";
import {
  applyDoctorWalletToCollectionsResult,
  reconcileDailyCollectionsResult,
} from "@/lib/services/doctor-wallet-pending";
import {
  ClinicExpenseRow,
  DoctorExpenseRow,
  StatementExpenseSection,
} from "@/components/ledger/StatementExpenseRows";
import { OutstandingDebtPanel } from "@/components/accountant/OutstandingDebtPanel";
import { DailyCollectionsCacheBanner } from "@/components/ledger/DailyCollectionsCacheBanner";
import {
  fetchDailyCollectionsCached,
  readDailyCollectionsCacheEntry,
  readLatestDailyCollectionsCacheEntry,
} from "@/lib/ledger/daily-collections-cache";
import { formatDoctorDisplayName } from "@/lib/services/clinic-profile";
import { FINANCIAL_EPSILON } from "@/lib/services/patient-financial-plan";
import { cn, formatCurrency, formatDate, todayISO, addDaysISO } from "@/lib/utils";
import {
  Calendar,
  Filter,
  ChevronDown,
  ChevronUp,
  ArrowDownToLine,
  ArrowUpToLine,
  Receipt,
  RefreshCw,
  Printer,
  Stethoscope,
  UserRound,
  Users,
} from "lucide-react";

type DoctorOption = { id: string; full_name_ar: string };

function staffPortalForCollections(): "accountant" | "admin" {
  if (
    typeof window !== "undefined" &&
    window.location.pathname.startsWith("/admin")
  ) {
    return "admin";
  }
  return "accountant";
}

const STATUS_TABS: { id: CollectionStatusFilter; label: string }[] = [
  { id: "all", label: "الكل" },
  { id: "paid", label: "دفعوا" },
  { id: "debtors", label: "مديونين" },
  { id: "unpaid", label: "لم يدفعوا" },
  { id: "at_accountant", label: "عند المحاسب" },
];

type SummaryTone = "navy" | "success" | "warning" | "danger" | "royal" | "gold";

const SUMMARY_TONE_BAR: Record<SummaryTone, string> = {
  navy: "bg-primary-500",
  success: "bg-success-text",
  warning: "bg-warning-text",
  danger: "bg-debt-text",
  royal: "bg-royal-500",
  gold: "bg-premium-400",
};

const SUMMARY_TONE_TEXT: Record<SummaryTone, string> = {
  navy: "text-slate-text",
  success: "text-success-text",
  warning: "text-warning-text",
  danger: "text-debt-text",
  royal: "text-royal-600",
  gold: "text-premium-600",
};

function SummaryChip({
  label,
  value,
  tone = "navy",
}: {
  label: string;
  value: number | string;
  tone?: SummaryTone;
}) {
  return (
    <div className="relative overflow-hidden rounded-2xl border border-slate-border bg-surface-card px-4 py-3 shadow-card transition-all duration-200 hover:-translate-y-0.5 hover:shadow-soft">
      <span
        className={cn("absolute inset-y-3 start-0 w-1 rounded-e-full", SUMMARY_TONE_BAR[tone])}
        aria-hidden
      />
      <p className={cn("text-lg font-black tabular-nums tracking-tight", SUMMARY_TONE_TEXT[tone])}>
        {value}
      </p>
      <p className="mt-0.5 text-[11px] font-medium text-slate-muted">{label}</p>
    </div>
  );
}

const ROW_BASE =
  "flex flex-col gap-3 border-b border-slate-border px-5 py-3.5 last:border-b-0 transition-colors hover:bg-surface sm:flex-row sm:items-center sm:justify-between";

function RowAmount({
  label,
  children,
  className,
}: {
  label: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <div className="min-w-[5.5rem] text-end">
      <p className="text-[11px] font-medium text-slate-muted">{label}</p>
      <p className={cn("font-bold tabular-nums", className)}>{children}</p>
    </div>
  );
}

function SectionStrip({
  tone,
  children,
}: {
  tone: "warning" | "danger" | "success";
  children: ReactNode;
}) {
  const toneClass =
    tone === "warning"
      ? "bg-warning text-warning-text"
      : tone === "danger"
        ? "bg-debt text-debt-text"
        : "bg-success text-success-text";
  return (
    <p
      className={cn(
        "flex items-center gap-2 border-y border-slate-border px-5 py-2 text-xs font-bold",
        toneClass
      )}
    >
      <span className="h-1.5 w-1.5 rounded-full bg-current" aria-hidden />
      {children}
    </p>
  );
}

function PatientRow({ row }: { row: DailyCollectionRow }) {
  const payUrl = buildLedgerPayUrl({
    patientId: row.patientId,
    doctorId: row.doctorId,
    queueEntryId: row.queueEntryId,
    patientName: row.patientName,
    patientPhone: row.patientPhone,
  });

  const debtAmount = Math.max(row.caseDebtTotal, row.remaining);
  const reviewFeePaidToday =
    row.sessionLabel.includes("كشفية") &&
    row.visitPaidToday > FINANCIAL_EPSILON &&
    row.requiredToday <= FINANCIAL_EPSILON;

  const showCollect =
    !reviewFeePaidToday &&
    (row.paymentStatus === "unpaid" ||
      row.paymentStatus === "partial" ||
      row.paymentStatus === "at_accountant" ||
      row.paymentStatus === "debtor");

  return (
    <div className={ROW_BASE}>
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <p className="font-bold text-slate-text">{row.patientName}</p>
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
            <p className="mt-1 text-xs font-semibold text-success-text">
              ✓ دفع {formatCurrency(row.visitPaidToday)}
              {row.visitDoctorShare > 0 &&
                ` · حصة الطبيب ${formatCurrency(row.visitDoctorShare)}`}
            </p>
          )}
          {(row.paymentStatus === "partial" ||
            (row.paymentStatus === "debtor" && row.visitPaidToday > 0)) &&
            row.visitDoctorShare > 0 && (
              <p className="mt-1 text-xs text-primary tabular-nums">
                حصة الطبيب من المدفوع: {formatCurrency(row.visitDoctorShare)}
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

      <div className="flex flex-wrap items-center gap-x-5 gap-y-3 sm:justify-end">
        {row.requiredToday > FINANCIAL_EPSILON && (
          <RowAmount label="السعر الكلي" className="text-slate-text">
            {formatCurrency(row.requiredToday)}
          </RowAmount>
        )}
        <RowAmount
          label="ما دفعه المراجع"
          className={cn(
            "text-lg",
            row.visitPaidToday > 0 ? "text-success-text" : "text-slate-muted"
          )}
        >
          {formatCurrency(row.visitPaidToday)}
        </RowAmount>
        <RowAmount
          label="حصة الطبيب"
          className={cn(
            "text-lg",
            row.visitDoctorShare > 0 ? "text-primary-700" : "text-slate-muted"
          )}
        >
          {formatCurrency(row.visitDoctorShare)}
        </RowAmount>
        <RowAmount
          label={row.paymentStatus === "debtor" ? "الدين" : "المتبقي"}
          className={debtAmount > 0 ? "text-debt-text" : "text-success-text"}
        >
          {formatCurrency(debtAmount)}
        </RowAmount>
        <div className="flex gap-2">
          {row.patientId && (
            <Link
              href={`/dashboard/patients/${row.patientId}`}
              className="mc-btn-soft px-3 py-1.5 text-xs"
            >
              الملف
            </Link>
          )}
          {showCollect && (
            <Link
              href={payUrl}
              className="mc-btn-navy px-3 py-1.5 text-xs"
            >
              <Receipt className="h-3.5 w-3.5" />
              تحصيل
            </Link>
          )}
        </div>
      </div>
    </div>
  );
}

function AssistantPayrollRow({ line }: { line: DailyAssistantPayrollLine }) {
  const isConfirmed = line.statusLabel === "صرف مؤكّد";
  const isCorrection = Boolean(line.isCorrection);

  return (
    <div className={ROW_BASE}>
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <span className="mc-kpi__icon mc-tone-warning h-7 w-7 rounded-lg">
            <UserRound className="h-3.5 w-3.5" />
          </span>
          <p className="font-semibold text-slate-text">
            مساعد: {line.assistantName}
          </p>
          <span
            className={cn(
              "inline-flex rounded-full border px-2 py-0.5 text-[11px] font-semibold",
              isCorrection
                ? "border-primary-200 bg-primary-50 text-primary-700"
                : isConfirmed
                  ? "border-success-border bg-success text-success-text"
                  : "border-warning-border bg-warning text-warning-text"
            )}
          >
            {isCorrection ? "تصحيح (استرجاع)" : line.statusLabel}
          </span>
        </div>
        <p className="mt-1 text-xs text-slate-muted">
          نسبة الطبيب من الأجر: {line.doctorSharePct}%
        </p>
      </div>

      <div className="flex flex-wrap items-center gap-x-5 gap-y-3 sm:justify-end">
        <RowAmount
          label={isCorrection ? "المبلغ المسترجع" : "أجر المساعد"}
          className="text-slate-text"
        >
          {formatCurrency(Math.abs(line.totalSalary))}
        </RowAmount>
        <RowAmount
          label={isCorrection ? "يُرجع للطبيب" : "يُخصم من الطبيب"}
          className={isCorrection ? "text-success-text" : "text-debt-text"}
        >
          {isCorrection ? "+" : "−"} {formatCurrency(Math.abs(line.doctorDeduction))}
        </RowAmount>
        <RowAmount
          label={isCorrection ? "يُرجع للعيادة" : "حصة العيادة"}
          className="text-slate-text"
        >
          {formatCurrency(Math.abs(line.clinicShare))}
        </RowAmount>
      </div>
    </div>
  );
}

function WithdrawalRow({ line }: { line: DoctorWithdrawalLine }) {
  const isPending = line.status === "pending";
  return (
    <div className={ROW_BASE}>
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <span
            className={cn(
              "mc-kpi__icon h-7 w-7 rounded-lg",
              isPending ? "mc-tone-warning" : "mc-tone-danger"
            )}
          >
            <ArrowDownToLine className="h-3.5 w-3.5" />
          </span>
          <p className="font-semibold text-slate-text">{line.source}</p>
          <span
            className={cn(
              "inline-flex rounded-full border px-2 py-0.5 text-[11px] font-semibold",
              isPending
                ? "border-warning-border bg-warning text-warning-text"
                : "border-debt-border bg-debt text-debt-text"
            )}
          >
            {withdrawalStatusLabel(line.status)}
          </span>
        </div>
        <p className="mt-1 text-xs text-slate-muted">
          {formatDate(line.effectiveDate)}
          {isPending && " · يُحجز من الرصيد المتاح للسحب حتى الموافقة"}
        </p>
      </div>
      <RowAmount
        label={isPending ? "طلب سحب رصيد" : "سحب رصيد"}
        className={isPending ? "text-warning-text" : "text-debt-text"}
      >
        − {formatCurrency(line.amount)}
      </RowAmount>
    </div>
  );
}

function BalanceTopUpRow({ line }: { line: DoctorBalanceTopUpLine }) {
  return (
    <div className={ROW_BASE}>
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <span className="mc-kpi__icon mc-tone-success h-7 w-7 rounded-lg">
            <ArrowUpToLine className="h-3.5 w-3.5" />
          </span>
          <p className="font-semibold text-slate-text">{line.label}</p>
        </div>
        <p className="mt-1 text-xs text-slate-muted">
          {formatDate(line.effectiveDate)}
        </p>
      </div>
      <RowAmount label="شحن رصيد" className="text-success-text">
        + {formatCurrency(line.amount)}
      </RowAmount>
    </div>
  );
}

function ClinicBalanceTopUpRow({ line }: { line: ClinicBalanceTopUpLine }) {
  return (
    <div className={ROW_BASE}>
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <span className="mc-kpi__icon mc-tone-success h-7 w-7 rounded-lg">
            <ArrowUpToLine className="h-3.5 w-3.5" />
          </span>
          <p className="font-semibold text-slate-text">{line.label}</p>
        </div>
        <p className="mt-1 text-xs text-slate-muted">
          {formatDate(line.effectiveDate)} · يُضاف لصافي ربح العيادة
        </p>
      </div>
      <RowAmount label="شحن رصيد العيادة" className="text-success-text">
        + {formatCurrency(line.amount)}
      </RowAmount>
    </div>
  );
}

function DoctorSection({
  doctorName,
  stats,
  rows,
  assistantPayroll,
  withdrawals,
  balanceTopups,
  doctorExpenses,
  defaultOpen,
}: {
  doctorName: string;
  stats: DoctorDailySummary["stats"];
  rows: DailyCollectionRow[];
  assistantPayroll: DailyAssistantPayrollLine[];
  withdrawals: DoctorWithdrawalLine[];
  balanceTopups: DoctorBalanceTopUpLine[];
  doctorExpenses: DailyDoctorExpenseLine[];
  defaultOpen: boolean;
}) {
  const [open, setOpen] = useState(defaultOpen);

  return (
    <div className="mc-panel">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center justify-between gap-3 px-5 py-4 text-start transition-colors hover:bg-surface"
      >
        <div className="flex min-w-0 flex-1 items-center gap-3.5">
          <span className="mc-icon-tile h-11 w-11 rounded-xl">
            <Stethoscope className="h-5 w-5" strokeWidth={1.8} />
          </span>
          <div className="min-w-0 text-start">
            <p className="truncate text-[15px] font-bold text-slate-text">
              {formatDoctorDisplayName(doctorName)}
            </p>
            <p className="mt-0.5 text-xs text-slate-muted">
              {stats.totalPatients > 0 && (
                <>
                  {stats.totalPatients} مراجع · مدفوع{" "}
                  {formatCurrency(stats.totalCollected)}
                  {stats.doctorShareToday > 0 && (
                    <>
                      {" "}
                      · حصة {formatCurrency(stats.doctorShareToday)}
                    </>
                  )}
                  {" "}
                  · متبقي {formatCurrency(stats.totalRemaining)}
                </>
              )}
              {stats.totalPatients === 0 && assistantPayroll.length > 0 && (
                <>أجور مساعدين فقط</>
              )}
              {stats.totalPatients === 0 &&
                assistantPayroll.length === 0 &&
                withdrawals.length === 0 &&
                balanceTopups.length === 0 &&
                doctorExpenses.length === 0 && (
                  <>لا حركة مالية في هذه الفترة</>
                )}
              {stats.totalPatients === 0 &&
                assistantPayroll.length === 0 &&
                withdrawals.length === 0 &&
                balanceTopups.length === 0 &&
                doctorExpenses.length > 0 && <>فواتير صرفية فقط</>}
              {stats.totalPatients === 0 &&
                assistantPayroll.length === 0 &&
                withdrawals.length > 0 &&
                balanceTopups.length === 0 && <>سحوبات رصيد فقط</>}
              {stats.totalPatients === 0 &&
                assistantPayroll.length === 0 &&
                withdrawals.length === 0 &&
                balanceTopups.length > 0 && <>شحن رصيد فقط</>}
              {stats.assistantDoctorDeduction > 0 && (
                <>
                  {stats.totalPatients > 0 && " · "}
                  خصم مساعدين −{formatCurrency(stats.assistantDoctorDeduction)}
                  {stats.netDoctorShareToday >= 0 && (
                    <> · صافي {formatCurrency(stats.netDoctorShareToday)}</>
                  )}
                </>
              )}
              {stats.totalWithdrawnInPeriod > 0 && (
                <>
                  {(stats.totalPatients > 0 ||
                    stats.assistantDoctorDeduction > 0) &&
                    " · "}
                  <span className="font-medium text-debt-text">
                    سحب −{formatCurrency(stats.totalWithdrawnInPeriod)}
                  </span>
                </>
              )}
              {stats.totalPendingWithdrawalInPeriod > 0 && (
                <>
                  {(stats.totalPatients > 0 ||
                    stats.assistantDoctorDeduction > 0 ||
                    stats.totalWithdrawnInPeriod > 0) &&
                    " · "}
                  <span className="font-medium text-warning-text">
                    طلب سحب معلّق −
                    {formatCurrency(stats.totalPendingWithdrawalInPeriod)}
                  </span>
                </>
              )}
              {stats.totalToppedUpInPeriod > 0 && (
                <>
                  {(stats.totalPatients > 0 ||
                    stats.assistantDoctorDeduction > 0 ||
                    stats.totalWithdrawnInPeriod > 0) &&
                    " · "}
                  <span className="font-medium text-success-text">
                    شحن +{formatCurrency(stats.totalToppedUpInPeriod)}
                  </span>
                </>
              )}
              {stats.availableBalance != null && (
                <>
                  {" · "}
                  رصيد محاسبي {formatCurrency(stats.availableBalance)}
                </>
              )}
              {stats.withdrawableLimit != null &&
                stats.withdrawableLimit !== stats.availableBalance && (
                  <>
                    {" · "}
                    متاح للسحب {formatCurrency(stats.withdrawableLimit)}
                  </>
                )}
            </p>
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <span className="hidden rounded-full border border-success-border bg-success px-2.5 py-0.5 text-[11px] font-semibold tabular-nums text-success-text sm:inline">
            {stats.paidFull + stats.partial} دفع
          </span>
          <span className="hidden rounded-full border border-warning-border bg-warning px-2.5 py-0.5 text-[11px] font-bold tabular-nums text-warning-text sm:inline">
            {stats.debtors} مديون
          </span>
          <span className="hidden rounded-full border border-debt-border bg-debt px-2.5 py-0.5 text-[11px] font-semibold tabular-nums text-debt-text sm:inline">
            {stats.unpaid} لم يدفع
          </span>
          <span className="hidden rounded-full border border-royal-200 bg-royal-50 px-2.5 py-0.5 text-[11px] font-semibold tabular-nums text-royal-600 sm:inline">
            {stats.atAccountant} عند المحاسب
          </span>
          <span className="flex h-8 w-8 items-center justify-center rounded-lg border border-slate-border bg-surface-card">
            {open ? (
              <ChevronUp className="h-4 w-4 text-slate-muted" />
            ) : (
              <ChevronDown className="h-4 w-4 text-slate-muted" />
            )}
          </span>
        </div>
      </button>

      {open && (
        <div className="border-t border-slate-border bg-surface-card">
          {rows.length === 0 &&
          assistantPayroll.length === 0 &&
          withdrawals.length === 0 &&
          balanceTopups.length === 0 &&
          doctorExpenses.length === 0 ? (
            <p className="px-4 py-6 text-center text-sm text-slate-muted">
              لا مراجعين في هذا التصنيف
            </p>
          ) : (
            <>
              {rows.map((row) => (
                <PatientRow key={row.id} row={row} />
              ))}
              {doctorExpenses.length > 0 && (
                <StatementExpenseSection title="فواتير صرفية الطبيب">
                  {doctorExpenses.map((line) => (
                    <DoctorExpenseRow key={line.id} line={line} />
                  ))}
                </StatementExpenseSection>
              )}
              {assistantPayroll.length > 0 && (
                <div>
                  <SectionStrip tone="warning">أجور مساعدي الطبيب</SectionStrip>
                  {assistantPayroll.map((line) => (
                    <AssistantPayrollRow key={line.id} line={line} />
                  ))}
                </div>
              )}
              {withdrawals.length > 0 && (
                <div>
                  <SectionStrip tone="danger">سحوبات رصيد الطبيب</SectionStrip>
                  {withdrawals.map((line) => (
                    <WithdrawalRow key={line.id} line={line} />
                  ))}
                </div>
              )}
              {balanceTopups.length > 0 && (
                <div>
                  <SectionStrip tone="success">شحن رصيد الطبيب</SectionStrip>
                  {balanceTopups.map((line) => (
                    <BalanceTopUpRow key={line.id} line={line} />
                  ))}
                </div>
              )}
            </>
          )}
        </div>
      )}
    </div>
  );
}

export function DailyCollectionsPanel() {
  const { clinicId, loading: clinicLoading } = useActiveClinicId();
  const { bi } = useLanguage();
  const [dateFrom, setDateFrom] = useState(todayISO());
  const [dateTo, setDateTo] = useState(todayISO());
  const [doctorId, setDoctorId] = useState("");
  const [statusFilter, setStatusFilter] =
    useState<CollectionStatusFilter>("all");
  const [queryFrom, setQueryFrom] = useState(todayISO());
  const [queryTo, setQueryTo] = useState(todayISO());
  const [queryDoctorId, setQueryDoctorId] = useState<string | undefined>();
  const [doctors, setDoctors] = useState<DoctorOption[]>([]);
  const [rawResult, setRawResult] = useState<DailyCollectionsResult | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [offlineView, setOfflineView] = useState(false);
  const [cachedAt, setCachedAt] = useState<number | null>(null);
  const [showDebtPanel, setShowDebtPanel] = useState(false);
  const [appliedFrom, setAppliedFrom] = useState(todayISO());
  const [appliedTo, setAppliedTo] = useState(todayISO());
  const loadGenerationRef = useRef(0);

  const effectiveTo = dateTo >= dateFrom ? dateTo : dateFrom;
  const queryEffectiveTo = queryTo >= queryFrom ? queryTo : queryFrom;
  const selectedDoctorId = doctorId.trim() || undefined;

  const result = useMemo(
    () =>
      rawResult
        ? filterDailyCollectionsResult(rawResult, statusFilter)
        : null,
    [rawResult, statusFilter]
  );

  const loadDoctors = useCallback(async () => {
    if (!clinicId) {
      setDoctors([]);
      return;
    }
    const supabase = createClient();
    const { data } = await supabase
      .from("doctors")
      .select("id, full_name_ar")
      .eq("clinic_id", clinicId)
      .eq("is_active", true)
      .order("full_name_ar");
    setDoctors((data as DoctorOption[]) ?? []);
  }, [clinicId]);

  const loadCollections = useCallback(async () => {
    if (!clinicId) {
      setRawResult(null);
      setLoading(false);
      setRefreshing(false);
      return;
    }
    const loadGeneration = ++loadGenerationRef.current;
    const query = {
      portal: staffPortalForCollections(),
      clinicId,
      doctorId: queryDoctorId,
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
    setShowDebtPanel(false);
    setOfflineView(false);

    const outcome = await fetchDailyCollectionsCached({
      query,
      apiPath: "/api/admin/daily-collections",
      headers: authPortalHeaders(staffPortalForCollections()),
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

    setRawResult(outcome.result);
    setCachedAt(outcome.cachedAt);
    setOfflineView(outcome.offline && outcome.source === "cache");
    setAppliedFrom(queryFrom);
    setAppliedTo(queryEffectiveTo);
    setLoading(false);
    setRefreshing(false);
  }, [clinicId, queryFrom, queryEffectiveTo, queryDoctorId]);

  const handleTopUpSuccess = useCallback(
    (detail: BalanceTopUpSuccessDetail) => {
      if (
        detail.target === "doctor" &&
        detail.doctorId &&
        detail.doctorWallet
      ) {
        setRawResult((prev) =>
          prev
            ? applyDoctorWalletToCollectionsResult(
                prev,
                detail.doctorId!,
                detail.doctorWallet!
              )
            : prev
        );
        return;
      }
      if (detail.target === "clinic") {
        void loadCollections();
      }
    },
    [loadCollections]
  );

  useEffect(() => {
    if (clinicLoading) return;
    void loadDoctors();
  }, [loadDoctors, clinicLoading]);

  useEffect(() => {
    if (clinicLoading || !clinicId) return;
    void loadCollections();
  }, [clinicLoading, clinicId, loadCollections]);

  useEffect(() => {
    if (loading || !rawResult) {
      setShowDebtPanel(false);
      return;
    }
    const timer = window.setTimeout(() => setShowDebtPanel(true), 400);
    return () => window.clearTimeout(timer);
  }, [loading, rawResult]);

  const refreshCollections = useCallback(() => {
    const to = effectiveTo;
    if (
      dateFrom === queryFrom &&
      to === queryEffectiveTo &&
      selectedDoctorId === queryDoctorId
    ) {
      void loadCollections();
      return;
    }
    setQueryFrom(dateFrom);
    setQueryTo(to);
    setQueryDoctorId(selectedDoctorId);
  }, [
    dateFrom,
    effectiveTo,
    queryFrom,
    queryEffectiveTo,
    queryDoctorId,
    selectedDoctorId,
    loadCollections,
  ]);

  useClinicSync({
    topics: ["sessions", "financial"],
    clinicId,
    onRefresh: loadCollections,
    enabled: !clinicLoading && !!clinicId,
  });

  const periodLabel = useMemo(() => {
    if (appliedFrom === appliedTo) {
      return formatDate(new Date(appliedFrom + "T12:00:00"));
    }
    return `${formatDate(new Date(appliedFrom + "T12:00:00"))} — ${formatDate(new Date(appliedTo + "T12:00:00"))}`;
  }, [appliedFrom, appliedTo]);

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
    <div className="space-y-6">
      <PageHeader
        title="كشف مالي"
        eyebrow={bi("المالية", "Finance")}
        icon={Calendar}
        subtitle="لكل مراجع: ما دفعه، حصة الطبيب من المدفوع، والمتبقي. الملخص = مجموع الفترة المحددة — مو الرصيد التراكمي للطبيب."
        className="mb-0"
      />

      <div className="mc-panel">
        <div className="mc-panel-head">
          <p className="mc-panel-title">
            <Filter />
            {bi("الفترة والتصفية", "Period & filters")}
          </p>
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={setToday}
              className="mc-chip px-3 py-1 text-xs"
            >
              اليوم
            </button>
            <button
              type="button"
              onClick={setLast7Days}
              className="mc-chip px-3 py-1 text-xs"
            >
              آخر 7 أيام
            </button>
          </div>
        </div>
        <div className="mc-panel-body">
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <Input
            label="من تاريخ"
            type="date"
            value={dateFrom}
            onChange={(e) => setDateFrom(e.target.value)}
            dir="ltr"
            className="text-left"
          />
          <Input
            label="إلى تاريخ"
            type="date"
            value={dateTo}
            min={dateFrom}
            onChange={(e) => setDateTo(e.target.value)}
            dir="ltr"
            className="text-left"
          />
          <Select
            label="الطبيب"
            value={doctorId}
            onChange={(e) => setDoctorId(e.target.value)}
            placeholder="كل الأطباء"
            options={doctors.map((d) => ({
              value: d.id,
              label: d.full_name_ar,
            }))}
          />
          <div className="flex flex-wrap items-end gap-2 sm:col-span-2 lg:col-span-1">
            <BalanceTopUpButton
              portal={staffPortalForCollections()}
              onSuccess={handleTopUpSuccess}
              size="sm"
              variant="outline"
            />
            <button
              type="button"
              onClick={() => void refreshCollections()}
              disabled={loading}
              className="mc-btn-navy h-9 w-full sm:w-auto"
            >
              {loading || refreshing ? (
                <RefreshCw className="h-4 w-4 animate-spin" />
              ) : (
                <RefreshCw className="h-4 w-4" />
              )}
              <span>تحديث</span>
            </button>
            <button
              type="button"
              onClick={() => window.print()}
              disabled={!result}
              className="mc-btn-soft h-9 w-full sm:w-auto"
            >
              <Printer className="h-4 w-4 text-premium-500" />
              <span>طباعة</span>
            </button>
          </div>
        </div>

        <div className="mt-5 flex flex-wrap gap-2 border-t border-slate-border pt-4">
          {STATUS_TABS.map((tab) => (
            <button
              key={tab.id}
              type="button"
              onClick={() => setStatusFilter(tab.id)}
              className={cn("mc-chip", statusFilter === tab.id && "mc-chip--active")}
            >
              {tab.label}
            </button>
          ))}
        </div>
        </div>
      </div>

      <DailyCollectionsCacheBanner
        refreshing={refreshing}
        offline={offlineView}
        cachedAt={cachedAt}
        refreshingLabel="عرض سريع من الذاكرة — جاري التحديث من السيرفر…"
        offlineLabel="بدون اتصال — آخر تحديث: {time}"
      />

      {result && (
        <div className="space-y-4">
          <div className="mc-hero rounded-3xl p-6 sm:p-7">
            <div className="relative flex flex-wrap items-end justify-between gap-6">
              <div className="min-w-0">
                <p className="flex items-center gap-2 text-xs font-bold uppercase tracking-[0.14em] text-premium-300">
                  <Users className="h-4 w-4" />
                  ملخص {periodLabel}
                </p>
                <p className="mt-3 text-sm font-medium text-white/70">مدفوع المراجعين</p>
                <p className="mc-text-champagne mt-1 text-4xl font-black tracking-tight tabular-nums sm:text-5xl">
                  {formatCurrency(result.totals.totalCollected)}
                </p>
              </div>
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                {[
                  { label: "جلسات", value: result.totals.totalPatients },
                  {
                    label: "دفعوا",
                    value: result.totals.paidFull + result.totals.partial,
                  },
                  { label: "مديونين", value: result.totals.debtors },
                  { label: "لم يدفعوا", value: result.totals.unpaid },
                ].map((s) => (
                  <div
                    key={s.label}
                    className="rounded-2xl bg-white/[0.07] px-4 py-2.5 text-center ring-1 ring-inset ring-white/10"
                  >
                    <p className="text-xl font-black tabular-nums text-white">{s.value}</p>
                    <p className="text-[11px] font-medium text-white/60">{s.label}</p>
                  </div>
                ))}
              </div>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-6">
            <SummaryChip
              label="عند المحاسب"
              value={result.totals.atAccountant}
              tone="royal"
            />
            <SummaryChip
              label="حصة الأطباء"
              value={formatCurrency(result.totals.doctorShareToday)}
              tone="navy"
            />
            {result.totals.assistantDoctorDeduction > 0 && (
              <SummaryChip
                label="خصم مساعدين"
                value={`− ${formatCurrency(result.totals.assistantDoctorDeduction)}`}
                tone="danger"
              />
            )}
            {result.totals.netDoctorShareToday > 0 && (
              <SummaryChip
                label="صافي حصة الأطباء"
                value={formatCurrency(result.totals.netDoctorShareToday)}
                tone="success"
              />
            )}
            {result.totals.totalWithdrawnInPeriod > 0 && (
              <SummaryChip
                label="سحوبات الأطباء"
                value={`− ${formatCurrency(result.totals.totalWithdrawnInPeriod)}`}
                tone="danger"
              />
            )}
            {result.totals.totalPendingWithdrawalInPeriod > 0 && (
              <SummaryChip
                label="طلبات سحب معلّقة"
                value={`− ${formatCurrency(result.totals.totalPendingWithdrawalInPeriod)}`}
                tone="warning"
              />
            )}
            {result.totals.totalToppedUpInPeriod > 0 && (
              <SummaryChip
                label="شحن رصيد الأطباء"
                value={`+ ${formatCurrency(result.totals.totalToppedUpInPeriod)}`}
                tone="success"
              />
            )}
            {result.totals.totalClinicToppedUpInPeriod > 0 && (
              <SummaryChip
                label="شحن رصيد العيادة"
                value={`+ ${formatCurrency(result.totals.totalClinicToppedUpInPeriod)}`}
                tone="success"
              />
            )}
            {result.totals.totalDoctorExpenseDeduction > 0 && (
              <SummaryChip
                label="خصم فواتير أطباء"
                value={`− ${formatCurrency(result.totals.totalDoctorExpenseDeduction)}`}
                tone="danger"
              />
            )}
            {result.totals.totalClinicGeneralExpenses > 0 && (
              <SummaryChip
                label="صرفيات العيادة"
                value={`− ${formatCurrency(result.totals.totalClinicGeneralExpenses)}`}
                tone="danger"
              />
            )}
            <SummaryChip
              label="متبقي"
              value={formatCurrency(result.totals.totalRemaining)}
              tone="warning"
            />
          </div>
        </div>
      )}

      {loading && !rawResult && (
        <div className="space-y-3">
          <div className="mc-skeleton h-36 rounded-3xl" />
          {[1, 2, 3].map((i) => (
            <div key={i} className="mc-skeleton h-20 rounded-2xl" />
          ))}
        </div>
      )}

      {result && result.doctors.length === 0 && result.clinicExpenses.length === 0 && result.clinicBalanceTopups.length === 0 && (
        <Alert variant="info">
          لا توجد بيانات مالية لـ {periodLabel}
          {doctorId ? " لهذا الطبيب" : ""}.
        </Alert>
      )}

      {result && result.doctors.length > 0 && !selectedDoctorId && (
        <p className="mc-section-divider">
          {result.doctors.length} طبيب في هذه الفترة
        </p>
      )}

      {result &&
        result.doctors.map((group, index) => (
          <DoctorSection
            key={group.doctorId}
            doctorName={group.doctorName}
            stats={group.stats}
            rows={group.rows}
            assistantPayroll={group.assistantPayroll}
            withdrawals={group.withdrawals}
            balanceTopups={group.balanceTopups}
            doctorExpenses={group.doctorExpenses}
            defaultOpen={!!selectedDoctorId || index < 5}
          />
        ))}

      {result && result.clinicBalanceTopups.length > 0 && (
        <div className="mc-panel">
          <div className="mc-panel-head">
            <div>
              <p className="mc-panel-title">
                <ArrowUpToLine />
                شحن رصيد العيادة
              </p>
              <p className="mt-0.5 text-xs text-slate-muted">
                يُضاف مباشرة إلى صافي ربح العيادة — يظهر أيضاً في «توضيح الربح»
              </p>
            </div>
          </div>
          <div>
            {result.clinicBalanceTopups.map((line) => (
              <ClinicBalanceTopUpRow key={line.id} line={line} />
            ))}
          </div>
        </div>
      )}

      {result && result.clinicExpenses.length > 0 && (
        <div className="mc-panel">
          <div className="mc-panel-head">
            <div>
              <p className="mc-panel-title">
                <Receipt />
                صرفيات العيادة العامة
              </p>
              <p className="mt-0.5 text-xs text-slate-muted">
                مختبر، مواد، ومصاريف تشغيل — تُخصم من ربح العيادة
              </p>
            </div>
          </div>
          <div>
            {result.clinicExpenses.map((line) => (
              <ClinicExpenseRow key={line.id} line={line} />
            ))}
          </div>
        </div>
      )}

      {!loading && showDebtPanel && clinicId && (
        <OutstandingDebtPanel clinicId={clinicId} doctorId={selectedDoctorId} />
      )}
    </div>
  );
}
