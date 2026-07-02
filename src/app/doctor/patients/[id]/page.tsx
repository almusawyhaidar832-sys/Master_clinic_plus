"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import { Button } from "@/components/ui/Button";
import { Card, CardHeader, CardTitle } from "@/components/ui/Card";
import { Alert } from "@/components/ui/Alert";
import { createClient } from "@/lib/supabase/client";
import { getDoctorForCurrentUser } from "@/lib/clinic-context";
import {
  patientBelongsToDoctor,
  filterTreatmentCasesForDoctor,
} from "@/lib/services/doctor-patients";
import { formatDate } from "@/lib/utils";
import { formatDoctorDisplayName } from "@/lib/services/clinic-profile";
import type { Doctor, Patient, MedicalLog, Treatment, PatientOperation } from "@/types";
import { VisitSessionClinicalPanel } from "@/components/clinical/VisitSessionClinicalPanel";
import { fetchPatientClinicalRecords } from "@/lib/clinical/fetch-patient-clinical";
import type { ClinicalByOperationId } from "@/lib/clinical/types";
import { getPatientDisplayPhone } from "@/lib/phone";
import {
  fetchPatientTreatmentCases,
  type PatientTreatmentCase,
} from "@/lib/services/patient-treatment-cases";
import { fetchPatientOperationsForProfile } from "@/lib/services/patient-operations-profile";
import {
  buildPatientCaseGroups,
  sumCaseGroupsFinancials,
} from "@/lib/services/patient-case-groups";
import { PatientSessionsByCase } from "@/components/patients/PatientSessionsByCase";
import { FINANCIAL_EPSILON } from "@/lib/services/patient-financial-plan";
import { ArrowRight, FileText, Plus, X } from "lucide-react";
import { useClinicSync } from "@/hooks/useClinicSync";
import { useLanguage } from "@/contexts/LanguageContext";
import {
  doctorPatientLogDraftKey,
  hasDoctorPatientLogDraftContent,
  type DoctorPatientLogDraft,
} from "@/lib/forms/portal-form-drafts";
import { useSessionFormDraft } from "@/hooks/useSessionFormDraft";

