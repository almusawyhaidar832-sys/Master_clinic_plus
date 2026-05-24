"use client";

import { useEffect, useState, Suspense } from "react";
import { useSearchParams } from "next/navigation";
import { Button } from "@/components/ui/Button";
import { Select } from "@/components/ui/Select";
import { PatientStatementDocument } from "@/components/doctor/PatientStatementDocument";
import { ReportActions } from "@/components/reports/ReportActions";
import { useClinicProfile } from "@/contexts/ClinicProfileContext";
import { createClient } from "@/lib/supabase/client";
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
  const [logs, setLogs] = useState<
    (MedicalLog & { doctor?: { full_name_ar: string } })[]
  >([]);
  const [generated, setGenerated] = useState(false);

  useEffect(() => {
    async function loadPatients() {
      const supabase = createClient();
      const { data } = await supabase
        .from("patients")
        .select("id, full_name_ar")
        .order("full_name_ar");
      setPatients(
        (data ?? []).map((p: { id: string; full_name_ar: string }) => ({
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
    const [pRes, oRes, lRes] = await Promise.all([
      supabase.from("patients").select("*").eq("id", patientId).single(),
      supabase
        .from("patient_operations")
        .select("*, doctor:doctors(full_name_ar)")
        .eq("patient_id", patientId)
        .order("operation_date", { ascending: false }),
      supabase
        .from("medical_logs")
        .select("*, doctor:doctors(full_name_ar)")
        .eq("patient_id", patientId)
        .order("log_date", { ascending: false }),
    ]);
    if (pRes.data) setPatient(pRes.data as Patient);
    setOperations((oRes.data as PatientOperation[]) || []);
    setLogs(lRes.data ?? []);
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
          />
          <PatientStatementDocument
            patient={patient}
            operations={operations}
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
