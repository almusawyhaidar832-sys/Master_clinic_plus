"use client";

import { useEffect, useState, Suspense } from "react";
import { useSearchParams } from "next/navigation";
import { Button } from "@/components/ui/Button";
import { PatientSearchField } from "@/components/patients/PatientSearchField";
import { PatientStatementDocument } from "@/components/doctor/PatientStatementDocument";
import { ReportActions } from "@/components/reports/ReportActions";
import { downloadPatientStatementPdf } from "@/lib/reports/pdf-export";
import { useClinicProfile } from "@/contexts/ClinicProfileContext";
import { createClient } from "@/lib/supabase/client";
import { getDoctorForCurrentUser } from "@/lib/clinic-context";
import { fetchPatientTreatmentCases } from "@/lib/services/patient-treatment-cases";
import type { PatientTreatmentCase } from "@/lib/services/patient-treatment-cases";
import type { Patient, PatientOperation, MedicalLog } from "@/types";
import { VisitSessionClinicalPanel } from "@/components/clinical/VisitSessionClinicalPanel";

function StatementContent() {
  const searchParams = useSearchParams();
  const preselectedId = searchParams.get("patientId");
  const queueEntryId = searchParams.get("queue_entry_id");
  const { profile, displayName } = useClinicProfile();

  const [patientQuery, setPatientQuery] = useState("");
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
    if (!preselectedId) return;

    async function loadPreselected() {
      const supabase = createClient();
      const { data } = await supabase
        .from("patients")
        .select("id, full_name_ar")
        .eq("id", preselectedId)
        .maybeSingle();

      if (data) {
        setPatientId(data.id);
        setPatientQuery(String(data.full_name_ar ?? ""));
      }
    }

    void loadPreselected();
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
        <div className="w-full space-y-1.5">
          <label className="block text-sm font-medium text-slate-text">
            اختر المراجع
          </label>
          <PatientSearchField
            value={patientQuery}
            onChange={(value) => {
              setPatientQuery(value);
              setPatientId("");
              setGenerated(false);
            }}
            onSelect={(p) => {
              setPatientId(p.id);
              setPatientQuery(p.full_name_ar);
              setGenerated(false);
            }}
            portal="doctor"
            selectedPatientId={patientId || null}
            placeholder="اكتب أول حرفين من اسم المراجع..."
            inputClassName="h-10"
          />
          <p className="text-xs text-slate-muted">
            ابحث بالاسم أو رقم الهاتف — يظهر مراجعوك فقط
          </p>
        </div>
        <Button className="w-full" onClick={generate} disabled={!patientId}>
          إنشاء الكشف
        </Button>
      </div>

      {patientId && (
        <div className="no-print rounded-2xl border border-teal-100 bg-white p-4 shadow-sm">
          <VisitSessionClinicalPanel
            patientId={patientId}
            queueEntryId={queueEntryId}
            portal="doctor"
            showSendToAccounting
            defaultOpen
          />
        </div>
      )}

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
