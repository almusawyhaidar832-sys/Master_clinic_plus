"use client";

import { useCallback, useEffect, useState } from "react";
import { Input } from "@/components/ui/Input";
import { authPortalHeaders } from "@/lib/auth/api-portal";
import { cn, formatCurrency, formatDate } from "@/lib/utils";
import type {
  DoctorLedgerOperationKind,
  DoctorLedgerOperationRow,
} from "@/lib/services/doctor-financial-ledger";
import {
  RefreshCw,
  ArrowDownToLine,
  Banknote,
  Receipt,
  Users,
} from "lucide-react";

interface DoctorLedgerOperationsTabProps {
  refreshKey?: number;
}

const KIND_META: Record<
  DoctorLedgerOperationKind,
  { label: string; color: string; icon: typeof ArrowDownToLine }
> = {
  withdrawal: {
    label: "سحب",
    color: "bg-violet-100 text-violet-800",
    icon: ArrowDownToLine,
  },
  salary_payout: {
    label: "راتب",
    color: "bg-emerald-100 text-emerald-800",
    icon: Banknote,
  },
  expense_deduction: {
    label: "خصم صرفية",
    color: "bg-amber-100 text-amber-800",
    icon: Receipt,
  },
  payroll_deduction: {
    label: "مساعد",
    color: "bg-slate-100 text-slate-700",
    icon: Users,
  },
};

export function DoctorLedgerOperationsTab({
  refreshKey = 0,
}: DoctorLedgerOperationsTabProps) {
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [rows, setRows] = useState<DoctorLedgerOperationRow[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    setError("");

    const params = new URLSearchParams({
      section: "operations",
      limit: "100",
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
        setError(json.error ?? "تعذر تحميل العمليات");
        setRows([]);
        setTotal(0);
        return;
      }

      setRows(json.rows ?? []);
      setTotal(json.total ?? 0);
    } catch {
      setError("تعذر الاتصال بالسيرفر");
    } finally {
      setLoading(false);
    }
  }, [dateFrom, dateTo]);

  useEffect(() => {
    void load();
  }, [load, refreshKey]);

  const totalOut = rows.reduce((s, r) => s + r.amount, 0);

  return (
    <div className="space-y-4">
      <p className="text-sm text-slate-muted">
        سحوباتك ورواتبك وخصومات المساعدين — صرفيات العيادة في تبويب الفواتير
      </p>

      <div className="grid gap-3 sm:grid-cols-2">
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
          onChange={(e) => setDateTo(e.target.value)}
          dir="ltr"
          className="text-left"
        />
      </div>

      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm text-slate-600">
          العمليات: <strong>{total}</strong>
          {rows.length > 0 && (
            <span className="mr-2 text-red-600">
              — إجمالي: {formatCurrency(totalOut)}
            </span>
          )}
        </p>
        <button
          type="button"
          onClick={() => void load()}
          className="flex items-center gap-1 rounded-lg border border-slate-border px-3 py-1.5 text-sm text-slate-muted hover:bg-surface-card"
        >
          <RefreshCw className={cn("h-4 w-4", loading && "animate-spin")} />
          تحديث
        </button>
      </div>

      {error && (
        <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-600">
          {error}
        </p>
      )}

      {loading ? (
        <div className="flex justify-center py-12">
          <RefreshCw className="h-6 w-6 animate-spin text-primary" />
        </div>
      ) : rows.length === 0 ? (
        <div className="rounded-xl border border-dashed border-slate-border p-8 text-center text-sm text-slate-muted">
          لا توجد عمليات مالية في الفترة المحددة
        </div>
      ) : (
        <div className="space-y-2">
          {rows.map((row) => {
            const meta = KIND_META[row.kind];
            const Icon = meta.icon;
            return (
              <div
                key={`${row.kind}-${row.id}`}
                className="flex items-start justify-between gap-3 rounded-xl border border-slate-border bg-surface-card p-3"
              >
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span
                      className={cn(
                        "inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium",
                        meta.color
                      )}
                    >
                      <Icon className="h-3 w-3" />
                      {meta.label}
                    </span>
                    {row.status === "pending" && (
                      <span className="text-xs text-amber-600">معلّق</span>
                    )}
                  </div>
                  <p className="mt-1 text-sm text-slate-text">{row.label}</p>
                  <p className="text-xs text-slate-muted">
                    {formatDate(row.operation_date)}
                  </p>
                </div>
                <p className="shrink-0 text-lg font-bold text-red-600 tabular-nums">
                  −{formatCurrency(row.amount)}
                </p>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
