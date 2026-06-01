"use client";

import type { ClinicProfile } from "@/types/clinic-profile";
import type { MedicalLog, Patient, PatientOperation } from "@/types";
import { ClinicBrandingHeader } from "@/components/branding/ClinicBrandingHeader";
import { formatDoctorDisplayName } from "@/lib/services/clinic-profile";
import { formatCurrency, formatDate } from "@/lib/utils";

interface PatientStatementDocumentProps {
  patient: Patient;
  operations: PatientOperation[];
  medicalLogs: (MedicalLog & { doctor?: { full_name_ar: string } })[];
  clinic?: ClinicProfile | null;
}

export function PatientStatementDocument({
  patient,
  operations,
  medicalLogs,
  clinic,
}: PatientStatementDocumentProps) {
  const totalPaid = operations.reduce((s, o) => s + o.paid_amount, 0);
  const totalDebt = operations.reduce(
    (s, o) => s + (o.remaining_debt ?? Math.max(0, o.total_amount - o.paid_amount)),
    0
  );

  return (
    <div
      id="patient-statement-print"
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

      <section className="mb-6">
        <h2 className="mb-2 font-semibold">الملخص المالي</h2>
        <div className="grid grid-cols-2 gap-2 text-sm">
          <div className="rounded bg-surface p-2">
            <span className="text-slate-muted">إجمالي المدفوع: </span>
            <strong>{formatCurrency(totalPaid)}</strong>
          </div>
          <div className="rounded bg-debt/30 p-2">
            <span className="text-slate-muted">متبقي: </span>
            <strong className="text-debt-text">{formatCurrency(totalDebt)}</strong>
          </div>
        </div>
      </section>

      <section className="mb-6">
        <h2 className="mb-2 font-semibold">السجل المالي</h2>
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b text-right text-slate-muted">
              <th className="py-1">التاريخ</th>
              <th className="py-1">الطبيب</th>
              <th className="py-1">العملية</th>
              <th className="py-1">المدفوع</th>
            </tr>
          </thead>
          <tbody>
            {operations.map((op) => (
              <tr key={op.id} className="border-b border-slate-border/40">
                <td className="py-1">{formatDate(op.operation_date)}</td>
                <td className="py-1 font-medium text-primary">
                  {formatDoctorDisplayName(
                    (op.doctor as { full_name_ar: string })?.full_name_ar
                  )}
                </td>
                <td className="py-1">{op.operation_type || op.operation_name_ar || "—"}</td>
                <td className="py-1">{formatCurrency(op.paid_amount)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      {medicalLogs.length > 0 && (
        <section>
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
