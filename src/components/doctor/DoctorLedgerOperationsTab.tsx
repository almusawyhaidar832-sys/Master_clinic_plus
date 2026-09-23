"use client";

import { useCallback, useEffect, useState } from "react";
import { Input } from "@/components/ui/Input";
import { authPortalHeaders } from "@/lib/auth/api-portal";
import { useLanguage } from "@/contexts/LanguageContext";
import { cn, formatDate, currentMonthYear, monthDateRange } from "@/lib/utils";
import type {
  DoctorLedgerOperationKind,
  DoctorLedgerOperationRow,
} from "@/lib/services/doctor-financial-ledger";
import {
  AlertCircle,
  Info,
  RefreshCw,
  ArrowDownToLine,
  Banknote,
  Receipt,
  Users,
} from "lucide-react";

interface DoctorLedgerOperationsTabProps {
  refreshKey?: number;
}

const KIND_KEYS: Record<
  DoctorLedgerOperationKind,
  { labelKey: "docKindWithdraw" | "docKindSalary" | "docKindSalaryEntry" | "docKindExpenseDeduction" | "docKindAssistant" | "docKindBalanceTopUp"; color: string; icon: typeof ArrowDownToLine }
> = {
  withdrawal: {
    labelKey: "docKindWithdraw",
    color: "mc-tone-royal",
    icon: ArrowDownToLine,
  },
  salary_payout: {
    labelKey: "docKindSalary",
    color: "mc-tone-success",
    icon: Banknote,
  },
  salary_adjustment: {
    labelKey: "docKindSalaryEntry",
    color: "mc-tone-navy",
    icon: Banknote,
  },
  expense_deduction: {
    labelKey: "docKindExpenseDeduction",
    color: "mc-tone-warning",
    icon: Receipt,
  },
  payroll_deduction: {
    labelKey: "docKindAssistant",
    color: "mc-tone-muted",
    icon: Users,
  },
  balance_credit: {
    labelKey: "docKindBalanceTopUp",
    color: "mc-tone-success",
    icon: Banknote,
  },
};

export function DoctorLedgerOperationsTab({
  refreshKey = 0,
}: DoctorLedgerOperationsTabProps) {
  const { t, formatMoney, dateLocale } = useLanguage();
  const defaultRange = monthDateRange(currentMonthYear());
  const [dateFrom, setDateFrom] = useState(defaultRange.from);
  const [dateTo, setDateTo] = useState(defaultRange.to);
  const [rows, setRows] = useState<DoctorLedgerOperationRow[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    setError("");

    const params = new URLSearchParams({
      section: "operations",
      limit: "50",
    });
    if (dateFrom) params.set("date_from", dateFrom);
    if (dateTo) params.set("date_to", dateTo);

    try {
      const res = await fetch(`/api/doctor/financial-ledger?${params}`, {
        credentials: "include",
        headers: authPortalHeaders("doctor"),
      });
      const json = (await res.json()) as {
        rows?: DoctorLedgerOperationRow[];
        total?: number;
        error?: string;
      };

      if (!res.ok) {
        setError(json.error ?? t("docLoadOperationsFailed"));
        setRows([]);
        setTotal(0);
        return;
      }

      setRows(json.rows ?? []);
      setTotal(json.total ?? 0);
    } catch {
      setError(t("errServerConnection"));
    } finally {
      setLoading(false);
    }
  }, [dateFrom, dateTo, t]);

  useEffect(() => {
    void load();
  }, [load, refreshKey]);

  const totalOut = rows.reduce((s, r) => s + r.amount, 0);

  return (
    <div className="space-y-4">
      <p className="px-1 text-xs leading-relaxed text-slate-muted">{t("docLedgerOpsIntro")}</p>

      <section className="mc-panel">
        <p className="flex items-start gap-2 border-b border-slate-border bg-surface px-4 py-2.5 text-[11px] leading-relaxed text-slate-muted">
          <Info className="mt-0.5 h-3.5 w-3.5 shrink-0 text-premium-500" />
          {t("docLedgerDefaultMonthNote")}
        </p>
        <div className="grid grid-cols-2 gap-2.5 p-4">
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
            onChange={(e) => setDateTo(e.target.value)}
            dir="ltr"
            className="h-11 rounded-xl text-left"
          />
        </div>
        <div className="flex items-center justify-between gap-2 border-t border-slate-border bg-surface px-4 py-2.5">
          <p className="min-w-0 text-xs text-slate-muted">
            {t("docOperationsCountLabel")}{" "}
            <strong className="text-sm font-black tabular-nums text-slate-text">{total}</strong>
            {rows.length > 0 && (
              <span className="ms-2 font-semibold tabular-nums text-debt-text">
                — {t("docTotalLabel")} {formatMoney(totalOut)}
              </span>
            )}
          </p>
          <button
            type="button"
            onClick={() => void load()}
            className="mc-btn-soft min-h-[40px] shrink-0 px-3"
          >
            <RefreshCw className={cn("h-4 w-4", loading && "animate-spin")} />
            {t("refresh")}
          </button>
        </div>
      </section>

      {error && (
        <p className="flex items-center gap-2 rounded-2xl border border-debt-border bg-debt px-4 py-3 text-sm text-debt-text">
          <AlertCircle className="h-4 w-4 shrink-0" />
          {error}
        </p>
      )}

      {loading ? (
        <div className="space-y-2.5">
          {[1, 2, 3].map((i) => (
            <div key={i} className="mc-skeleton h-[72px] rounded-2xl" />
          ))}
        </div>
      ) : rows.length === 0 ? (
        <div className="flex flex-col items-center gap-2 rounded-2xl border border-dashed border-slate-border bg-surface-card px-4 py-10 text-center">
          <span className="mc-kpi__icon mc-tone-muted h-11 w-11">
            <ArrowDownToLine className="h-5 w-5" />
          </span>
          <p className="text-sm text-slate-muted">{t("docNoFinancialOps")}</p>
        </div>
      ) : (
        <div className="mc-panel divide-y divide-slate-border">
          {rows.map((row) => {
            const meta = KIND_KEYS[row.kind];
            const Icon = meta.icon;
            const isSalaryBonus =
              row.kind === "salary_adjustment" && row.status === "bonus";
            const showAsCredit =
              isSalaryBonus || row.kind === "balance_credit" || row.amount < 0;
            return (
              <div
                key={`${row.kind}-${row.id}`}
                className="flex min-h-[64px] items-center gap-3 px-4 py-3 transition-colors hover:bg-surface"
              >
                <span className={cn("mc-kpi__icon h-10 w-10 rounded-xl", meta.color)}>
                  <Icon className="h-4 w-4" />
                </span>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-bold text-slate-text">{row.label}</p>
                  <div className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[11px] text-slate-muted">
                    <span className="font-semibold">{t(meta.labelKey)}</span>
                    <span className="text-slate-border">•</span>
                    <span>{formatDate(row.operation_date, dateLocale)}</span>
                    {row.status === "pending" && (
                      <span className="mc-tone-warning inline-flex rounded-full px-1.5 py-px text-[10px] font-semibold ring-1 ring-inset">
                        {t("pendingShort")}
                      </span>
                    )}
                  </div>
                </div>
                <p
                  className={cn(
                    "shrink-0 text-base font-black tabular-nums",
                    showAsCredit ? "text-success-text" : "text-debt-text"
                  )}
                >
                  {showAsCredit ? "+" : "−"}
                  {formatMoney(Math.abs(row.amount))}
                </p>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