export default function DoctorPatientDetailPage() {
  const { t, formatMoney, dateLocale } = useLanguage();
  const params = useParams();
  const id = params.id as string;
  const [patient, setPatient] = useState<Patient | null>(null);
  const [operations, setOperations] = useState<PatientOperation[]>([]);
  const [treatmentCases, setTreatmentCases] = useState<PatientTreatmentCase[]>([]);
  const [logs, setLogs] = useState<MedicalLog[]>([]);
  const [treatments, setTreatments] = useState<Treatment[]>([]);
  const [newLog, setNewLog] = useState("");
  const [saving, setSaving] = useState(false);
  const [doctor, setDoctor] = useState<Doctor | null>(null);
  const [showClinicalPanel, setShowClinicalPanel] = useState(false);
  const [clinicalByOp, setClinicalByOp] = useState<ClinicalByOperationId>({});
  const [accessDenied, setAccessDenied] = useState(false);

  const applyLogDraft = useCallback((draft: DoctorPatientLogDraft) => {
    setNewLog(draft.newLog);
  }, []);

  const logDraftSnapshot = useMemo(() => ({ newLog }), [newLog]);

  const { draftRestored, dismissDraftNotice, clearDraft } = useSessionFormDraft(
    doctorPatientLogDraftKey(id),
    logDraftSnapshot,
    applyLogDraft,
    { hasContent: hasDoctorPatientLogDraftContent }
  );

  const doctorCases = useMemo(
    () => filterTreatmentCasesForDoctor(treatmentCases, operations),
    [treatmentCases, operations]
  );

  const caseGroups = useMemo(
    () =>
      buildPatientCaseGroups(operations, doctorCases, {
        clinicalSessionsOnly: true,
        clinicalByOp,
      }),
    [operations, doctorCases, clinicalByOp]
  );

  const caseTotals = useMemo(
    () => sumCaseGroupsFinancials(caseGroups),
    [caseGroups]
  );
  const totalPaid = caseTotals.totalPaid;
  const totalDebt = caseTotals.totalRemaining;
  const clinicalSessionCount = caseTotals.sessionCount;

  const reloadOperations = useCallback(async () => {
    const supabase = createClient();
    const doc = await getDoctorForCurrentUser(supabase);
    if (!doc) return;

    const ops = await fetchPatientOperationsForProfile(supabase, id, {
      doctorId: doc.id,
    });
    setOperations(ops);
    const clinical = await fetchPatientClinicalRecords(id);
    setClinicalByOp(clinical);
  }, [id]);

  const loadTreatmentCases = useCallback(async () => {
    const supabase = createClient();
    const cases = await fetchPatientTreatmentCases(supabase, id);
    setTreatmentCases(cases);
  }, [id]);

  const refreshPatientData = useCallback(async () => {
    await Promise.all([reloadOperations(), loadTreatmentCases()]);
  }, [reloadOperations, loadTreatmentCases]);

  useClinicSync({
    topics: ["sessions", "refunds"],
    doctorId: doctor?.id,
    patientId: id,
    onRefresh: refreshPatientData,
    enabled: !!doctor?.id && !accessDenied,
  });

  useEffect(() => {
    async function load() {
      const supabase = createClient();
      const doc = await getDoctorForCurrentUser(supabase);
      setDoctor(doc);
      if (!doc) {
        setAccessDenied(true);
        return;
      }
      const allowed = await patientBelongsToDoctor(supabase, id, doc.id);
      if (!allowed) {
        setAccessDenied(true);
        return;
      }
      setAccessDenied(false);

      const [pRes, lRes, tRes] = await Promise.all([
        supabase.from("patients").select("*").eq("id", id).single(),
        supabase
          .from("medical_logs")
          .select("*, doctor:doctors!doctor_id(full_name_ar)")
          .eq("patient_id", id)
          .eq("doctor_id", doc.id)
          .order("log_date", { ascending: false }),
        supabase
          .from("treatments")
          .select("*")
          .eq("patient_id", id)
          .eq("doctor_id", doc.id)
          .eq("status", "active"),
      ]);

      if (pRes.data) setPatient(pRes.data as Patient);
      setLogs((lRes.data as MedicalLog[]) || []);
      setTreatments((tRes.data as Treatment[]) || []);

      await Promise.all([reloadOperations(), loadTreatmentCases()]);
    }
    if (id) load();
  }, [id, reloadOperations, loadTreatmentCases]);

  useEffect(() => {
    if (!patient || typeof window === "undefined") return;
    if (window.location.hash !== "#patient-sessions") return;
    window.requestAnimationFrame(() => {
      document
        .getElementById("patient-sessions")
        ?.scrollIntoView({ behavior: "smooth", block: "start" });
    });
  }, [patient, operations.length]);

  async function addLog() {
    if (!newLog.trim()) return;
    const supabase = createClient();
    const currentDoctor = await getDoctorForCurrentUser(supabase);
    if (!currentDoctor) return;

    setSaving(true);
    const { data } = await supabase
      .from("medical_logs")
      .insert({
        clinic_id: currentDoctor.clinic_id,
        patient_id: id,
        doctor_id: currentDoctor.id,
        content_ar: newLog.trim(),
      })
      .select()
      .single();

    setSaving(false);
    if (data) {
      setLogs((prev) => [data as MedicalLog, ...prev]);
      setNewLog("");
      clearDraft();
    }
  }

  if (accessDenied) {
    return (
      <div className="space-y-4">
        <Link href="/doctor/patients">
          <Button variant="ghost" size="sm">
            <ArrowRight className="h-4 w-4" />
            {t("docPatientList")}
          </Button>
        </Link>
        <p className="text-sm text-slate-muted">
          {t("docPatientNotLinked")}
        </p>
      </div>
    );
  }

  if (!patient) {
    return <p className="text-slate-muted">{t("loading")}</p>;
  }

  return (
    <div className="space-y-4">
      <Link href="/doctor/patients">
        <Button variant="ghost" size="sm">
          <ArrowRight className="h-4 w-4" />
          {t("docPatientList")}
        </Button>
      </Link>

      <Card>
        <CardHeader>
          <div className="flex items-center gap-3">
            <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-primary to-primary-700 text-base font-bold text-white shadow-sm">
              {patient.full_name_ar.slice(0, 2)}
            </div>
            <div>
              <CardTitle>{patient.full_name_ar}</CardTitle>
              {getPatientDisplayPhone(patient) && (
                <p dir="ltr" className="text-sm text-slate-muted">
                  {getPatientDisplayPhone(patient)}
                </p>
              )}
            </div>
          </div>
        </CardHeader>

        <div className="grid grid-cols-3 gap-3 px-4 pb-4">
          <div className="mc-stat-neutral">
            <p className="mc-stat-value">{clinicalSessionCount}</p>
            <p className="mc-stat-label">{t("docTreatmentSessions")}</p>
          </div>
          <div className="mc-stat-primary">
            <p className="mc-stat-value">{formatMoney(totalPaid)}</p>
            <p className="mc-stat-label">{t("paid")}</p>
          </div>
          <div
            className={totalDebt > FINANCIAL_EPSILON ? "mc-stat-debt" : "mc-stat-success"}
          >
            <p className="mc-stat-value">{formatMoney(totalDebt)}</p>
            <p className="mc-stat-label">
              {totalDebt > FINANCIAL_EPSILON ? t("docRemainingDebt") : t("docNoDebt")}
            </p>
          </div>
        </div>

        <div className="flex flex-col gap-2 px-4 pb-4">
          <Button
            variant="primary"
            size="sm"
            className="w-full"
            onClick={() => setShowClinicalPanel((v) => !v)}
          >
            {showClinicalPanel ? (
              <>
                <X className="h-4 w-4" />
                {t("docCloseClinicalRecord")}
              </>
            ) : (
              <>
                <Plus className="h-4 w-4" />
                {t("docOpenClinicalRecord")}
              </>
            )}
          </Button>
          <p className="text-center text-xs text-slate-muted">
            {t("docBillingAccountantOnly")}
          </p>
          <Link href={`/doctor/statement?patientId=${id}`}>
            <Button variant="outline" size="sm" className="w-full">
              <FileText className="h-4 w-4" />
              {t("docStatementShare")}
            </Button>
          </Link>
        </div>
      </Card>

      {showClinicalPanel && (
        <VisitSessionClinicalPanel
          patientId={id}
          portal="doctor"
          showSendToAccounting={false}
          defaultOpen
        />
      )}

      {treatments.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">{t("docActiveTreatments")}</CardTitle>
          </CardHeader>
          <ul className="space-y-2 px-4 pb-4 text-sm">
            {treatments.map((t) => (
              <li key={t.id} className="rounded bg-amber-50 p-2">
                {t.title_ar} ({t.completed_sessions}/{t.expected_sessions})
              </li>
            ))}
          </ul>
        </Card>
      )}

      <div id="patient-sessions">
        <h3 className="mb-1 text-lg font-semibold text-slate-text">
          {t("docSessionsByCase")}
        </h3>
        <p className="mb-3 text-xs text-slate-muted">
          {t("docSessionsByCaseHint")}
        </p>

        {operations.length === 0 && doctorCases.length === 0 ? (
          <Alert variant="info">{t("docNoCasesWithYou")}</Alert>
        ) : (
          <PatientSessionsByCase
            patientId={id}
            operations={operations}
            treatmentCases={doctorCases}
            clinicalByOp={clinicalByOp}
            onClinicalSaved={reloadOperations}
            showContinueActions={false}
            allowEdit={false}
            viewMode="clinical"
          />
        )}
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">{t("docAddMedicalNote")}</CardTitle>
        </CardHeader>
        <div className="px-4 pb-4">
          {draftRestored && (
            <Alert variant="info" className="mb-2">
              تم استعادة الملاحظة التي كتبتها.
              <button
                type="button"
                className="mr-2 underline"
                onClick={dismissDraftNotice}
              >
                إخفاء
              </button>
            </Alert>
          )}
          <textarea
            className="mb-2 w-full rounded-lg border border-slate-border p-3 text-sm"
            rows={3}
            value={newLog}
            onChange={(e) => setNewLog(e.target.value)}
            placeholder={t("docVisitNotesPlaceholder")}
          />
          <Button size="sm" onClick={addLog} disabled={saving}>
            {saving ? t("saving") : t("docSaveRecord")}
          </Button>
          {logs.length > 0 && (
            <ul className="mt-4 space-y-2 text-sm">
              {logs.map((log) => (
                <li key={log.id} className="rounded bg-surface p-2">
                  <p className="text-xs text-slate-muted">
                    {formatDate(log.log_date, dateLocale)}
                  </p>
                  <p className="mb-1 text-xs text-primary">
                    {formatDoctorDisplayName(
                      (log as { doctor?: { full_name_ar: string } }).doctor
                        ?.full_name_ar ?? doctor?.full_name_ar
                    )}
                  </p>
                  <p>{log.content_ar}</p>
                </li>
              ))}
            </ul>
          )}
        </div>
      </Card>
    </div>
  );
}
