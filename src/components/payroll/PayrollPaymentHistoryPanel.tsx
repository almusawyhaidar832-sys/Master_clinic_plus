"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { Input } from "@/components/ui/Input";
import { Select } from "@/components/ui/Select";
import { Button } from "@/components/ui/Button";
import { Card, CardHeader, CardTitle } from "@/components/ui/Card";
import { Alert } from "@/components/ui/Alert";
import { DataTable, type Column } from "@/components/ui/DataTable";
import { createClient } from "@/lib/supabase/client";
import { useActiveClinicId } from "@/hooks/useActiveClinicId";
import {
  fetchActivePayrollPersonsViaApi,
  payrollCategoryLabel,
  payrollPersonKey,
  type PayrollEmployeeCategory,
  type PayrollPerson,
} from "@/lib/services/payroll-persons";
import {
  fetchPayrollPaymentHistory,
  payrollHistoryCategoryLabel,
  payrollHistoryKindBadge,
  type PayrollHistoryFilter,
  type PayrollHistoryRow,
} from "@/lib/services/payroll-payment-history";
import { cn, currentMonthYear, formatCurrency, formatDate, monthDateRange } from "@/lib/utils";
import { History, RefreshCw, Wallet } from "lucide-react";

const KIND_TABS: { id: PayrollHistoryFilter; label: string }[] = [
  { id: "all", label: "الكل" },
  { id: "confirmed", label: "صرف مؤكّد" },
  { id: "daily_wage", label: "أجور يومية" },
];

const CATEGORY_OPTIONS: { value: PayrollEmployeeCategory | "all"; label: string }[] = [
  { value: "all", label: "كل الفئات" },
  { value: "assistant", label: "مساعد" },
  { value: "general", label: "موظف" },
  { value: "accountant", label: "محاسب" },
  { value: "doctor_salary", label: "طبيب — راتب" },
];

function buildPersonOptions(persons: PayrollPerson[]) {
  return persons.map((p) => ({
    value: payrollPersonKey(p),
    label: `${p.full_name_ar} — ${payrollCategoryLabel(p.category)}`,
  }));
}

