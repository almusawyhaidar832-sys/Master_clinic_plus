"use client";

import { useCallback, useEffect, useState } from "react";
import { Input } from "@/components/ui/Input";
import { DataTable, type Column } from "@/components/ui/DataTable";
import { authPortalHeaders } from "@/lib/auth/api-portal";
import { useLanguage } from "@/contexts/LanguageContext";
import { cn, formatDate } from "@/lib/utils";
import type { DoctorLedgerInvoiceRow } from "@/lib/services/doctor-financial-ledger";
import { truncateLabNotes } from "@/lib/invoices/lab-session-details";
import { RefreshCw } from "lucide-react";
import { DoctorExpenseInvoiceViewer } from "@/components/doctor-expenses/DoctorExpenseInvoiceViewer";

function invoiceStatement(row: DoctorLedgerInvoiceRow): string {
  const label = row.procedure_label?.trim();
  if (label && label !== "—") return label;
  const treatment = row.treatment_name?.trim();
  if (treatment && treatment !== "صرفية") return treatment;
  return row.record_kind === "doctor_expense" ? row.patient_name_ar : "—";
}

interface DoctorLedgerInvoicesTabProps {
  refreshKey?: number;
}

export function DoctorLedgerInvoicesTab({
  refreshKey = 0,
}: DoctorLedgerInvoicesTabProps) {
  const { t, formatMoney, dateLocale } = useLanguage();
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
        setError(json.error ?? t("docLoadInvoicesFailed"));
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

  const columns: Column<DoctorLedgerInvoiceRow>[] = [
    {
      key: "date",
      header: t("docColDate"),
      render: (row) => formatDate(row.invoice_date, dateLocale),
    },
    {
      key: "invoice",
      header: t("docColInvoice"),
      render: (row) => (
        <span className="font-mono text-xs" dir="ltr">
          {row.invoice_number}
        </span>
      ),
    },
    {
      key: "type",
      header: t("docColType"),
      render: (row) =>
        row.record_kind === "doctor_expense" ? (
          <span className="rounded-full bg-orange-100 px-2 py-0.5 text-xs font-medium text-orange-900">
            {/مختبر|lab/i.test(row.procedure_label)
              ? "مختبر"
              : t("docKindDoctorExpenseShort")}
          </span>
        ) : (
          <span className="rounded-full bg-primary/10 px-2 py-0.5 text-xs font-medium text-primary">
            {t("docKindSession")}
          </span>
        ),
    },
    {
      key: "statement",
      header: t("docColDescription"),
      render: (row) => (
        <div className="text-slate-700">
          <span>
            {row.record_kind === "doctor_expense"
              ? invoiceStatement(row)
              : `${row.patient_name_ar} — ${invoiceStatement(row)}`}
          </span>
          {row.record_kind === "doctor_expense" &&
          row.expense_percentage_split != null ? (
            <span className="mt-0.5 block text-[10px] text-slate-500">
              نسبتك {Math.round(row.expense_percentage_split)}% — إجمالي{" "}
              {formatMoney(row.total_amount)}
            </span>
          ) : null}
          {row.record_kind !== "doctor_expense" && row.lab_notes ? (
            <span className="mt-0.5 block text-[10px] text-slate-500">
              {truncateLabNotes(row.lab_notes, 48)}
            </span>
          ) : null}
        </div>
      ),
    },
    {
      key: "lab",
      header: t("docColLabCost"),
      render: (row) =>
        row.materials_cost > 0 ? (
          <span className="tabular-nums text-amber-800">
            {formatMoney(row.materials_cost)}
          </span>
        ) : (
          <span className="text-slate-400">—</span>
        ),
    },
    {
      key: "amount",
      header: t("docColInvoiceAmount"),
      render: (row) => (
        <span className="font-semibold text-primary tabular-nums">
          {formatMoney(
            row.total_amount > 0 ? row.total_amount : row.paid_amount
          )}
        </span>
      ),
    },
    {
      key: "attachment",
      header: t("docColAttachment"),
      render: (row) => {
        if (!row.has_invoice_attachment || !row.doctor_expense_id) {
          return <span className="text-slate-400">—</span>;
        }
        return (
          <DoctorExpenseInvoiceViewer
            expenseId={row.doctor_expense_id}
            fileName={row.invoice_file_name}
            portal="doctor"
          />
        );
      },
    },
    {
      key: "share",
      header: t("docColYourShare"),
      render: (row) => (
        <div className="text-right">
          <span
            className={cn(
              "font-bold tabular-nums",
              row.record_kind === "doctor_expense"
                ? "text-red-600"
                : "text-emerald-600"
            )}
          >
            {row.record_kind === "doctor_expense" ? "−" : ""}
            {formatMoney(row.doctor_share)}
          </span>
          {row.record_kind === "doctor_expense" &&
            row.expense_percentage_split != null && (
              <p className="text-[10px] text-slate-muted">
                {Math.round(row.expense_percentage_split)}%
              </p>
            )}
        </div>
      ),
    },
  ];

  return (
    <div className="space-y-4">
      <p className="text-sm text-slate-muted">{t("docLedgerInvoicesIntro")}</p>

      <div className="grid gap-3 sm:grid-cols-2">
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
          onChange={(e) => setDateTo(e.target.value)}
          dir="ltr"
          className="text-left"
        />
      </div>

      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm text-slate-600">
          {t("docResultsCount")} <strong>{total}</strong>
        </p>
        <button
          type="button"
          onClick={() => void load()}
          className="flex items-center gap-1 rounded-lg border border-slate-border px-3 py-1.5 text-sm text-slate-muted hover:bg-surface-card"
        >
          <RefreshCw className={cn("h-4 w-4", loading && "animate-spin")} />
          {t("refresh")}
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
          emptyMessage={t("docNoInvoicesInPeriod")}
        />
      )}
    </div>
  );
}
