"use client";

import { useCallback, useEffect, useState } from "react";
import { Input } from "@/components/ui/Input";
import { Button } from "@/components/ui/Button";
import { Card, CardHeader, CardTitle } from "@/components/ui/Card";
import { Alert } from "@/components/ui/Alert";
import { ProfitExplanationModal } from "@/components/finance/ProfitExplanationModal";
import { fetchProfitDeductionLedgerViaApi } from "@/lib/services/profit-ledger-api";
import type { ProfitDeductionLedger } from "@/lib/services/profit-deduction-ledger";
import {
  cn,
  currentMonthYear,
  formatCurrency,
  formatDate,
  monthDateRange,
  todayISO,
} from "@/lib/utils";
import { History, RefreshCw, Info } from "lucide-react";

const PRESETS = [
  { id: "month", label: "هذا الشهر" },
  { id: "prev", label: "الشهر الماضي" },
  { id: "quarter", label: "آخر 3 أشهر" },
  { id: "year", label: "هذه السنة" },
] as const;

function presetRange(id: (typeof PRESETS)[number]["id"]): { from: string; to: string } {
  const to = todayISO();
  const today = new Date();

  if (id === "month") {
    return monthDateRange(currentMonthYear());
  }

  if (id === "prev") {
    const d = new Date(today.getFullYear(), today.getMonth() - 1, 1);
    const my = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
    return monthDateRange(my);
  }

  if (id === "quarter") {
    const from = new Date(today);
    from.setMonth(today.getMonth() - 2);
    from.setDate(1);
    return {
      from: from.toISOString().slice(0, 10),
      to,
    };
  }

  return {
    from: `${today.getFullYear()}-01-01`,
    to,
  };
}