export function PayrollPaymentHistoryPanel() {
  const { clinicId, loading: clinicLoading } = useActiveClinicId();
  const defaultMonth = currentMonthYear();
  const defaultRange = monthDateRange(defaultMonth);

  const [from, setFrom] = useState(defaultRange.from);
  const [to, setTo] = useState(defaultRange.to);
  const [personKey, setPersonKey] = useState("");
  const [category, setCategory] = useState<PayrollEmployeeCategory | "all">("all");
  const [kindFilter, setKindFilter] = useState<PayrollHistoryFilter>("all");
  const [persons, setPersons] = useState<PayrollPerson[]>([]);
  const [rows, setRows] = useState<PayrollHistoryRow[]>([]);
  const [totals, setTotals] = useState({
    confirmedPayouts: 0,
    dailyWageEntries: 0,
    entryCount: 0,
  });
  const [loading, setLoading] = useState(true);

  const loadPersons = useCallback(async () => {
    if (!clinicId) {
      setPersons([]);
      return;
    }
    try {
      const list = await fetchActivePayrollPersonsViaApi(clinicId);
      setPersons(list);
    } catch {
      setPersons([]);
    }
  }, [clinicId]);

  const loadHistory = useCallback(async () => {
    if (!clinicId) {
      setRows([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    const supabase = createClient();
    const result = await fetchPayrollPaymentHistory(supabase, clinicId, {
      from,
      to,
      personKey: personKey || undefined,
      category,
      kindFilter,
    });
    setRows(result.rows);
    setTotals(result.totals);
    setLoading(false);
  }, [clinicId, from, to, personKey, category, kindFilter]);

  useEffect(() => {
    if (clinicLoading) return;
    void loadPersons();
  }, [loadPersons, clinicLoading]);

  useEffect(() => {
    if (clinicLoading) return;
    void loadHistory();
  }, [loadHistory, clinicLoading]);

  const columns: Column<PayrollHistoryRow>[] = useMemo(
    () => [
      {
        key: "date",
        header: "التاريخ",
        render: (row) => (
          <span className="tabular-nums">{formatDate(row.date)}</span>
        ),
      },
      {
        key: "person",
        header: "الموظف / المساعد",
        render: (row) => (
          <div>
            <p className="font-semibold text-slate-text">{row.personName}</p>
            <p className="text-xs text-slate-muted">
              {payrollHistoryCategoryLabel(row.personCategory)}
            </p>
          </div>
        ),
      },
      {
        key: "label",
        header: "نوع الحركة",
        render: (row) => {
          const badge = payrollHistoryKindBadge(row);
          return (
            <div>
              <span
                className={cn(
                  "inline-flex rounded-full px-2 py-0.5 text-[11px] font-medium",
                  badge.className
                )}
              >
                {badge.label}
              </span>
              <p className="mt-1 text-xs text-slate-muted">{row.label}</p>
            </div>
          );
        },
      },
      {
        key: "amount",
        header: "المبلغ",
        render: (row) => (
          <span
            className={cn(
              "font-bold tabular-nums",
              row.kind === "confirmed_payout"
                ? "text-success-text"
                : row.entryType === "deduction" || row.entryType === "absence"
                  ? "text-debt-text"
                  : "text-slate-text"
            )}
          >
            {formatCurrency(row.amount)}
          </span>
        ),
      },
      {
        key: "month",
        header: "الشهر",
        render: (row) => row.monthYear ?? "—",
      },
      {
        key: "notes",
        header: "ملاحظات",
        render: (row) => (
          <span className="text-xs text-slate-muted">{row.notes ?? "—"}</span>
        ),
      },
    ],
    []
  );

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h2 className="flex items-center gap-2 text-2xl font-bold tracking-tight text-slate-text">
            <span className="mc-icon-badge-primary">
              <History className="h-5 w-5" />
            </span>
            سجل صرف الرواتب
          </h2>
          <p className="mc-page-subtitle">
            تاريخي — كل موظف أو مساعد نُصرف له راتب أو أجر يومي
          </p>
        </div>
        <Link
          href="/dashboard/salary"
          className="inline-flex items-center gap-1 text-sm font-semibold text-primary hover:underline"
        >
          <Wallet className="h-4 w-4" />
          صرف رواتب الشهر
        </Link>
      </div>

      <Card>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          <Input
            label="من تاريخ"
            type="date"
            value={from}
            onChange={(e) => setFrom(e.target.value)}
            dir="ltr"
            className="text-left"
          />
          <Input
            label="إلى تاريخ"
            type="date"
            value={to}
            onChange={(e) => setTo(e.target.value)}
            dir="ltr"
            className="text-left"
          />
          <Select
            label="الموظف / المساعد"
            value={personKey}
            onChange={(e) => setPersonKey(e.target.value)}
            placeholder="الكل"
            options={buildPersonOptions(persons)}
          />
          <Select
            label="الفئة"
            value={category}
            onChange={(e) =>
              setCategory(e.target.value as PayrollEmployeeCategory | "all")
            }
            options={CATEGORY_OPTIONS.map((o) => ({
              value: o.value,
              label: o.label,
            }))}
          />
          <div className="flex items-end sm:col-span-2">
            <Button
              type="button"
              onClick={() => void loadHistory()}
              disabled={loading}
            >
              <RefreshCw className={cn("h-4 w-4", loading && "animate-spin")} />
              <span className="mr-2">تحديث</span>
            </Button>
          </div>
        </div>

        <div className="mt-4 flex flex-wrap gap-2">
          {KIND_TABS.map((tab) => (
            <button
              key={tab.id}
              type="button"
              onClick={() => setKindFilter(tab.id)}
              className={cn(
                "rounded-full px-4 py-1.5 text-sm font-medium transition-colors",
                kindFilter === tab.id
                  ? "bg-primary text-white"
                  : "bg-surface text-slate-muted hover:bg-surface/80"
              )}
            >
              {tab.label}
            </button>
          ))}
        </div>
      </Card>

      {!loading && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">ملخص الفترة</CardTitle>
          </CardHeader>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            <div className="rounded-xl border border-emerald-200 bg-emerald-50/50 p-4 text-center">
              <p className="text-xl font-bold tabular-nums text-emerald-800">
                {formatCurrency(totals.confirmedPayouts)}
              </p>
              <p className="text-xs text-slate-muted">إجمالي الصرف المؤكّد</p>
            </div>
            <div className="rounded-xl border border-sky-200 bg-sky-50/50 p-4 text-center">
              <p className="text-xl font-bold tabular-nums text-sky-800">
                {formatCurrency(totals.dailyWageEntries)}
              </p>
              <p className="text-xs text-slate-muted">أجور يومية مسجّلة</p>
            </div>
            <div className="rounded-xl border border-slate-border bg-surface p-4 text-center">
              <p className="text-xl font-bold tabular-nums text-slate-text">
                {totals.entryCount}
              </p>
              <p className="text-xs text-slate-muted">عدد الحركات</p>
            </div>
          </div>
        </Card>
      )}

      {loading ? (
        <div className="space-y-2">
          {[1, 2, 3, 4].map((i) => (
            <div key={i} className="h-12 animate-pulse rounded-xl bg-surface" />
          ))}
        </div>
      ) : rows.length === 0 ? (
        <Alert variant="info">
          لا توجد حركات صرف أو أجور في هذه الفترة
          {personKey ? " لهذا الموظف" : ""}.
        </Alert>
      ) : (
        <DataTable
          columns={columns}
          data={rows}
          emptyMessage="لا توجد حركات"
        />
      )}
    </div>
  );
}
