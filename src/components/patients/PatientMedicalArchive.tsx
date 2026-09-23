"use client";

import { useMemo, useState } from "react";
import { Button } from "@/components/ui/Button";
import { PatientStatementDocument } from "@/components/doctor/PatientStatementDocument";
import { ReportActions } from "@/components/reports/ReportActions";
import { downloadPatientStatementPdf } from "@/lib/reports/pdf-export";
import type { ClinicalByOperationId } from "@/lib/clinical/types";
import type { ClinicProfile } from "@/types/clinic-profile";
import type { PatientTreatmentCase } from "@/lib/services/patient-treatment-cases";
import type { MedicalLog, Patient, PatientOperation } from "@/types";
import { formatCurrency, formatDate } from "@/lib/utils";
import { opName } from "@/types";
import { FileText, ImageIcon, Calendar, FolderHeart, NotebookPen } from "lucide-react";

const ARCHIVE_PRINT_ID = "patient-archive-print";

interface PatientMedicalArchiveProps {
  patient: Patient;
  operations: PatientOperation[];
  treatmentCases: PatientTreatmentCase[];
  clinicalByOp: ClinicalByOperationId;
  medicalLogs: (MedicalLog & { doctor?: { full_name_ar: string } })[];
  clinic?: ClinicProfile | null;
  clinicName: string;
}

