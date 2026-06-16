"use client";

import { ClinicBrandingHeader } from "@/components/branding/ClinicBrandingHeader";
import { formatDoctorDisplayName } from "@/lib/services/clinic-profile";
import type { SessionInvoiceData } from "@/lib/invoices/session-invoice";
import { formatCurrency, formatDate } from "@/lib/utils";
import { CheckCircle2 } from "lucide-react";

const PRINT_ID = "session-payment-invoice-print";

interface SessionPaymentInvoiceDocumentProps {
  data: SessionInvoiceData;
  printId?: string;
}

export function sessionInvoicePrintId() {
  return PRINT_ID;
}

export function SessionPaymentInvoiceDocument({
  data,
  printId = PRINT_ID,
}: SessionPaymentInvoiceDocumentProps) {
  return (
    <div
      id={printId}
      dir="rtl"
      className="mx-auto max-w-lg rounded-xl border border-slate-200 bg-white p-6 text-slate-800 shadow-sm"
    >
      <ClinicBrandingHeader
        profile={data.clinic}
        title="إيصال دفع / فاتورة"
        subtitle={`رقم الإيصال: ${data.invoiceNumber}`}
        meta={`تاريخ الإصدار: ${formatDate(data.issuedAt)}`}
        size="md"
        className="mb-5"
      />

      {data.treatmentCompleted && (
        <div className="mb-5 flex items-center gap-3 rounded-xl border-2 border-emerald-300 bg-emerald-50 px-4 py-3">
          <CheckCircle2 className="h-8 w-8 shrink-0 text-emerald-600" />
          <div>
            <p className="text-base font-bold text-emerald-800">
              تم إكمال العلاج بنجاح
            </p>
            <p className="text-sm text-emerald-700">
              لا توجد ذمة متبقية على حالة «{data.treatmentName}»
            </p>
          </div>
        </div>
      )}

      <div className="mb-5 grid gap-3 rounded-xl bg-slate-50 p-4 text-sm sm:grid-cols-2">
        <div>
          <p className="text-xs font-semibold uppercase text-slate-500">
            المراجع
          </p>
          <p className="mt-0.5 font-bold text-slate-900">{data.patientName}</p>
          {data.patientPhone && (
            <p className="text-slate-600" dir="ltr">
              {data.patientPhone}
            </p>
          )}
        </div>
        <div>
          <p className="text-xs font-semibold uppercase text-slate-500">
            الطبيب المعالج
          </p>
          <p className="mt-0.5 font-bold text-primary">
            {formatDoctorDisplayName(data.doctorName)}
          </p>
          <p className="text-xs text-slate-500">
            تاريخ الجلسة: {formatDate(data.sessionDate)}
          </p>
        </div>
      </div>

      <table className="mb-5 w-full border-collapse text-sm">
        <thead>
          <tr className="border-b-2 border-slate-200 text-right text-xs text-slate-500">
            <th className="py-2 pr-2">البيان</th>
            <th className="py-2 text-left">المبلغ</th>
          </tr>
        </thead>
        <tbody>
          <tr className="border-b border-slate-100">
            <td className="py-2.5 pr-2">
              <span className="font-medium">{data.procedureLabel}</span>
              <span className="block text-xs text-slate-500">
                {data.treatmentName}
              </span>
            </td>
            <td className="py-2.5 text-left font-semibold tabular-nums">
              {formatCurrency(data.paidThisSession)}
            </td>
          </tr>
          {data.caseTotalAmount > 0 && (
            <>
              <tr className="border-b border-slate-100 text-slate-600">
                <td className="py-2 pr-2">إجمالي الحالة العلاجية</td>
                <td className="py-2 text-left tabular-nums">
                  {formatCurrency(data.caseTotalAmount)}
                </td>
              </tr>
              <tr className="border-b border-slate-100 text-slate-600">
                <td className="py-2 pr-2">إجمالي المدفوع</td>
                <td className="py-2 text-left tabular-nums text-primary">
                  {formatCurrency(data.caseTotalPaid)}
                </td>
              </tr>
              <tr
                className={
                  data.remainingBalance > 0
                    ? "font-semibold text-debt-text"
                    : "text-emerald-700"
                }
              >
                <td className="py-2 pr-2">المتبقي (الذمة)</td>
                <td className="py-2 text-left tabular-nums">
                  {formatCurrency(data.remainingBalance)}
                </td>
              </tr>
            </>
          )}
        </tbody>
        <tfoot>
          <tr className="border-t-2 border-primary/30 bg-primary/5">
            <td className="py-3 pr-2 text-base font-bold">المبلغ المستلم اليوم</td>
            <td className="py-3 text-left text-lg font-black tabular-nums text-primary">
              {formatCurrency(data.paidThisSession)}
            </td>
          </tr>
        </tfoot>
      </table>

      {data.notes?.trim() && (
        <p className="mb-4 rounded-lg border border-slate-100 bg-slate-50 px-3 py-2 text-xs text-slate-600">
          <span className="font-semibold">ملاحظات: </span>
          {data.notes}
        </p>
      )}

      {/* تكلفة المختبر وملاحظاته للاستخدام الداخلي فقط — لا تظهر في فاتورة المراجع */}

      <footer className="border-t border-slate-200 pt-4 text-center text-xs text-slate-500">
        <p>شكراً لثقتكم — نتمنى لكم دوام الصحة والعافية</p>
        <p className="mt-1">هذا الإيصال صادر إلكترونياً من نظام العيادة</p>
      </footer>
    </div>
  );
}
