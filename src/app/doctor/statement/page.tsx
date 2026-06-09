"use client";

import { useEffect, useState, Suspense } from "react";
import { useSearchParams } from "next/navigation";
import { Button } from "@/components/ui/Button";
import { Select } from "@/components/ui/Select";
import { PatientStatementDocument } from "@/components/doctor/PatientStatementDocument";
import { ReportActions } from "@/components/reports/ReportActions";
import { downloadPatientStatementPdf } from "@/lib/reports/pdf-export";
import { useClinicProfile } from "@/contexts/ClinicProfileContext";
import { createClient } from "@/lib/supabase/client";
import { getDoctorForCurrentUser } from "@/lib/clinic-context";
import { fetchPatientsForCurrentDoctor } from "@/lib/services/doctor-patients";
import { fetchPatientTreatmentCases } from "@/lib/services/patient-treatment-cases";
import type { PatientTreatmentCase } from "@/lib/services/patient-treatment-cases";
import type { Patient, PatientOperation, MedicalLog } from "@/types";

function StatementContent() {
  const searchParams = useSearchParams();
  const preselectedId = searchParams.get("patientId");
  const { profile, displayName } = useClinicProfile();

  const [patients, setPatients] = useState<{ value: string; label: string }[]>(
    []
  );
  const [patientId, setPatientId] = useState(preselectedId ?? "");
  const [patient, setPatient] = useState<Patient | null>(null);
  const [operations, setOperations] = useState<PatientOperation[]>([]);
  const [treatmentCases, setTreatmentCases] = useState<PatientTreatmentCase[]>(
    []
  );
  const [logs, setLogs] = useState<
    (MedicalLog & { doctor?: { full_name_ar: string } })[]
  >([]);
  const [generated, setGenerated] = useState(false);
  const [pdfLoading, setPdfLoading] = useState(false);

  useEffect(() => {
    async function loadPatients() {
      const supabase = createClient();
      const list = await fetchPatientsForCurrentDoctor(supabase);
      setPatients(
        list.map((p) => ({
          value: p.id,
          label: p.full_name_ar,
        }))
      );
    }
    loadPatients();
  }, []);

  useEffect(() => {
    if (preselectedId) setPatientId(preselectedId);
  }, [preselectedId]);

  async function generate() {
    if (!patientId) return;
    const supabase = createClient();
    const doctor = await getDoctorForCurrentUser(supabase);
    if (!doctor) return;

    const [pRes, oRes, lRes, cases] = await Promise.all([
      supabase.from("patients").select("*").eq("id", patientId).single(),
      supabase
        .from("patient_operations")
        .select("*, doctor:doctors!doctor_id(full_name_ar)")
        .eq("patient_id", patientId)
        .eq("doctor_id", doctor.id)
        .order("operation_date", { ascending: false }),
      supabase
        .from("medical_logs")
        .select("*, doctor:doctors!doctor_id(full_name_ar)")
        .eq("patient_id", patientId)
        .eq("doctor_id", doctor.id)
        .order("log_date", { ascending: false }),
      fetchPatientTreatmentCases(supabase, patientId, doctor.clinic_id),
    ]);
    if (pRes.data) setPatient(pRes.data as Patient);
    setOperations((oRes.data as PatientOperation[]) || []);
    setLogs(lRes.data ?? []);
    setTreatmentCases(cases);
    setGenerated(true);
  }

  return (
    <div className="space-y-4">
      <h2 className="text-lg font-bold text-slate-text no-print">
        كشف حساب مريض
      </h2>

      <div className="no-print space-y-3">
        <Select
          label="اختر المريض"
          value={patientId}
          onChange={(e) => {
            setPatientId(e.target.value);
            setGenerated(false);
          }}
          options={patients}
          placeholder="اختر مريضاً"
        />
        <Button className="w-full" onClick={generate} disabled={!patientId}>
          إنشاء الكشف
        </Button>
      </div>

      {generated && patient && (
        <div className="space-y-4">
          <ReportActions
            shareTitle={`كشف حساب ${patient.full_name_ar} — ${displayName}`}
            printTargetId="patient-statement-print"
            pdfLoading={pdfLoading}
            onExportPdf={async () => {
              setPdfLoading(true);
              try {
                await downloadPatientStatementPdf({
                  clinicName: displayName,
                  patientName: patient.full_name_ar,
                  periodLabel: "كشف حساب كامل",
                  generatedAt: new Date().toLocaleString("ar-IQ"),
                  elementId: "patient-statement-print",
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
            medicalLogs={logs}
            clinic={profile}
          />
        </div>
      )}
    </div>
  );
}

export default function PatientStatementPage() {
  return (
    <Suspense fallback={<p className="text-slate-muted">جاري التحميل...</p>}>
      <StatementContent />
    </Suspense>
  );
}