export function PatientMedicalArchive({
  patient,
  operations,
  treatmentCases,
  clinicalByOp,
  medicalLogs,
  clinic,
  clinicName,
}: PatientMedicalArchiveProps) {
  const [showPdf, setShowPdf] = useState(false);
  const [pdfLoading, setPdfLoading] = useState(false);

  const xrays = useMemo(() => {
    const items: {
      id: string;
      url: string;
      fileName?: string | null;
      operationDate?: string;
      operationLabel: string;
    }[] = [];

    for (const op of operations) {
      const clinical = clinicalByOp[op.id];
      if (!clinical?.xrays?.length) continue;
      for (const x of clinical.xrays) {
        items.push({
          id: x.id,
          url: x.url,
          fileName: x.file_name,
          operationDate: op.operation_date,
          operationLabel: opName(op),
        });
      }
    }
    return items.sort((a, b) =>
      (b.operationDate ?? "").localeCompare(a.operationDate ?? "")
    );
  }, [operations, clinicalByOp]);

  const sortedOps = useMemo(
    () =>
      [...operations].sort((a, b) =>
        (b.operation_date ?? "").localeCompare(a.operation_date ?? "")
      ),
    [operations]
  );

  return (
    <div className="space-y-6">
      <div className="mc-panel flex flex-wrap items-center justify-between gap-4 p-5">
        <div className="flex min-w-0 items-center gap-4">
          <span className="mc-icon-tile h-12 w-12 rounded-2xl">
            <FolderHeart className="h-6 w-6" />
          </span>
          <div className="min-w-0">
            <h3 className="text-lg font-bold text-slate-text">الأرشيف الطبي</h3>
            <p className="truncate text-sm text-slate-muted">
              تاريخ الزيارات، الفواتير، والأشعة — {patient.full_name_ar}
            </p>
          </div>
        </div>
        <Button
          type="button"
          variant={showPdf ? "outline" : "premium"}
          onClick={() => setShowPdf((v) => !v)}
        >
          <FileText className="h-4 w-4" />
          {showPdf ? "إخفاء الكشف" : "تصدير أرشيف PDF"}
        </Button>
      </div>

      {showPdf && (
        <div className="space-y-4 rounded-2xl border border-slate-border bg-surface p-4 animate-fade-in">
          <ReportActions
            shareTitle={`أرشيف ${patient.full_name_ar} — ${clinicName}`}
            pdfLoading={pdfLoading}
            onExportPdf={async () => {
              setPdfLoading(true);
              try {
                await downloadPatientStatementPdf({
                  clinicName,
                  patientName: patient.full_name_ar,
                  periodLabel: "الأرشيف الطبي الكامل",
                  generatedAt: new Date().toLocaleString("ar-IQ"),
                  elementId: ARCHIVE_PRINT_ID,
                });
              } finally {
                setPdfLoading(false);
              }
            }}
          />
          <PatientStatementDocument
            patient={patient}
            operations={operations}
            treatmentCases={treatmentCases}
            medicalLogs={medicalLogs}
            clinic={clinic}
            printId={ARCHIVE_PRINT_ID}
          />
        </div>
      )}

      <section className="mc-panel">
        <div className="mc-panel-head">
          <h4 className="mc-panel-title">
            <Calendar />
            تاريخ الزيارات والفواتير ({sortedOps.length})
          </h4>
        </div>
        {sortedOps.length === 0 ? (
          <p className="mc-panel-body text-center text-sm text-slate-muted">لا توجد زيارات مسجّلة</p>
        ) : (
          <ol className="relative mx-5 my-5 space-y-3 border-s-2 border-premium-300/50 ps-5">
            {sortedOps.map((op) => (
              <li key={op.id} className="relative text-sm">
                <span
                  aria-hidden
                  className="absolute -start-[27px] top-3.5 h-3 w-3 rounded-full border-2 border-surface-card bg-primary-600 shadow-soft"
                />
                <div className="rounded-xl border border-slate-border bg-surface-card px-4 py-3 shadow-card transition-shadow hover:shadow-soft">
                  <div className="flex flex-wrap items-baseline justify-between gap-2">
                    <span className="font-bold text-slate-text">{opName(op)}</span>
                    <span className="text-xs text-slate-muted tabular-nums">
                      {formatDate(op.operation_date)}
                    </span>
                  </div>
                  <div className="mt-2 flex flex-wrap gap-2 text-xs text-slate-muted">
                    <span className="rounded-full bg-surface px-2.5 py-0.5">
                      إجمالي:{" "}
                      <strong className="text-slate-text tabular-nums">
                        {formatCurrency(op.total_amount)}
                      </strong>
                    </span>
                    <span className="rounded-full bg-surface px-2.5 py-0.5">
                      مدفوع:{" "}
                      <strong className="text-primary-700 tabular-nums dark:text-primary-300">
                        {formatCurrency(op.paid_amount)}
                      </strong>
                    </span>
                    {Number(op.remaining_debt ?? 0) > 0 && (
                      <span className="rounded-full border border-debt-border bg-debt px-2.5 py-0.5 font-semibold text-debt-text tabular-nums">
                        متبقي: {formatCurrency(op.remaining_debt!)}
                      </span>
                    )}
                  </div>
                </div>
              </li>
            ))}
          </ol>
        )}
      </section>

      <section className="mc-panel">
        <div className="mc-panel-head">
          <h4 className="mc-panel-title">
            <ImageIcon />
            الأشعة والملفات ({xrays.length})
          </h4>
        </div>
        <div className="mc-panel-body">
        {xrays.length === 0 ? (
          <p className="text-center text-sm text-slate-muted">لا توجد أشعة مرفوعة</p>
        ) : (
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4">
            {xrays.map((x) => (
              <a
                key={x.id}
                href={x.url}
                target="_blank"
                rel="noopener noreferrer"
                className="mc-hover-lift group overflow-hidden rounded-2xl border border-slate-border bg-surface-card shadow-card"
              >
                <div className="relative aspect-square bg-surface">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={x.url}
                    alt={x.fileName ?? "أشعة"}
                    className="h-full w-full object-cover transition group-hover:scale-105"
                  />
                </div>
                <div className="border-t border-slate-border p-2.5 text-[11px] text-slate-muted">
                  <p className="truncate font-semibold text-slate-text">
                    {x.operationLabel}
                  </p>
                  <p className="tabular-nums">{formatDate(x.operationDate)}</p>
                </div>
              </a>
            ))}
          </div>
        )}
        </div>
      </section>

      {medicalLogs.length > 0 && (
        <section className="mc-panel">
          <div className="mc-panel-head">
            <h4 className="mc-panel-title">
              <NotebookPen />
              السجل الطبي
            </h4>
          </div>
          <ul className="divide-y divide-slate-border text-sm">
            {medicalLogs.map((log) => (
              <li key={log.id} className="px-5 py-3.5">
                <p className="leading-relaxed text-slate-text">{log.content_ar}</p>
                <p className="mt-1 text-xs text-slate-muted tabular-nums">
                  {formatDate(log.log_date)}
                  {log.doctor?.full_name_ar &&
                    ` — د. ${log.doctor.full_name_ar}`}
                </p>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
