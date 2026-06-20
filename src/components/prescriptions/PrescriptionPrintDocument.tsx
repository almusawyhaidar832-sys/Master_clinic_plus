"use client";

import {
  ClinicalPdfShell,
  PdfInfoCard,
  PdfSectionTitle,
  PdfTable,
} from "@/components/documents/ClinicalPdfShell";
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
    <ClinicalPdfShell
      id={printId}
      variant="prescription"
      clinic={clinic}
      headline="الوصفة الطبية"
      subline={`المراجع: ${patientName}`}
      metaLine={`تاريخ الوصفة: ${formatDate(prescription.prescription_date)} · الطبيب: ${formatDoctorDisplayName(doctorName)}`}
      footer={
        <div
          className="px-8 py-5 text-center"
          style={{ borderTop: "2px solid #e2e8f0", backgroundColor: "#ffffff" }}
        >
          <p className="text-sm font-bold" style={{ color: "#059669" }}>
            يرجى الالتزام بتعليمات الطبيب وعدم صرف الدواء دون وصفة معتمدة
          </p>
          <p className="mt-1 text-xs" style={{ color: "#64748b" }}>
            مع تمنياتنا بالشفاء العاجل — {formatDoctorDisplayName(doctorName)}
          </p>
        </div>
      }
    >
      <div className="mb-6 grid grid-cols-2 gap-3">
        <PdfInfoCard
          label="المراجع"
          value={patientName}
          hint={patientPhone ?? undefined}
          hintDir={patientPhone ? "ltr" : undefined}
        />
        <PdfInfoCard
          label="الطبيب المعالج"
          value={formatDoctorDisplayName(doctorName)}
          accent
          accentColor="#059669"
        />
      </div>

      {prescription.diagnosis_ar && (
        <>
          <PdfSectionTitle color="#059669">التشخيص</PdfSectionTitle>
          <div
            className="mb-6 rounded-xl px-4 py-3"
            style={{
              background: "linear-gradient(90deg, #ecfdf5 0%, #f0fdfa 100%)",
              border: "2px solid #5eead4",
            }}
          >
            <p className="text-base font-bold leading-relaxed" style={{ color: "#065f46" }}>
              {prescription.diagnosis_ar}
            </p>
          </div>
        </>
      )}

      <PdfSectionTitle color="#059669">الأدوية الموصوفة</PdfSectionTitle>

      <PdfTable
        variant="prescription"
        headers={["#", "الدواء", "الجرعة", "التكرار", "المدة"]}
      >
        {prescription.medications.map((med, i) => (
          <tr
            key={i}
            style={{
              borderBottom: "1px solid #f1f5f9",
              backgroundColor: i % 2 === 0 ? "#ffffff" : "#f0fdf4",
            }}
          >
            <td
              className="px-3 py-3 tabular-nums font-black"
              style={{ color: "#059669", width: "36px" }}
            >
              {i + 1}
            </td>
            <td className="px-3 py-3">
              <span className="font-black" style={{ fontSize: "15px", color: "#0f172a" }}>
                {med.drug_name_ar}
              </span>
              {med.instructions && (
                <p className="mt-1 text-xs font-medium leading-relaxed" style={{ color: "#64748b" }}>
                  {med.instructions}
                </p>
              )}
            </td>
            <td className="px-3 py-3 font-semibold" style={{ color: "#334155" }}>
              {med.dosage ?? "—"}
            </td>
            <td className="px-3 py-3 font-semibold" style={{ color: "#334155" }}>
              {med.frequency ?? "—"}
            </td>
            <td className="px-3 py-3 font-semibold" style={{ color: "#334155" }}>
              {med.duration ?? "—"}
            </td>
          </tr>
        ))}
      </PdfTable>

      {prescription.notes_ar && (
        <div
          className="mt-5 rounded-xl px-4 py-3"
          style={{
            backgroundColor: "#fffbeb",
            border: "2px solid #fbbf24",
          }}
        >
          <p className="text-xs font-black" style={{ color: "#92400e" }}>
            ملاحظات الطبيب
          </p>
          <p className="mt-1 text-sm font-semibold leading-relaxed" style={{ color: "#78350f" }}>
            {prescription.notes_ar}
          </p>
        </div>
      )}

      <div
        className="mt-6 flex items-center justify-between rounded-xl px-4 py-3"
        style={{
          border: "1px dashed #94a3b8",
          backgroundColor: "#ffffff",
        }}
      >
        <span className="text-xs font-bold" style={{ color: "#64748b" }}>
          توقيع الطبيب
        </span>
        <span className="text-sm font-black" style={{ color: "#059669" }}>
          {formatDoctorDisplayName(doctorName)}
        </span>
      </div>
    </ClinicalPdfShell>
  );
}
