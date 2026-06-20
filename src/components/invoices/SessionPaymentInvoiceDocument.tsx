"use client";

import {
  ClinicalPdfShell,
  PdfInfoCard,
  PdfSectionTitle,
  PdfTable,
} from "@/components/documents/ClinicalPdfShell";
import { formatDoctorDisplayName } from "@/lib/services/clinic-profile";
import type { SessionInvoiceData } from "@/lib/invoices/session-invoice";
import { formatCurrency, formatDate } from "@/lib/utils";

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
  const paidToday = formatCurrency(data.paidThisSession);

  return (
    <ClinicalPdfShell
      id={printId}
      variant="invoice"
      clinic={data.clinic}
      headline="فاتورة / إيصال دفع"
      subline={`رقم الإيصال: ${data.invoiceNumber}`}
      metaLine={`تاريخ الإصدار: ${formatDate(data.issuedAt)} · جلسة: ${formatDate(data.sessionDate)}`}
      badgeExtra={data.invoiceNumber}
    >
      {data.treatmentCompleted && (
        <div
          className="mb-6 flex items-center gap-3 rounded-xl px-4 py-3"
          style={{
            background: "linear-gradient(90deg, #ecfdf5 0%, #d1fae5 100%)",
            border: "2px solid #34d399",
          }}
        >
          <span
            className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-lg font-black text-white"
            style={{ backgroundColor: "#059669" }}
          >
            ✓
          </span>
          <div>
            <p className="text-base font-black" style={{ color: "#065f46" }}>
              تم إكمال العلاج بنجاح
            </p>
            <p className="text-sm font-semibold" style={{ color: "#047857" }}>
              لا توجد ذمة متبقية على «{data.treatmentName}»
            </p>
          </div>
        </div>
      )}

      <div className="mb-6 grid grid-cols-2 gap-3">
        <PdfInfoCard label="المراجع" value={data.patientName} hint={data.patientPhone ?? undefined} hintDir={data.patientPhone ? "ltr" : undefined} />
        <PdfInfoCard
          label="الطبيب المعالج"
          value={formatDoctorDisplayName(data.doctorName)}
          hint={`تاريخ الجلسة: ${formatDate(data.sessionDate)}`}
          accent
        />
      </div>

      <PdfSectionTitle color="#0056b3">تفاصيل الدفع</PdfSectionTitle>

      <PdfTable variant="invoice" headers={["البيان", "المبلغ"]} colAlign={["right", "left"]}>
        <tr style={{ borderBottom: "1px solid #f1f5f9" }}>
          <td className="px-3 py-3">
            <span className="font-bold" style={{ fontSize: "15px", color: "#0f172a" }}>
              {data.procedureLabel}
            </span>
            <span className="mt-0.5 block text-xs font-medium" style={{ color: "#64748b" }}>
              {data.treatmentName}
            </span>
          </td>
          <td
            className="px-3 py-3 text-left font-black tabular-nums"
            style={{ fontSize: "16px", color: "#0056b3" }}
          >
            {paidToday}
          </td>
        </tr>
        {data.caseTotalAmount > 0 && (
          <>
            <tr style={{ borderBottom: "1px solid #f1f5f9", backgroundColor: "#f8fafc" }}>
              <td className="px-3 py-2.5 font-medium" style={{ color: "#475569" }}>
                إجمالي الحالة العلاجية
              </td>
              <td className="px-3 py-2.5 text-left tabular-nums font-semibold" style={{ color: "#334155" }}>
                {formatCurrency(data.caseTotalAmount)}
              </td>
            </tr>
            <tr style={{ borderBottom: "1px solid #f1f5f9", backgroundColor: "#f8fafc" }}>
              <td className="px-3 py-2.5 font-medium" style={{ color: "#475569" }}>
                إجمالي المدفوع
              </td>
              <td
                className="px-3 py-2.5 text-left tabular-nums font-bold"
                style={{ color: "#0056b3" }}
              >
                {formatCurrency(data.caseTotalPaid)}
              </td>
            </tr>
            <tr style={{ backgroundColor: "#f8fafc" }}>
              <td
                className="px-3 py-2.5 font-bold"
                style={{ color: data.remainingBalance > 0 ? "#b91c1c" : "#059669" }}
              >
                المتبقي (الذمة)
              </td>
              <td
                className="px-3 py-2.5 text-left tabular-nums font-black"
                style={{
                  fontSize: "15px",
                  color: data.remainingBalance > 0 ? "#b91c1c" : "#059669",
                }}
              >
                {formatCurrency(data.remainingBalance)}
              </td>
            </tr>
          </>
        )}
      </PdfTable>

      <div
        className="mt-5 flex items-center justify-between rounded-xl px-5 py-4"
        style={{
          background: "linear-gradient(135deg, #eff6fc 0%, #dbeafe 100%)",
          border: "2px solid #93c5fd",
        }}
      >
        <span className="text-base font-black" style={{ color: "#003875" }}>
          المبلغ المستلم اليوم
        </span>
        <span
          className="font-black tabular-nums"
          style={{ fontSize: "28px", color: "#0056b3" }}
          dir="ltr"
        >
          {paidToday}
        </span>
      </div>

      {data.notes?.trim() && (
        <div
          className="mt-5 rounded-xl px-4 py-3"
          style={{
            backgroundColor: "#fffbeb",
            border: "1px solid #fcd34d",
          }}
        >
          <p className="text-xs font-bold" style={{ color: "#92400e" }}>
            ملاحظات
          </p>
          <p className="mt-1 text-sm font-medium leading-relaxed" style={{ color: "#78350f" }}>
            {data.notes}
          </p>
        </div>
      )}
    </ClinicalPdfShell>
  );
}
