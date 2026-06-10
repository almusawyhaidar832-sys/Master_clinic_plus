"use client";

import { useCallback, useEffect, useState } from "react";
import { Input } from "@/components/ui/Input";
import { DataTable, type Column } from "@/components/ui/DataTable";
import { authPortalHeaders } from "@/lib/auth/api-portal";
import { cn, formatCurrency, formatDate } from "@/lib/utils";
import type { DoctorLedgerInvoiceRow } from "@/lib/services/doctor-financial-ledger";
import { RefreshCw } from "lucide-react";

function invoiceStatement(row: DoctorLedgerInvoiceRow): string {
  const label = row.procedure_label?.trim();
  if (label && label !== "—") return label;
  const treatment = row.treatment_name?.trim();
  if (treatment) return treatment;
  return row.record_kind === "doctor_expense" ? "صرفية عيادة" : "—";
}

interface DoctorLedgerInvoicesTabProps {
  refreshKey?: number;
}

export function DoctorLedgerInvoicesTab({
  refreshKey = 0,
}: DoctorLedgerInvoicesTabProps) {
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [rows, setRows] = useState<DoctorLedgerInvoiceRow[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    setError("");

    const params = new URLSearchParams({
      section: "invoices",
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
        rows?: DoctorLedgerInvoiceRow[];
        total?: number;
        error?: string;
      };

      if (!res.ok) {
        setError(json.error ?? "تعذر تحميل الفواتير");
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

  const columns: Column<DoctorLedgerInvoiceRow>[] = [
    {
      key: "date",
      header: "التاريخ",
      render: (row) => formatDate(row.invoice_date),
    },
    {
      key: "invoice",
      header: "الفاتورة",
      render: (row) => (
        <span className="font-mono text-xs" dir="ltr">
          {row.invoice_number}
        </span>
      ),
    },
    {
      key: "type",
      header: "النوع",
      render: (row) =>
        row.record_kind === "doctor_expense" ? (
          <span className="rounded-full bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-800">
            صرفية
          </span>
        ) : (
          <span className="rounded-full bg-primary/10 px-2 py-0.5 text-xs font-medium text-primary">
            جلسة
          </span>
        ),
    },
    {
      key: "statement",
      header: "البيان",
      render: (row) => (
        <span className="text-slate-700">{invoiceStatement(row)}</span>
      ),
    },
    {
      key: "amount",
      header: "مبلغ الفاتورة",
      render: (row) => (
        <span className="font-semibold text-primary tabular-nums">
          {formatCurrency(
            row.total_amount > 0 ? row.total_amount : row.paid_amount
          )}
        </span>
      ),
    },
    {
      key: "share",
      header: "حصتك",
      render: (row) => (
        <span
          className={cn(
            "font-bold tabular-nums",
            row.record_kind === "doctor_expense"
              ? "text-red-600"
              : "text-emerald-600"
          )}
        >
          {row.record_kind === "doctor_expense" ? "−" : ""}
          {formatCurrency(row.doctor_share)}
        </span>
      ),
    },
  ];

  return (
    <div className="space-y-4">
      <p className="text-sm text-slate-muted">
        فواتير معتمدة من المحاسب فقط (رقم فاتورة) — جلسات وصرفيات
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
          النتائج: <strong>{total}</strong>
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
      ) : (
        <DataTable
          columns={columns}
          data={rows}
          emptyMessage="لا توجد فواتير معتمدة في الفترة المحددة"
        />
      )}
    </div>
  );
}
