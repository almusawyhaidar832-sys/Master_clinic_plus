import type { PatientOperation } from "@/types";
import { formatCurrency, formatDate } from "@/lib/utils";
import { opName } from "@/types";

export type PatientStatementPdfInput = {
  clinicName: string;
  patientName: string;
  periodLabel?: string;
  generatedAt: string;
  operations: PatientOperation[];
  agreedTotal?: number;
  totalPaid?: number;
  remaining?: number;
};

export type ClinicReportPdfInput = {
  clinicName: string;
  periodLabel: string;
  generatedAt: string;
  rows: { label: string; value: string }[];
  title?: string;
};

/** تصدير كشف حساب مراجع — يعمل في المتصفح (طبيب / محاسب) */
export async function downloadPatientStatementPdf(
  input: PatientStatementPdfInput
): Promise<void> {
  const { jsPDF } = await import("jspdf");
  const autoTable = (await import("jspdf-autotable")).default;

  const doc = new jsPDF({ orientation: "portrait", unit: "mm", format: "a4" });

  doc.setFontSize(16);
  doc.text(input.clinicName, 105, 18, { align: "center" });
  doc.setFontSize(12);
  doc.text("كشف حساب مراجع", 105, 26, { align: "center" });
  doc.text(input.patientName, 105, 34, { align: "center" });

  if (input.periodLabel) {
    doc.setFontSize(10);
    doc.text(input.periodLabel, 105, 42, { align: "center" });
  }

  let y = 48;
  if (
    input.agreedTotal !== undefined ||
    input.totalPaid !== undefined ||
    input.remaining !== undefined
  ) {
    doc.setFontSize(10);
    const lines = [
      input.agreedTotal !== undefined
        ? `الإجمالي المتفق: ${formatCurrency(input.agreedTotal)}`
        : null,
      input.totalPaid !== undefined
        ? `المدفوع: ${formatCurrency(input.totalPaid)}`
        : null,
      input.remaining !== undefined
        ? `المتبقي: ${formatCurrency(input.remaining)}`
        : null,
    ].filter(Boolean) as string[];
    lines.forEach((line) => {
      doc.text(line, 14, y);
      y += 6;
    });
    y += 4;
  }

  const tableBody = input.operations.map((op) => [
    op.operation_date ? formatDate(op.operation_date) : "—",
    opName(op),
    op.session_kind === "payment"
      ? "دفعة"
      : op.session_kind === "discount"
        ? "خصم"
        : "خطة",
    formatCurrency(op.paid_amount ?? 0),
    formatCurrency(
      op.remaining_debt ??
        Math.max(0, Number(op.total_amount) - Number(op.paid_amount))
    ),
  ]);

  autoTable(doc, {
    startY: y,
    head: [["التاريخ", "الإجراء", "النوع", "مدفوع", "متبقي"]],
    body: tableBody,
    styles: { font: "helvetica", fontSize: 9, halign: "right" },
    headStyles: { fillColor: [20, 184, 166] },
    margin: { left: 14, right: 14 },
  });

  const finalY =
    (doc as unknown as { lastAutoTable?: { finalY: number } }).lastAutoTable
      ?.finalY ?? y + 40;
  doc.setFontSize(8);
  doc.text(`تاريخ الإنشاء: ${input.generatedAt}`, 14, finalY + 10);

  const safeName = input.patientName.replace(/[^\w\u0600-\u06FF\s-]/g, "").trim();
  doc.save(`كشف-${safeName || "مريض"}.pdf`);
}

/** تقرير عيادة مختصر (يومي / شهري) */
export async function downloadClinicReportPdf(
  input: ClinicReportPdfInput
): Promise<void> {
  const { jsPDF } = await import("jspdf");
  const autoTable = (await import("jspdf-autotable")).default;

  const doc = new jsPDF({ orientation: "portrait", unit: "mm", format: "a4" });
  doc.setFontSize(16);
  doc.text(input.clinicName, 105, 18, { align: "center" });
  doc.setFontSize(12);
  doc.text(input.title ?? "تقرير العيادة", 105, 28, { align: "center" });
  doc.setFontSize(10);
  doc.text(input.periodLabel, 105, 36, { align: "center" });

  autoTable(doc, {
    startY: 44,
    head: [["البند", "القيمة"]],
    body: input.rows.map((r) => [r.label, r.value]),
    styles: { font: "helvetica", fontSize: 10, halign: "right" },
    headStyles: { fillColor: [20, 184, 166] },
    margin: { left: 14, right: 14 },
  });

  doc.save(`تقرير-${input.periodLabel.replace(/\s/g, "-")}.pdf`);
}
