"use client";

import { ClinicBrandingHeader } from "@/components/branding/ClinicBrandingHeader";
import { formatDoctorDisplayName } from "@/lib/services/clinic-profile";
import type { PrescriptionPrintData } from "@/lib/prescriptions/types";
import { formatDate } from "@/lib/utils";

const PRINT_ID = "patient-prescription-print";

export function prescriptionPrintId() {
  return PRINT_ID;
}

interface PrescriptionPrintDocumentProps {
  data: PrescriptionPrintData;
  printId?: string;
}

export function PrescriptionPrintDocument({
  data,
  printId = PRINT_ID,
}: PrescriptionPrintDocumentProps) {
  const { prescription, patientName, patientPhone, doctorName, clinic } = data;

  return (
    <div
      id={printId}
      dir="rtl"
      className="mx-auto max-w-lg rounded-xl border border-slate-200 bg-white p-6 text-slate-800 shadow-sm"
    >
      <ClinicBrandingHeader
        profile={clinic}
        title="وصفة طبية"
        subtitle={`تاريخ: ${formatDate(prescription.prescription_date)}`}
        size="md"
        className="mb-5"
      />

      <div className="mb-5 grid gap-3 rounded-xl bg-primary/5 p-4 text-sm sm:grid-cols-2">
        <div>
          <p className="text-xs font-semibold text-slate-500">المراجع</p>
          <p className="mt-0.5 font-bold text-slate-900">{patientName}</p>
          {patientPhone && (
            <p className="text-slate-600" dir="ltr">
              {patientPhone}
            </p>
          )}
        </div>
        <div>
          <p className="text-xs font-semibold text-slate-500">الطبيب المعالج</p>
          <p className="mt-0.5 font-bold text-primary">
            {formatDoctorDisplayName(doctorName)}
          </p>
        </div>
      </div>

      {prescription.diagnosis_ar && (
        <div className="mb-4 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm">
          <span className="font-semibold text-slate-700">التشخيص: </span>
          {prescription.diagnosis_ar}
        </div>
      )}

      <table className="mb-5 w-full border-collapse text-sm">
        <thead>
          <tr className="border-b-2 border-primary/30 text-right text-xs text-slate-500">
            <th className="py-2 pe-2">#</th>
            <th className="py-2 pe-2">الدواء</th>
            <th className="py-2 pe-2">الجرعة</th>
            <th className="py-2 pe-2">التكرار</th>
            <th className="py-2">المدة</th>
          </tr>
        </thead>
        <tbody>
          {prescription.medications.map((med, i) => (
            <tr key={i} className="border-b border-slate-100 align-top">
              <td className="py-2 pe-2 tabular-nums text-slate-400">{i + 1}</td>
              <td className="py-2 pe-2 font-semibold text-slate-900">
                {med.drug_name_ar}
                {med.instructions && (
                  <p className="mt-0.5 text-xs font-normal text-slate-500">
                    {med.instructions}
                  </p>
                )}
              </td>
              <td className="py-2 pe-2 text-slate-700">{med.dosage ?? "—"}</td>
              <td className="py-2 pe-2 text-slate-700">{med.frequency ?? "—"}</td>
              <td className="py-2 text-slate-700">{med.duration ?? "—"}</td>
            </tr>
          ))}
        </tbody>
      </table>

      {prescription.notes_ar && (
        <div className="mb-4 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900">
          <span className="font-semibold">ملاحظات: </span>
          {prescription.notes_ar}
        </div>
      )}

      <div className="mt-8 border-t border-slate-200 pt-6 text-center text-xs text-slate-500">
        <p>يرجى الالتزام بتعليمات الطبيب وعدم صرف الدواء دون وصفة.</p>
        <p className="mt-1">مع تمنياتنا بالشفاء العاجل</p>
      </div>
    </div>
  );
}
