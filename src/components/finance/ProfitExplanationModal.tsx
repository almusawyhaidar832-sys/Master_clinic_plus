"use client";

import { useCallback, useEffect, useState } from "react";
import {
  X,
  Loader2,
  Info,
  Receipt,
  Stethoscope,
  Users,
  UserCog,
  Wallet,
  Building2,
  TrendingDown,
  TrendingUp,
} from "lucide-react";
import { Button } from "@/components/ui/Button";
import { Alert } from "@/components/ui/Alert";
import { fetchProfitDeductionLedgerViaApi } from "@/lib/services/profit-ledger-api";
import {
  fetchAlignedClinicProfitStats,
} from "@/lib/services/clinic-profit-loader";
import { useActiveClinicId } from "@/hooks/useActiveClinicId";
import type {
  ProfitDeductionLedger,
  ProfitLedgerCategory,
  ProfitLedgerGroup,
} from "@/lib/services/profit-deduction-ledger";
import type { AuthPortalId } from "@/lib/auth/portal-access";
import {
  cn,
  formatCurrency,
  formatDate,
  inferProfitPeriodFromRange,
  profitPeriodDateRange,
  profitPeriodLabelAr,
  type ProfitPeriodPreset,
} from "@/lib/utils";
import { ProfitLedgerLineRow } from "@/components/finance/ProfitLedgerLineRow";

const CATEGORY_ICONS: Record<
  ProfitLedgerCategory,
  React.ComponentType<{ className?: string }>
> = {
  general_expense: Receipt,
  doctor_expense_clinic: Stethoscope,
  assistant_payroll: Users,
  staff_salary: UserCog,
  doctor_salary: Stethoscope,
  balance_topup: Building2,
};

const CATEGORY_COLORS: Record<ProfitLedgerCategory, string> = {
  general_expense: "bg-amber-100 text-amber-700",
  doctor_expense_clinic: "bg-orange-100 text-orange-700",
  assistant_payroll: "bg-violet-100 text-violet-700",
  staff_salary: "bg-rose-100 text-rose-700",
  doctor_salary: "bg-pink-100 text-pink-700",
  balance_topup: "bg-emerald-100 text-emerald-700",
};

const PROFIT_PERIOD_TABS: ProfitPeriodPreset[] = ["today", "week", "month"];

function formatPeriodLabel(from: string, to: string): string {
  if (from === to) return formatDate(from);
  return `${formatDate(from)} — ${formatDate(to)}`;
}

function LedgerGroupSection({ group }: { group: ProfitLedgerGroup }) {
  const Icon = CATEGORY_ICONS[group.category];
  const isAddition = group.category === "balance_topup";

  return (
    <section className="rounded-xl border border-slate-border bg-surface/50 overflow-hidden">
      <div className="flex items-center justify-between gap-2 border-b border-slate-border/60 bg-surface-card px-3 py-2.5">
        <div className="flex min-w-0 items-center gap-2">
          <div
            className={cn(
              "flex h-8 w-8 shrink-0 items-center justify-center rounded-lg",
              CATEGORY_COLORS[group.category]
            )}
          >
            <Icon className="h-4 w-4" />
          </div>
          <div className="min-w-0">
            <p className="truncate text-sm font-bold text-slate-text">{group.label}</p>
            <p className="text-[11px] text-slate-muted">{group.lines.length} عملية</p>
          </div>
        </div>
        <span
          className={cn(
            "shrink-0 text-sm font-bold tabular-nums",
            isAddition ? "text-success-text" : "text-debt-text"
          )}
        >
          {isAddition ? "+" : "−"}
          {formatCurrency(isAddition ? group.totalAddition : group.totalDeduction)}
        </span>
      </div>

      <ul className="divide-y divide-slate-border/40">
        {group.lines.map((line) => (
          <ProfitLedgerLineRow key={line.id} line={line} />
        ))}
      </ul>
    </section>
  );
}

