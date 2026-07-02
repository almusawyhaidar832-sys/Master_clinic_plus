"use client";

import { useEffect, useState, Suspense } from "react";
import { useSearchParams } from "next/navigation";
import { Button } from "@/components/ui/Button";
import { PatientSearchField } from "@/components/patients/PatientSearchField";
import { PatientStatementDocument } from "@/components/doctor/PatientStatementDocument";
import { ReportActions } from "@/components/reports/ReportActions";
import { downloadPatientStatementPdf } from "@/lib/reports/pdf-export";
import { useClinicProfile } from "@/contexts/ClinicProfileContext";
import { useLanguage } from "@/contexts/LanguageContext";
import { createClient } from "@/lib/supabase/client";
import { getDoctorForCurrentUser } from "@/lib/clinic-context";
import {
  patientBelongsToDoctor,
  filterTreatmentCasesForDoctor,
} from "@/lib/services/doctor-patients";
import {
  fetchPatientTreatmentCases,
  type PatientTreatmentCase,
} from "@/lib/services/patient-treatment-cases";
import type { Patient, PatientOperation, MedicalLog } from "@/types";
import { VisitSessionClinicalPanel } from "@/components/clinical/VisitSessionClinicalPanel";
import { Alert } from "@/components/ui/Alert";
import { FileText } from "lucide-react";

function StatementContent() {
  const searchParams = useSearchParams();
  const preselectedId = searchParams.get("patientId");
  const queueEntryId = searchParams.get("queue_entry_id");
  const { profile, displayName } = useClinicProfile();
  const { t, bi, dateLocale } = useLanguage();

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
  const [accessDenied, setAccessDenied] = useState(false);
  const [accessError, setAccessError] = useState("");

  useEffect(() => {
    if (!preselectedId) return;
    const activePatientId = preselectedId;

    async function loadPreselected() {
      const supabase = createClient();
      const doctor = await getDoctorForCurrentUser(supabase);
      if (!doctor) {
        setAccessDenied(true);
        return;
      }
      const allowed = await patientBelongsToDoctor(
        supabase,
        activePatientId,
        doctor.id
      );
      if (!allowed) {
        setAccessDenied(true);
        setAccessError(t("docPatientNotLinked"));
        return;
      }

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
  }, [preselectedId, t]);

  async function generate() {
    if (!patientId) return;
    const supabase = createClient();
    const doctor = await getDoctorForCurrentUser(supabase);
    if (!doctor) {
      setAccessDenied(true);
      return;
    }

    const allowed = await patientBelongsToDoctor(supabase, patientId, doctor.id);
    if (!allowed) {
      setAccessDenied(true);
      setAccessError(t("docPatientNotLinked"));
      setGenerated(false);
      return;
    }
    setAccessDenied(false);
    setAccessError("");

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
    const ops = (oRes.data as PatientOperation[]) || [];
    setOperations(ops);
    setLogs(lRes.data ?? []);
    setTreatmentCases(filterTreatmentCasesForDoctor(cases, ops));
    setGenerated(true);
  }

  return (
    <div className="space-y-4">
      <h2 className="no-print flex items-center gap-2 text-lg font-bold tracking-tight text-slate-text">
        <span className="mc-icon-badge-primary">
          <FileText className="h-4.5 w-4.5" />
        </span>
        {t("docStatementTitle")}
      </h2>

      {accessDenied && accessError && (
        <Alert variant="error" className="no-print">
          {accessError}
        </Alert>
      )}

      <div className="no-print space-y-3">
        <div className="w-full space-y-1.5">
          <label className="block text-sm font-medium text-slate-text">
            {t("docSelectPatient")}
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
            placeholder={t("docStatementSearchPlaceholder")}
            inputClassName="h-10"
          />
          <p className="text-xs text-slate-muted">
            {t("docSearchPatientPhoneHint")}
          </p>
        </div>
        <Button className="w-full" onClick={generate} disabled={!patientId}>
          {t("docGenerateStatement")}
        </Button>
      </div>

      {patientId && (
        <div className="no-print rounded-2xl border border-primary/15 bg-surface-card p-4 shadow-card">
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
            shareTitle={bi(
              `كشف حساب ${patient.full_name_ar} — ${displayName}`,
              `Statement for ${patient.full_name_ar} — ${displayName}`
            )}
            printTargetId="patient-statement-print"
            pdfLoading={pdfLoading}
            onExportPdf={async () => {
              setPdfLoading(true);
              try {
                await downloadPatientStatementPdf({
                  clinicName: displayName,
                  patientName: patient.full_name_ar,
                  periodLabel: t("docFullStatement"),
                  generatedAt: new Date().toLocaleString(dateLocale),
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
  const { t } = useLanguage();

  return (
    <Suspense fallback={<p className="text-slate-muted">{t("loading")}</p>}>
      <StatementContent />
    </Suspense>
  );
}
