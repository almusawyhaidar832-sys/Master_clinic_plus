"use client";

import { useCallback, useEffect, useState } from "react";
import { Input } from "@/components/ui/Input";
import { DataTable, type Column } from "@/components/ui/DataTable";
import { authPortalHeaders } from "@/lib/auth/api-portal";
import { useLanguage } from "@/contexts/LanguageContext";
import { cn, formatDate } from "@/lib/utils";
import type { DoctorLedgerInvoiceRow } from "@/lib/services/doctor-financial-ledger";
import { truncateLabNotes } from "@/lib/invoices/lab-session-details";
import { AlertCircle, FileText, Receipt, RefreshCw, Stethoscope } from "lucide-react";
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

  const typeBadge = (row: DoctorLedgerInvoiceRow) =>
    row.record_kind === "doctor_expense" ? (
      <span className="mc-tone-warning inline-flex rounded-full px-2 py-0.5 text-[11px] font-semibold ring-1 ring-inset">
        {/مختبر|lab/i.test(row.procedure_label)
          ? "مختبر"
          : t("docKindDoctorExpenseShort")}
      </span>
    ) : (
      <span className="mc-tone-navy inline-flex rounded-full px-2 py-0.5 text-[11px] font-semibold ring-1 ring-inset">
        {t("docKindSession")}
      </span>
    );

  const descriptionCell = (row: DoctorLedgerInvoiceRow) => (
    <div className="text-slate-text">
      <span>
        {row.record_kind === "doctor_expense"
          ? invoiceStatement(row)
          : `${row.patient_name_ar} — ${invoiceStatement(row)}`}
      </span>
      {row.record_kind === "doctor_expense" &&
      row.expense_percentage_split != null ? (
        <span className="mt-0.5 block text-[10px] font-normal text-slate-muted">
          نسبتك {Math.round(row.expense_percentage_split)}% — إجمالي{" "}
          {formatMoney(row.total_amount)}
        </span>
      ) : null}
      {row.record_kind !== "doctor_expense" && row.lab_notes ? (
        <span className="mt-0.5 block text-[10px] font-normal text-slate-muted">
          {truncateLabNotes(row.lab_notes, 48)}
        </span>
      ) : null}
    </div>
  );

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
      render: (row) => typeBadge(row),
    },
    {
      key: "statement",
      header: t("docColDescription"),
      render: (row) => descriptionCell(row),
    },
    {
      key: "lab",
      header: t("docColLabCost"),
      render: (row) =>
        row.materials_cost > 0 ? (
          <span className="tabular-nums text-warning-text">
            {formatMoney(row.materials_cost)}
          </span>
        ) : (
          <span className="text-slate-muted">—</span>
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
          return <span className="text-slate-muted">—</span>;
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
        <div className="text-end">
          <span
            className={cn(
              "font-bold tabular-nums",
              row.record_kind === "doctor_expense"
                ? "text-debt-text"
                : "text-success-text"
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
      <p className="px-1 text-xs leading-relaxed text-slate-muted">{t("docLedgerInvoicesIntro")}</p>

      <section className="mc-panel">
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
          <p className="text-xs text-slate-muted">
            {t("docResultsCount")}{" "}
            <strong className="text-sm font-black tabular-nums text-slate-text">{total}</strong>
          </p>
          <button
            type="button"
            onClick={() => void load()}
            className="mc-btn-soft min-h-[40px] px-3"
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
            <div key={i} className="mc-skeleton h-20 rounded-2xl" />
          ))}
        </div>
      ) : (
        <>
          <div className="space-y-2.5 sm:hidden">
            {rows.length === 0 ? (
              <div className="flex flex-col items-center gap-2 rounded-2xl border border-dashed border-slate-border bg-surface-card px-4 py-10 text-center">
                <span className="mc-kpi__icon mc-tone-muted h-11 w-11">
                  <FileText className="h-5 w-5" />
                </span>
                <p className="text-sm text-slate-muted">{t("docNoInvoicesInPeriod")}</p>
              </div>
            ) : (
              rows.map((row) => {
                const isExpense = row.record_kind === "doctor_expense";
                return (
                  <div key={row.id} className="mc-list-row !items-start gap-3 !p-3.5">
                    <span
                      className={cn(
                        "mc-kpi__icon h-10 w-10 rounded-xl",
                        isExpense ? "mc-tone-warning" : "mc-tone-navy"
                      )}
                    >
                      {isExpense ? (
                        <Receipt className="h-4 w-4" />
                      ) : (
                        <Stethoscope className="h-4 w-4" />
                      )}
                    </span>
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-1.5">
                        {typeBadge(row)}
                        <span className="font-mono text-[11px] text-slate-muted" dir="ltr">
                          {row.invoice_number}
                        </span>
                      </div>
                      <div className="mt-1 text-sm font-semibold leading-snug">
                        {descriptionCell(row)}
                      </div>
                      <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-slate-muted">
                        <span>{formatDate(row.invoice_date, dateLocale)}</span>
                        {row.materials_cost > 0 && (
                          <span>
                            {t("docColLabCost")}:{" "}
                            <span className="font-semibold tabular-nums text-warning-text">
                              {formatMoney(row.materials_cost)}
                            </span>
                          </span>
                        )}
                        {row.has_invoice_attachment && row.doctor_expense_id && (
                          <DoctorExpenseInvoiceViewer
                            expenseId={row.doctor_expense_id}
                            fileName={row.invoice_file_name}
                            portal="doctor"
                          />
                        )}
                      </div>
                    </div>
                    <div className="shrink-0 text-end">
                      <p className="text-[10px] text-slate-muted">{t("docColYourShare")}</p>
                      <p
                        className={cn(
                          "text-sm font-black tabular-nums",
                          isExpense ? "text-debt-text" : "text-success-text"
                        )}
                      >
                        {isExpense ? "−" : ""}
                        {formatMoney(row.doctor_share)}
                      </p>
                      <p className="mt-1 text-[10px] text-slate-muted">{t("docColInvoiceAmount")}</p>
                      <p className="text-xs font-semibold tabular-nums text-slate-text">
                        {formatMoney(
                          row.total_amount > 0 ? row.total_amount : row.paid_amount
                        )}
                      </p>
                    </div>
                  </div>
                );
              })
            )}
          </div>
          <div className="hidden sm:block">
            <DataTable
              columns={columns}
              data={rows}
              emptyMessage={t("docNoInvoicesInPeriod")}
            />
          </div>
        </>
      )}
    </div>
  );
}
