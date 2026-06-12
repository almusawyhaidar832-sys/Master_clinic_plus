"use client";

import type { DoctorFinancialReportData } from "@/lib/services/doctor-financial-ledger";
import { ClinicBrandingHeader } from "@/components/branding/ClinicBrandingHeader";
import { useClinicProfile } from "@/contexts/ClinicProfileContext";
import { formatCurrency, formatDate } from "@/lib/utils";

export const DOCTOR_FINANCIAL_REPORT_PRINT_ID = "doctor-financial-report-print";

interface DoctorFinancialReportDocumentProps {
  report: DoctorFinancialReportData;
  printId?: string;
}

function ReportTable({
  headers,
  rows,
}: {
  headers: string[];
  rows: string[][];
}) {
  if (!rows.length) {
    return <p className="text-sm text-slate-500">لا توجد بيانات في الفترة</p>;
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

  const periodLabel =
    report.date_from || report.date_to
      ? `${report.date_from ? formatDate(report.date_from) : "—"} → ${report.date_to ? formatDate(report.date_to) : "—"}`
      : "كل الفترات";

  return (
    <div
      id={printId}
      dir="rtl"
      className="rounded-xl border border-slate-border bg-white p-6 text-slate-text"
    >
      <ClinicBrandingHeader
        profile={profile}
        title="التقرير المالي للطبيب"
        meta={`${report.doctor_name_ar} — ${periodLabel} — ${formatDate(new Date())}`}
        size="md"
        className="mb-6"
      />

      <section className="mb-6 rounded-lg border border-primary/20 bg-primary/5 p-4">
        <h2 className="mb-3 text-sm font-bold text-primary">الملخص المالي</h2>
        <div className="grid gap-2 text-sm sm:grid-cols-2">
          <p>
            <span className="text-slate-500">إجمالي أرباحك (محفظة):</span>{" "}
            <strong>{formatCurrency(report.total_earnings)}</strong>
          </p>
          <p>
            <span className="text-slate-500">الرصيد الحالي:</span>{" "}
            <strong>{formatCurrency(report.available_balance)}</strong>
          </p>
          <p>
            <span className="text-slate-500">حصتك من جلسات المراجعين:</span>{" "}
            <strong className="text-emerald-700">
              {formatCurrency(report.total_doctor_share_from_sessions)}
            </strong>
          </p>
          <p>
            <span className="text-slate-500">إجمالي محصّل من المراجعين:</span>{" "}
            <strong>{formatCurrency(report.total_collected_from_patients)}</strong>
          </p>
          <p>
            <span className="text-slate-500">مسحوب (موافق/مدفوع):</span>{" "}
            <strong className="text-red-600">
              −{formatCurrency(report.total_withdrawn)}
            </strong>
          </p>
          <p>
            <span className="text-slate-500">رواتب مُصرفة:</span>{" "}
            <strong className="text-red-600">
              −{formatCurrency(report.total_salary_paid)}
            </strong>
          </p>
          <p>
            <span className="text-slate-500">خصومات صرفيات العيادة:</span>{" "}
            <strong className="text-red-600">
              −{formatCurrency(report.total_expense_deductions)}
            </strong>
          </p>
          <p>
            <span className="text-slate-500">خصومات مساعدين:</span>{" "}
            <strong className="text-red-600">
              −{formatCurrency(report.total_payroll_deductions)}
            </strong>
          </p>
        </div>
        <p className="mt-3 border-t border-primary/10 pt-2 text-xs text-slate-600">
          تقريب: حصة الجلسات − السحوبات − الرواتب − الخصومات ≈{" "}
          <strong>{formatCurrency(report.net_calc_hint)}</strong>
        </p>
      </section>

      <section className="mb-6">
        <h2 className="mb-2 border-b border-slate-200 pb-1 text-sm font-bold">
          أرباحك من المراجعين ({report.patient_payments.length})
        </h2>
        <ReportTable
          headers={["التاريخ", "المراجع", "الجلسة", "المدفوع", "حصتك"]}
          rows={report.patient_payments.slice(0, 50).map((row) => [
            formatDate(row.payment_date),
            row.patient_name_ar,
            row.procedure_label,
            formatCurrency(row.paid_amount),
            formatCurrency(row.doctor_share),
          ])}
        />
      </section>

      <section className="mb-6">
        <h2 className="mb-2 border-b border-slate-200 pb-1 text-sm font-bold">
          فواتيرك من المحاسب ({report.invoices.length})
        </h2>
        <ReportTable
          headers={["التاريخ", "النوع", "البيان", "المبلغ", "حصتك/الخصم"]}
          rows={report.invoices.slice(0, 50).map((row) => [
            formatDate(row.invoice_date),
            row.record_kind === "doctor_expense" ? "صرفية" : "جلسة",
            row.record_kind === "doctor_expense"
              ? row.procedure_label
              : `${row.patient_name_ar} — ${row.procedure_label}`,
            formatCurrency(row.paid_amount),
            row.record_kind === "doctor_expense"
              ? `−${formatCurrency(row.doctor_share)}`
              : formatCurrency(row.doctor_share),
          ])}
        />
      </section>

      <section className="mb-6">
        <h2 className="mb-2 border-b border-slate-200 pb-1 text-sm font-bold">
          سحوباتك ({report.withdrawals.length})
        </h2>
        {report.withdrawals.length === 0 ? (
          <p className="text-sm text-slate-500">
            لا توجد سحوبات في الفترة المحددة — جرّب ترك التواريخ فارغة لعرض كل
            السحوبات.
          </p>
        ) : (
          <ReportTable
            headers={["التاريخ", "البيان", "المبلغ"]}
            rows={report.withdrawals.map((op) => [
              formatDate(op.operation_date),
              op.label,
              `−${formatCurrency(op.amount)}`,
            ])}
          />
        )}
      </section>

      {report.salary_adjustments.length > 0 && (
        <section className="mb-6">
          <h2 className="mb-2 border-b border-slate-200 pb-1 text-sm font-bold">
            حركات الراتب ({report.salary_adjustments.length})
          </h2>
          <ReportTable
            headers={["التاريخ", "النوع", "البيان", "المبلغ"]}
            rows={report.salary_adjustments.map((op) => [
              formatDate(op.operation_date),
              "راتب ثابت",
              op.label,
              formatCurrency(op.amount),
            ])}
          />
        </section>
      )}

      {(report.salary_payouts.length > 0 ||
        report.expense_deductions.length > 0 ||
        report.payroll_deductions.length > 0) && (
        <section className="mb-6">
          <h2 className="mb-2 border-b border-slate-200 pb-1 text-sm font-bold">
            خصومات ورواتب
          </h2>
          <ReportTable
            headers={["التاريخ", "النوع", "البيان", "المبلغ"]}
            rows={[
              ...report.salary_payouts.map((op) => [
                formatDate(op.operation_date),
                "راتب",
                op.label,
                `−${formatCurrency(op.amount)}`,
              ]),
              ...report.expense_deductions.map((op) => [
                formatDate(op.operation_date),
                "صرفية عيادة",
                op.label,
                `−${formatCurrency(op.amount)}`,
              ]),
              ...report.payroll_deductions.map((op) => [
                formatDate(op.operation_date),
                "مساعد",
                op.label,
                `−${formatCurrency(op.amount)}`,
              ]),
            ]}
          />
        </section>
      )}
    </div>
  );
}
