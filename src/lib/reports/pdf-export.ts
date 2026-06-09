import { downloadElementAsPdf } from "@/lib/reports/pdf-from-html";

export type PatientStatementPdfInput = {
  clinicName: string;
  patientName: string;
  periodLabel?: string;
  generatedAt: string;
  /** معرّف عنصر HTML المعروض (مثلاً patient-statement-print) */
  elementId: string;
};

export type ClinicReportPdfInput = {
  clinicName: string;
  periodLabel: string;
  generatedAt: string;
  /** معرّف عنصر HTML المعروض (مثلاً master-clinic-report-print) */
  elementId: string;
};

function safePdfFilename(base: string, fallback: string): string {
  const cleaned = base.replace(/[^\w\u0600-\u06FF\s-]/g, "").trim();
  return cleaned || fallback;
}

/** تصدير كشف حساب مراجع من العنصر المعروض على الشاشة */
export async function downloadPatientStatementPdf(
  input: PatientStatementPdfInput
): Promise<void> {
  const name = safePdfFilename(input.patientName, "مريض");
  await downloadElementAsPdf(input.elementId, `كشف-${name}.pdf`);
}

/** تصدير تقرير العيادة من العنصر المعروض على الشاشة */
export async function downloadClinicReportPdf(
  input: ClinicReportPdfInput
): Promise<void> {
  const period = input.periodLabel.replace(/\s/g, "-");
  await downloadElementAsPdf(input.elementId, `تقرير-${period}.pdf`);
}