export function ClinicFinancialHistoryPanel({ mobile }: { mobile?: boolean }) {
  const defaultRange = monthDateRange(currentMonthYear());
  const [from, setFrom] = useState(defaultRange.from);
  const [to, setTo] = useState(defaultRange.to);
  const [appliedFrom, setAppliedFrom] = useState(defaultRange.from);
  const [appliedTo, setAppliedTo] = useState(defaultRange.to);
  const [ledger, setLedger] = useState<ProfitDeductionLedger | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [explainOpen, setExplainOpen] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await fetchProfitDeductionLedgerViaApi(
        appliedFrom,
        appliedTo,
        "admin"
      );
      setLedger(data);
    } catch (e) {
      setError(e instanceof Error ? e.message : "تعذر تحميل السجل");
      setLedger(null);
    } finally {
      setLoading(false);
    }
  }, [appliedFrom, appliedTo]);

  useEffect(() => {
    load();
  }, [load]);

  function applyRange() {
    const effectiveTo = to >= from ? to : from;
    setAppliedFrom(from);
    setAppliedTo(effectiveTo);
  }

  function applyPreset(id: (typeof PRESETS)[number]["id"]) {
    const range = presetRange(id);
    setFrom(range.from);
    setTo(range.to);
    setAppliedFrom(range.from);
    setAppliedTo(range.to);
  }

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <History className="h-5 w-5 text-primary" />
            سجل العمليات المالية للإدارة
          </CardTitle>
          <p className="mt-1 text-sm text-slate-muted">
            كل الصرفيات وأجور العمل السابقة والحالية — مع اسم المحاسب
          </p>
        </CardHeader>

        <div className="flex flex-wrap gap-2">
          {PRESETS.map((preset) => (
            <button
              key={preset.id}
              type="button"
              onClick={() => applyPreset(preset.id)}
              className="rounded-full border border-slate-border bg-surface px-3 py-1 text-xs font-medium text-slate-text hover:border-primary hover:bg-primary/5"
            >
              {preset.label}
            </button>
          ))}
        </div>

        <div
          className={cn(
            "mt-4 grid gap-3",
            mobile ? "grid-cols-1" : "grid-cols-[1fr_1fr_auto]"
          )}
        >
          <Input
            type="date"
            label="من تاريخ"
            value={from}
            onChange={(e) => setFrom(e.target.value)}
          />
          <Input
            type="date"
            label="إلى تاريخ"
            value={to}
            onChange={(e) => setTo(e.target.value)}
          />
          <div className={cn("flex gap-2", mobile ? "" : "items-end")}>
            <Button type="button" onClick={applyRange} className="w-full sm:w-auto">
              عرض
            </Button>
            <Button
              type="button"
              variant="outline"
              onClick={() => void load()}
              disabled={loading}
            >
              <RefreshCw className={cn("h-4 w-4", loading && "animate-spin")} />
            </Button>
          </div>
        </div>
      </Card>

      {error && <Alert variant="error">{error}</Alert>}

      {loading && (
        <p className="py-10 text-center text-sm text-slate-muted">
          جاري تحميل السجل المالي...
        </p>
      )}

      {ledger && !loading && (
        <>
          <Card premium>
            <CardHeader>
              <p className="text-sm leading-relaxed text-slate-text">
                {ledger.summaryAr}
              </p>
              <p className="mt-2 text-xs text-slate-muted">
                الفترة: {formatDate(ledger.from)} — {formatDate(ledger.to)}
              </p>
            </CardHeader>
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              <div className="rounded-xl border border-debt-border bg-debt/20 p-3 text-center">
                <p className="text-xs text-slate-muted">إجمالي الخصومات</p>
                <p className="text-lg font-black text-debt-text tabular-nums">
                  −{formatCurrency(ledger.totalDeductions)}
                </p>
              </div>
              <div className="rounded-xl border border-success-border bg-success/20 p-3 text-center">
                <p className="text-xs text-slate-muted">إضافات</p>
                <p className="text-lg font-black text-success-text tabular-nums">
                  +{formatCurrency(ledger.totalAdditions)}
                </p>
              </div>
              <div className="rounded-xl border border-slate-border bg-surface p-3 text-center col-span-2 sm:col-span-2">
                <p className="text-xs text-slate-muted">عدد العمليات</p>
                <p className="text-lg font-black text-slate-text tabular-nums">
                  {ledger.operationCount}
                </p>
              </div>
            </div>
          </Card>

          {ledger.groups.length === 0 ? (
            <Alert variant="info">لا توجد عمليات مالية في هذه الفترة.</Alert>
          ) : (
            <div className="space-y-3">
              {ledger.groups.map((group) => (
                <Card key={group.category} className="overflow-hidden p-0">
                  <div className="flex items-center justify-between border-b border-slate-border bg-surface-card px-4 py-3">
                    <div>
                      <p className="font-bold text-slate-text">{group.label}</p>
                      <p className="text-xs text-slate-muted">
                        {group.lines.length} عملية
                      </p>
                    </div>
                    <p className="font-bold tabular-nums text-debt-text">
                      −{formatCurrency(group.totalDeduction || group.totalAddition)}
                    </p>
                  </div>
                  <ul className="divide-y divide-slate-border/50">
                    {group.lines.map((line) => (
                      <li
                        key={line.id}
                        className="flex flex-col gap-1 px-4 py-3 sm:flex-row sm:items-center sm:justify-between"
                      >
                        <div className="min-w-0">
                          <p className="font-medium text-slate-text">{line.title}</p>
                          {line.subtitle && (
                            <p className="text-xs text-slate-muted">{line.subtitle}</p>
                          )}
                          <p className="text-[11px] text-slate-muted/80">
                            {formatDate(line.date)}
                          </p>
                        </div>
                        <p
                          className={cn(
                            "shrink-0 font-bold tabular-nums",
                            line.amount >= 0 ? "text-success-text" : "text-debt-text"
                          )}
                        >
                          {line.amount >= 0 ? "+" : "−"}
                          {formatCurrency(Math.abs(line.amount))}
                        </p>
                      </li>
                    ))}
                  </ul>
                </Card>
              ))}
            </div>
          )}

          <Button
            type="button"
            variant="outline"
            className="w-full"
            onClick={() => setExplainOpen(true)}
          >
            <Info className="h-4 w-4" />
            عرض توضيح الربح التفصيلي
          </Button>

          <ProfitExplanationModal
            open={explainOpen}
            onClose={() => setExplainOpen(false)}
            from={appliedFrom}
            to={appliedTo}
            portal="admin"
          />
        </>
      )}
    </div>
  );
}
