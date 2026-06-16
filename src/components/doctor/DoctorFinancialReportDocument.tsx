"use client";

import type { DoctorFinancialReportData } from "@/lib/services/doctor-financial-ledger";
import { truncateLabNotes } from "@/lib/invoices/lab-session-details";
import { ClinicBrandingHeader } from "@/components/branding/ClinicBrandingHeader";
import { useClinicProfile } from "@/contexts/ClinicProfileContext";
import { useLanguage } from "@/contexts/LanguageContext";
import { formatDate } from "@/lib/utils";

export const DOCTOR_FINANCIAL_REPORT_PRINT_ID = "doctor-financial-report-print";

interface DoctorFinancialReportDocumentProps {
  report: DoctorFinancialReportData;
  printId?: string;
}

function ReportTable({
  headers,
  rows,
  emptyMessage,
}: {
  headers: string[];
  rows: string[][];
  emptyMessage: string;
}) {
  if (!rows.length) {
    return <p className="text-sm text-slate-500">{emptyMessage}</p>;
  }
  return (
    <table className="w-full text-xs">
      <thead>
        <tr className="text-slate-500">
          {headers.map((h) => (
            <th key={h} className="py-1 text-right first:text-right last:text-left">
              {h}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {rows.map((cells, i) => (
          <tr key={i} className="border-t border-slate-100">
            {cells.map((cell, j) => (
              <td
                key={j}
                className={`py-1 ${j === cells.length - 1 ? "text-left tabular-nums" : ""}`}
              >
                {cell}
              </td>
            ))}
          </tr>
        ))}
      </tbody>
    </table>
  );
}

export function DoctorFinancialReportDocument({
  report,
  printId = DOCTOR_FINANCIAL_REPORT_PRINT_ID,
}: DoctorFinancialReportDocumentProps) {
  const { profile } = useClinicProfile();
  const { t, formatMoney, dateLocale, isRTL } = useLanguage();

  const periodLabel =
    report.date_from || report.date_to
      ? `${report.date_from ? formatDate(report.date_from, dateLocale) : "—"} → ${report.date_to ? formatDate(report.date_to, dateLocale) : "—"}`
      : t("docAllPeriods");

  const tableHeaders = [
    t("docColDate"),
    t("docColPatient"),
    t("docColSession"),
    t("docColLabCost"),
    t("docColPaid"),
    t("docColYourShare"),
  ];

  const invoiceHeaders = [
    t("docColDate"),
    t("docColType"),
    t("docColDescription"),
    t("docColAmount"),
    t("docColDeduction"),
  ];

  const withdrawalHeaders = [
    t("docColDate"),
    t("docColDescription"),
    t("docColAmount"),
  ];

  return (
    <div
      id={printId}
      dir={isRTL ? "rtl" : "ltr"}
      className="rounded-xl border border-slate-border bg-white p-6 text-slate-text"
    >
      <ClinicBrandingHeader
        profile={profile}
        title={t("docFinancialReportTitle")}
        meta={`${report.doctor_name_ar} — ${periodLabel} — ${formatDate(new Date(), dateLocale)}`}
        size="md"
        className="mb-6"
      />

      <section className="mb-6 rounded-lg border border-primary/20 bg-primary/5 p-4">
        <h2 className="mb-3 text-sm font-bold text-primary">
          {t("docFinancialSummary")}
        </h2>
        <div className="grid gap-2 text-sm sm:grid-cols-2">
          <p>
            <span className="text-slate-500">{t("docWalletTotalEarnings")}</span>{" "}
            <strong>{formatMoney(report.total_earnings)}</strong>
          </p>
          <p>
            <span className="text-slate-500">{t("docCurrentBalance")}</span>{" "}
            <strong>{formatMoney(report.available_balance)}</strong>
          </p>
          <p>
            <span className="text-slate-500">{t("docShareFromSessions")}</span>{" "}
            <strong className="text-emerald-700">
              {formatMoney(report.total_doctor_share_from_sessions)}
            </strong>
          </p>
          <p>
            <span className="text-slate-500">{t("docTotalCollected")}</span>{" "}
            <strong>{formatMoney(report.total_collected_from_patients)}</strong>
          </p>
          <p>
            <span className="text-slate-500">{t("docWithdrawnApproved")}</span>{" "}
            <strong className="text-red-600">
              −{formatMoney(report.total_withdrawn)}
            </strong>
          </p>
          <p>
            <span className="text-slate-500">{t("docSalariesPaidOut")}</span>{" "}
            <strong className="text-red-600">
              −{formatMoney(report.total_salary_paid)}
            </strong>
          </p>
          <p>
            <span className="text-slate-500">{t("docClinicExpenseDeductions")}</span>{" "}
            <strong className="text-red-600">
              −{formatMoney(report.total_expense_deductions)}
            </strong>
          </p>
          <p>
            <span className="text-slate-500">{t("docAssistantDeductions")}</span>{" "}
            <strong className="text-red-600">
              −{formatMoney(report.total_payroll_deductions)}
            </strong>
          </p>
        </div>
        <p className="mt-3 border-t border-primary/10 pt-2 text-xs text-slate-600">
          {t("docApproxFormula")}{" "}
          <strong>{formatMoney(report.net_calc_hint)}</strong>
        </p>
      </section>

      <section className="mb-6">
        <h2 className="mb-2 border-b border-slate-200 pb-1 text-sm font-bold">
          {t("docYourPatientEarnings")} ({report.patient_payments.length})
        </h2>
        <ReportTable
          headers={tableHeaders}
          emptyMessage={t("docNoDataInPeriod")}
          rows={report.patient_payments.slice(0, 50).map((row) => [
            formatDate(row.payment_date, dateLocale),
            row.patient_name_ar,
            row.procedure_label,
            row.materials_cost > 0
              ? formatMoney(row.materials_cost)
              : "—",
            formatMoney(row.paid_amount),
            formatMoney(row.doctor_share),
          ])}
        />
      </section>

      <section className="mb-6">
        <h2 className="mb-2 border-b border-slate-200 pb-1 text-sm font-bold">
          {t("docYourInvoicesFromAccountant")} ({report.invoices.length})
        </h2>
        <ReportTable
          headers={invoiceHeaders}
          emptyMessage={t("docNoDataInPeriod")}
          rows={report.invoices.slice(0, 50).map((row) => [
            formatDate(row.invoice_date, dateLocale),
            row.record_kind === "doctor_expense"
              ? t("docKindClinicExpenseShort")
              : t("docKindSession"),
            row.record_kind === "doctor_expense"
              ? row.procedure_label
              : `${row.patient_name_ar} — ${row.procedure_label}${
                  row.lab_notes
                    ? ` (${truncateLabNotes(row.lab_notes, 24)})`
                    : ""
                }`,
            formatMoney(row.paid_amount),
            row.record_kind === "doctor_expense"
              ? `−${formatMoney(row.doctor_share)}`
              : formatMoney(row.doctor_share),
          ])}
        />
      </section>

      <section className="mb-6">
        <h2 className="mb-2 border-b border-slate-200 pb-1 text-sm font-bold">
          {t("docYourWithdrawals")} ({report.withdrawals.length})
        </h2>
        {report.withdrawals.length === 0 ? (
          <p className="text-sm text-slate-500">
            {t("docNoWithdrawalsInPeriod")}
          </p>
        ) : (
          <ReportTable
            headers={withdrawalHeaders}
            emptyMessage={t("docNoDataInPeriod")}
            rows={report.withdrawals.map((op) => [
              formatDate(op.operation_date, dateLocale),
              op.label,
              `−${formatMoney(op.amount)}`,
            ])}
          />
        )}
      </section>

      {report.salary_adjustments.length > 0 && (
        <section className="mb-6">
          <h2 className="mb-2 border-b border-slate-200 pb-1 text-sm font-bold">
            {t("docSalaryAdjustmentsTitle")} ({report.salary_adjustments.length})
          </h2>
          <ReportTable
            headers={withdrawalHeaders}
            emptyMessage={t("docNoDataInPeriod")}
            rows={report.salary_adjustments.map((op) => [
              formatDate(op.operation_date, dateLocale),
              t("docKindFixedSalary"),
              op.label,
              formatMoney(op.amount),
            ])}
          />
        </section>
      )}

      {(report.salary_payouts.length > 0 ||
        report.expense_deductions.length > 0 ||
        report.payroll_deductions.length > 0) && (
        <section className="mb-6">
          <h2 className="mb-2 border-b border-slate-200 pb-1 text-sm font-bold">
            {t("docDeductionsAndSalaries")}
          </h2>
          <ReportTable
            headers={invoiceHeaders.slice(0, 4)}
            emptyMessage={t("docNoDataInPeriod")}
            rows={[
              ...report.salary_payouts.map((op) => [
                formatDate(op.operation_date, dateLocale),
                t("docKindSalary"),
                op.label,
                `−${formatMoney(op.amount)}`,
              ]),
              ...report.expense_deductions.map((op) => [
                formatDate(op.operation_date, dateLocale),
                t("docKindClinicExpense"),
                op.label,
                `−${formatMoney(op.amount)}`,
              ]),
              ...report.payroll_deductions.map((op) => [
                formatDate(op.operation_date, dateLocale),
                t("docKindAssistant"),
                op.label,
                `−${formatMoney(op.amount)}`,
              ]),
            ]}
          />
        </section>
      )}
    </div>
  );
}
