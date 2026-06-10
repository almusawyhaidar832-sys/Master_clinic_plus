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
import { FileText, ImageIcon, Calendar } from "lucide-react";

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
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h3 className="text-lg font-bold text-slate-text">الأرشيف الطبي</h3>
          <p className="text-sm text-slate-muted">
            تاريخ الزيارات، الفواتير، والأشعة — {patient.full_name_ar}
          </p>
        </div>
        <Button
          type="button"
          variant="outline"
          onClick={() => setShowPdf((v) => !v)}
        >
          <FileText className="h-4 w-4" />
          {showPdf ? "إخفاء الكشف" : "تصدير أرشيف PDF"}
        </Button>
      </div>

      {showPdf && (
        <div className="space-y-4 rounded-xl border border-primary/20 bg-primary/5 p-4">
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

      <section>
        <h4 className="mb-3 flex items-center gap-2 text-sm font-bold text-slate-text">
          <Calendar className="h-4 w-4 text-primary" />
          تاريخ الزيارات والفواتير ({sortedOps.length})
        </h4>
        {sortedOps.length === 0 ? (
          <p className="text-sm text-slate-muted">لا توجد زيارات مسجّلة</p>
        ) : (
          <ul className="space-y-2">
            {sortedOps.map((op) => (
              <li
                key={op.id}
                className="rounded-lg border border-slate-border bg-white px-3 py-2 text-sm"
              >
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                  <span className="font-medium">{opName(op)}</span>
                  <span className="text-xs text-slate-muted tabular-nums">
                    {formatDate(op.operation_date)}
                  </span>
                </div>
                <div className="mt-1 flex flex-wrap gap-3 text-xs text-slate-muted">
                  <span>
                    إجمالي:{" "}
                    <strong className="text-slate-text">
                      {formatCurrency(op.total_amount)}
                    </strong>
                  </span>
                  <span>
                    مدفوع:{" "}
                    <strong className="text-primary">
                      {formatCurrency(op.paid_amount)}
                    </strong>
                  </span>
                  {Number(op.remaining_debt ?? 0) > 0 && (
                    <span className="text-debt-text">
                      متبقي: {formatCurrency(op.remaining_debt!)}
                    </span>
                  )}
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section>
        <h4 className="mb-3 flex items-center gap-2 text-sm font-bold text-slate-text">
          <ImageIcon className="h-4 w-4 text-primary" />
          الأشعة والملفات ({xrays.length})
        </h4>
        {xrays.length === 0 ? (
          <p className="text-sm text-slate-muted">لا توجد أشعة مرفوعة</p>
        ) : (
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4">
            {xrays.map((x) => (
              <a
                key={x.id}
                href={x.url}
                target="_blank"
                rel="noopener noreferrer"
                className="group overflow-hidden rounded-lg border border-slate-border bg-white"
              >
                <div className="relative aspect-square bg-slate-100">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={x.url}
                    alt={x.fileName ?? "أشعة"}
                    className="h-full w-full object-cover transition group-hover:scale-105"
                  />
                </div>
                <div className="p-2 text-[10px] text-slate-muted">
                  <p className="truncate font-medium text-slate-text">
                    {x.operationLabel}
                  </p>
                  <p>{formatDate(x.operationDate)}</p>
                </div>
              </a>
            ))}
          </div>
        )}
      </section>

      {medicalLogs.length > 0 && (
        <section>
          <h4 className="mb-3 text-sm font-bold text-slate-text">السجل الطبي</h4>
          <ul className="space-y-2 text-sm">
            {medicalLogs.map((log) => (
              <li
                key={log.id}
                className="rounded-lg border border-slate-border bg-white px-3 py-2"
              >
                <p className="text-slate-text">{log.content}</p>
                <p className="mt-1 text-xs text-slate-muted">
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
