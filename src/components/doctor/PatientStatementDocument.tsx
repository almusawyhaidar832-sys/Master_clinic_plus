"use client";

import type { ClinicProfile } from "@/types/clinic-profile";
import type { MedicalLog, Patient, PatientOperation } from "@/types";
import { ClinicBrandingHeader } from "@/components/branding/ClinicBrandingHeader";
import { PatientStatementByCase } from "@/components/statements/PatientStatementByCase";
import { formatDoctorDisplayName } from "@/lib/services/clinic-profile";
import type { PatientTreatmentCase } from "@/lib/services/patient-treatment-cases";
import { formatDate } from "@/lib/utils";

interface PatientStatementDocumentProps {
  patient: Patient;
  operations: PatientOperation[];
  treatmentCases: PatientTreatmentCase[];
  medicalLogs: (MedicalLog & { doctor?: { full_name_ar: string } })[];
  clinic?: ClinicProfile | null;
  printId?: string;
}

export function PatientStatementDocument({
  patient,
  operations,
  treatmentCases,
  medicalLogs,
  clinic,
  printId = "patient-statement-print",
}: PatientStatementDocumentProps) {
  return (
    <div
      id={printId}
      dir="rtl"
      className="rounded-xl border border-slate-border bg-white p-6 text-slate-text"
    >
      <ClinicBrandingHeader
        profile={clinic}
        title="كشف حساب ومتابعة طبية"
        meta={`المريض: ${patient.full_name_ar} — تاريخ الإصدار: ${formatDate(new Date())}`}
        size="md"
        className="mb-6"
      />

      {patient.phone && (
        <p className="-mt-4 mb-4 text-center text-sm" dir="ltr">
          {patient.phone}
        </p>
      )}

      <PatientStatementByCase
        operations={operations}
        treatmentCases={treatmentCases}
      />

      {medicalLogs.length > 0 && (
        <section className="mt-6 border-t border-slate-border pt-6">
          <h2 className="mb-2 font-semibold">السجل الطبي</h2>
          <ul className="space-y-2 text-sm">
            {medicalLogs.map((log) => (
              <li key={log.id} className="rounded bg-surface p-2">
                <div className="mb-1 flex flex-wrap items-center justify-between gap-1">
                  <p className="text-xs text-slate-muted">
                    {formatDate(log.log_date)}
                  </p>
                  <span className="text-xs font-medium text-primary">
                    {formatDoctorDisplayName(log.doctor?.full_name_ar)}
                  </span>
                </div>
                <p>{log.content_ar}</p>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