interface ProfitExplanationModalProps {
  open: boolean;
  onClose: () => void;
  from: string;
  to: string;
  portal?: AuthPortalId;
  netProfit?: number;
}

export function ProfitExplanationModal({
  open,
  onClose,
  from: initialFrom,
  to: initialTo,
  portal = "accountant",
  netProfit: initialNetProfit,
}: ProfitExplanationModalProps) {
  const { clinicId } = useActiveClinicId();
  const [period, setPeriod] = useState<ProfitPeriodPreset>("month");
  const [ledger, setLedger] = useState<ProfitDeductionLedger | null>(null);
  const [netProfit, setNetProfit] = useState<number | undefined>(initialNetProfit);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const range = profitPeriodDateRange(period);
  const { from, to } = range;

  const load = useCallback(async () => {
    if (!clinicId) return;
    setLoading(true);
    setError(null);
    try {
      const periodRange = { from, to };
      const [data, stats] = await Promise.all([
        fetchProfitDeductionLedgerViaApi(from, to, portal, clinicId),
        fetchAlignedClinicProfitStats(clinicId, portal, periodRange).catch(
          () => null
        ),
      ]);
      setLedger(data);
      setNetProfit(stats?.netProfit ?? undefined);
    } catch (e) {
      setError(e instanceof Error ? e.message : "تعذر تحميل التفاصيل");
      setLedger(null);
      setNetProfit(undefined);
    } finally {
      setLoading(false);
    }
  }, [from, to, portal, clinicId]);

  useEffect(() => {
    if (open) {
      setPeriod(inferProfitPeriodFromRange(initialFrom, initialTo));
    } else {
      setLedger(null);
      setError(null);
      setNetProfit(initialNetProfit);
    }
  }, [open, initialFrom, initialTo, initialNetProfit]);

  useEffect(() => {
    if (open) load();
  }, [open, load]);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-black/50 p-0 sm:items-center sm:p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="profit-explanation-title"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="flex max-h-[92dvh] w-full max-w-lg flex-col overflow-hidden rounded-t-2xl bg-surface-card shadow-elevated sm:max-h-[88dvh] sm:rounded-2xl">
        <div className="flex shrink-0 items-center justify-between border-b border-slate-border bg-surface-card px-4 py-3">
          <div className="flex items-center gap-2">
            <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-primary/10 text-primary">
              <Info className="h-5 w-5" />
            </div>
            <div>
              <h2 id="profit-explanation-title" className="text-base font-bold text-slate-text">
                توضيح ربح العيادة
              </h2>
              <p className="text-[11px] text-slate-muted">
                {formatPeriodLabel(from, to)}
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg p-1.5 text-slate-muted hover:bg-surface"
            aria-label="إغلاق"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="shrink-0 border-b border-slate-border bg-surface-card px-4 pb-3">
          <div className="flex gap-1 rounded-xl bg-surface p-1">
            {PROFIT_PERIOD_TABS.map((tab) => (
              <button
                key={tab}
                type="button"
                onClick={() => setPeriod(tab)}
                className={cn(
                  "flex-1 rounded-lg px-2 py-2 text-xs font-semibold transition-colors",
                  period === tab
                    ? "bg-surface-card text-primary shadow-sm"
                    : "text-slate-muted hover:text-slate-text"
                )}
              >
                {profitPeriodLabelAr(tab)}
              </button>
            ))}
          </div>
        </div>

        <div className="flex-1 overflow-y-auto p-4 space-y-4">
          {loading && (
            <div className="flex flex-col items-center justify-center gap-2 py-12 text-slate-muted">
              <Loader2 className="h-8 w-8 animate-spin text-primary" />
              <p className="text-sm">جاري تحميل التفاصيل...</p>
            </div>
          )}

          {error && !loading && (
            <Alert variant="error">{error}</Alert>
          )}

          {ledger && !loading && (
            <>
              <div className="rounded-xl border border-primary/20 bg-primary/5 p-4">
                <p className="text-sm leading-relaxed text-slate-text">
                  {ledger.summaryAr}
                </p>
              </div>

              <div className="grid grid-cols-2 gap-2">
                {ledger.totalDeductions > 0 && (
                  <div className="rounded-xl border border-debt-border bg-debt/30 p-3 text-center">
                    <div className="mb-1 flex items-center justify-center gap-1 text-debt-text">
                      <TrendingDown className="h-4 w-4" />
                      <span className="text-xs font-medium">إجمالي الخصومات</span>
                    </div>
                    <p className="text-lg font-black tabular-nums text-debt-text">
                      −{formatCurrency(ledger.totalDeductions)}
                    </p>
                  </div>
                )}
                {ledger.totalAdditions > 0 && (
                  <div className="rounded-xl border border-success-border bg-success/30 p-3 text-center">
                    <div className="mb-1 flex items-center justify-center gap-1 text-success-text">
                      <TrendingUp className="h-4 w-4" />
                      <span className="text-xs font-medium">إضافات للربح</span>
                    </div>
                    <p className="text-lg font-black tabular-nums text-success-text">
                      +{formatCurrency(ledger.totalAdditions)}
                    </p>
                  </div>
                )}
                {netProfit !== undefined && (
                  <div
                    className={cn(
                      "rounded-xl border p-3 text-center",
                      ledger.totalDeductions > 0 && ledger.totalAdditions > 0
                        ? "col-span-2"
                        : "",
                      netProfit >= 0
                        ? "border-success-border bg-success/20"
                        : "border-debt-border bg-debt/20"
                    )}
                  >
                    <p className="text-xs font-medium text-slate-muted">
                      صافي الربح ({profitPeriodLabelAr(period)})
                    </p>
                    <p
                      className={cn(
                        "text-lg font-black tabular-nums",
                        netProfit >= 0 ? "text-success-text" : "text-debt-text"
                      )}
                    >
                      {netProfit >= 0 ? "+" : ""}
                      {formatCurrency(netProfit)}
                    </p>
                  </div>
                )}
              </div>

              {ledger.groups.length === 0 ? (
                <div className="rounded-xl border border-dashed border-slate-border py-10 text-center">
                  <Wallet className="mx-auto mb-2 h-8 w-8 text-slate-muted/50" />
                  <p className="text-sm text-slate-muted">
                    لا توجد صرفيات أو رواتب مسجّلة في هذه الفترة
                  </p>
                </div>
              ) : (
                <div className="space-y-3">
                  <p className="text-xs font-semibold text-slate-muted">
                    تفصيل العمليات المالية
                  </p>
                  {ledger.groups.map((group) => (
                    <LedgerGroupSection key={group.category} group={group} />
                  ))}
                </div>
              )}
            </>
          )}
        </div>

        <div className="shrink-0 border-t border-slate-border bg-surface-card p-4">
          <Button type="button" variant="outline" className="w-full" onClick={onClose}>
            إغلاق
          </Button>
        </div>
      </div>
    </div>
  );
}

interface ProfitExplanationButtonProps {
  from: string;
  to: string;
  portal?: AuthPortalId;
  netProfit?: number;
  className?: string;
  size?: "sm" | "md" | "lg";
  variant?: "primary" | "outline" | "premium";
  label?: string;
}

export function ProfitExplanationButton({
  from,
  to,
  portal = "accountant",
  netProfit,
  className,
  size = "sm",
  variant = "outline",
  label = "توضيح الربح",
}: ProfitExplanationButtonProps) {
  const [open, setOpen] = useState(false);

  return (
    <>
      <Button
        type="button"
        variant={variant}
        size={size}
        className={className}
        onClick={() => setOpen(true)}
      >
        <Info className="h-4 w-4" />
        {label}
      </Button>
      <ProfitExplanationModal
        open={open}
        onClose={() => setOpen(false)}
        from={from}
        to={to}
        portal={portal}
        netProfit={netProfit}
      />
    </>
  );
}
