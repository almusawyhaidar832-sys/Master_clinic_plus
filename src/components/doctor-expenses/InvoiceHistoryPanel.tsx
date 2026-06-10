"use client";

import { useCallback, useEffect, useState } from "react";
import { Input } from "@/components/ui/Input";
import { Select } from "@/components/ui/Select";
import { DataTable, type Column } from "@/components/ui/DataTable";
import { authPortalHeaders } from "@/lib/auth/api-portal";
import { cn, formatCurrency, formatDate } from "@/lib/utils";
import type { InvoiceHistoryRow } from "@/lib/services/invoice-archive";
import { History, RefreshCw } from "lucide-react";

interface DoctorOption {
  id: string;
  full_name_ar: string;
}

interface InvoiceHistoryPanelProps {
  clinicId: string | null;
  doctors: DoctorOption[];
  refreshKey?: number;
}

export function InvoiceHistoryPanel({
  clinicId,
  doctors,
  refreshKey = 0,
}: InvoiceHistoryPanelProps) {
  const [doctorId, setDoctorId] = useState("");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [rows, setRows] = useState<InvoiceHistoryRow[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    if (!clinicId) {
      setRows([]);
      setTotal(0);
      return;
    }

    setLoading(true);
    setError("");

    const params = new URLSearchParams({ limit: "100" });
    if (doctorId) params.set("doctor_id", doctorId);
    if (dateFrom) params.set("date_from", dateFrom);
    if (dateTo) params.set("date_to", dateTo);

    try {
      const res = await fetch(`/api/invoices/history?${params}`, {
        credentials: "include",
        headers: authPortalHeaders("accountant"),
      });
      const json = (await res.json()) as {
        rows?: InvoiceHistoryRow[];
        total?: number;
        error?: string;
      };

      if (!res.ok) {
        setError(json.error ?? "تعذر تحميل السجل");
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
  }, [clinicId, doctorId, dateFrom, dateTo]);

  useEffect(() => {
    void load();
  }, [load, refreshKey]);

  const columns: Column<InvoiceHistoryRow>[] = [
    {
      key: "date",
      header: "التاريخ",
      render: (row) => formatDate(row.invoice_date),
    },
    {
      key: "invoice",
      header: "رقم الفاتورة",
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
            صرفية عيادة
          </span>
        ) : (
          <span className="rounded-full bg-primary/10 px-2 py-0.5 text-xs font-medium text-primary">
            جلسة
          </span>
        ),
    },
    {
      key: "doctor",
      header: "الطبيب",
      render: (row) => row.doctor_name_ar || "—",
    },
    {
      key: "procedure",
      header: "البيان",
      render: (row) => (
        <span className="text-slate-700">{row.procedure_label}</span>
      ),
    },
    {
      key: "paid",
      header: "المبلغ",
      render: (row) => (
        <span className="font-bold text-primary tabular-nums">
          {formatCurrency(row.paid_amount)}
        </span>
      ),
    },
    {
      key: "doctor_share",
      header: "حصة الطبيب",
      render: (row) => (
        <span className="tabular-nums text-red-600">
          {formatCurrency(row.doctor_share)}
        </span>
      ),
    },
  ];

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h2 className="flex items-center gap-2 text-lg font-bold text-slate-800">
            <History className="h-5 w-5 text-primary" />
            السجل التاريخي
          </h2>
          <p className="text-sm text-slate-500">
            فواتير الجلسات + صرفيات العيادة + رواتب الأطباء — فلترة حسب الطبيب
            والتاريخ
          </p>
        </div>
        <button
          type="button"
          onClick={() => void load()}
          className="flex items-center gap-1 rounded-lg border border-slate-200 px-3 py-1.5 text-sm text-slate-600 hover:bg-slate-50"
        >
          <RefreshCw className={cn("h-4 w-4", loading && "animate-spin")} />
          تحديث
        </button>
      </div>

      <div className="grid gap-3 sm:grid-cols-3">
        <Select
          label="الطبيب"
          name="history_doctor"
          value={doctorId}
          onChange={(e) => setDoctorId(e.target.value)}
          options={[
            { value: "", label: "— كل الأطباء —" },
            ...doctors.map((d) => ({
              value: d.id,
              label: d.full_name_ar,
            })),
          ]}
        />
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

      {error && (
        <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-600">
          {error}
        </p>
      )}

      <p className="text-sm text-slate-600">
        إجمالي النتائج: <strong>{total}</strong>
      </p>

      {loading ? (
        <div className="flex justify-center py-12">
          <RefreshCw className="h-6 w-6 animate-spin text-primary" />
        </div>
      ) : (
        <DataTable
          columns={columns}
          data={rows}
          emptyMessage={
            doctorId
              ? "لا توجد سجلات لهذا الطبيب في الفترة المحددة"
              : "لا توجد سجلات — أضف فاتورة صرف أو اعتمد فاتورة جلسة"
          }
        />
      )}
    </div>
  );
}
