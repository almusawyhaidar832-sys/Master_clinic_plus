"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import { Button } from "@/components/ui/Button";
import { Alert } from "@/components/ui/Alert";
import { StatTile } from "@/components/ui/StatTile";
import { createClient } from "@/lib/supabase/client";
import { getDoctorForCurrentUser } from "@/lib/clinic-context";
import {
  patientBelongsToDoctor,
  filterTreatmentCasesForDoctor,
} from "@/lib/services/doctor-patients";
import { formatDate } from "@/lib/utils";
import { formatDoctorDisplayName } from "@/lib/services/clinic-profile";
import type { Doctor, Patient, MedicalLog, Treatment, PatientOperation } from "@/types";
import { VisitSessionClinicalPanel } from "@/components/clinical/VisitSessionClinicalPanel.lazy";
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
import {
  Activity,
  AlertCircle,
  ArrowRight,
  CalendarCheck,
  CheckCircle2,
  ClipboardList,
  FileText,
  NotebookPen,
  Phone,
  Plus,
  Wallet,
  X,
} from "lucide-react";
import { useClinicSync } from "@/hooks/useClinicSync";
import { useLanguage } from "@/contexts/LanguageContext";
import { OfflineViewBanner } from "@/components/offline/OfflineViewBanner";
import { isBrowserOffline } from "@/lib/offline/network";
import {
  readPatientProfileCacheForPatient,
  writePatientProfileCache,
} from "@/lib/offline/patient-profile-cache";
import {
  cacheXraysForClinicalData,
  hydrateClinicalWithCachedXrays,
} from "@/lib/offline/clinical-xray-cache";
import {
  doctorPatientLogDraftKey,
  hasDoctorPatientLogDraftContent,
  type DoctorPatientLogDraft,
} from "@/lib/forms/portal-form-drafts";
import { useSessionFormDraft } from "@/hooks/useSessionFormDraft";

export default function DoctorPatientDetailPage() {
  const { t, bi, formatMoney, dateLocale } = useLanguage();
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
  const [refreshing, setRefreshing] = useState(false);
  const [offlineView, setOfflineView] = useState(false);
  const [cachedAt, setCachedAt] = useState<number | null>(null);
  const [offlineMiss, setOfflineMiss] = useState(false);

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
    topics: ["sessions", "refunds", "financial"],
    doctorId: doctor?.id,
    patientId: id,
    onRefresh: refreshPatientData,
    enabled: !!doctor?.id && !accessDenied,
  });

  useEffect(() => {
    async function load() {
      setOfflineMiss(false);
      setRefreshing(false);

      const supabase = createClient();
      const doc = await getDoctorForCurrentUser(supabase);
      setDoctor(doc);

      const applyBundle = async (
        bundle: NonNullable<ReturnType<typeof readPatientProfileCacheForPatient>>
      ) => {
        const hydratedClinical = await hydrateClinicalWithCachedXrays(
          id,
          bundle.clinicalByOp
        );
        setPatient(bundle.patient);
        setOperations(bundle.operations);
        setTreatmentCases(bundle.treatmentCases);
        setClinicalByOp(hydratedClinical);
        setLogs(bundle.medicalLogs);
        setTreatments(bundle.treatments ?? []);
        setCachedAt(bundle.cachedAt);
      };

      const cached = readPatientProfileCacheForPatient("doctor", id, doc?.id);

      if (cached && (!doc?.id || !cached.doctorId || cached.doctorId === doc.id)) {
        await applyBundle(cached);
        setAccessDenied(false);
        if (isBrowserOffline()) {
          setOfflineView(true);
          return;
        }
        setOfflineView(false);
        setRefreshing(true);
      }

      if (!doc) {
        if (!cached) setAccessDenied(true);
        setRefreshing(false);
        return;
      }

      if (isBrowserOffline()) {
        if (!cached) setOfflineMiss(true);
        setRefreshing(false);
        return;
      }

      const allowed = await patientBelongsToDoctor(supabase, id, doc.id);
      if (!allowed) {
        setAccessDenied(true);
        setRefreshing(false);
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
      const nextLogs = (lRes.data as MedicalLog[]) || [];
      const nextTreatments = (tRes.data as Treatment[]) || [];
      setLogs(nextLogs);
      setTreatments(nextTreatments);

      const [ops, clinical, cases] = await Promise.all([
        fetchPatientOperationsForProfile(supabase, id, { doctorId: doc.id }),
        fetchPatientClinicalRecords(id),
        fetchPatientTreatmentCases(supabase, id),
      ]);
      setOperations(ops);
      setClinicalByOp(clinical);
      setTreatmentCases(cases);

      if (pRes.data) {
        writePatientProfileCache({
          portal: "doctor",
          clinicId: doc.clinic_id,
          patientId: id,
          doctorId: doc.id,
          patient: pRes.data as Patient,
          operations: ops,
          treatmentCases: cases,
          clinicalByOp: clinical,
          medicalLogs: nextLogs,
          treatments: nextTreatments,
        });
        void cacheXraysForClinicalData(id, clinical);
      }

      setOfflineView(false);
      setCachedAt(Date.now());
      setRefreshing(false);
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
        <Link href="/doctor/patients" className="mc-btn-soft">
          <ArrowRight className="h-4 w-4 ltr:rotate-180" />
          {t("docPatientList")}
        </Link>
        <Alert variant="warning">{t("docPatientNotLinked")}</Alert>
      </div>
    );
  }

  if (!patient) {
    if (offlineMiss) {
      return (
        <div className="space-y-4">
          <Link href="/doctor/patients" className="mc-btn-soft">
            <ArrowRight className="h-4 w-4 ltr:rotate-180" />
            {t("docPatientList")}
          </Link>
          <Alert variant="warning">{t("offlinePatientCacheMiss")}</Alert>
        </div>
      );
    }
    return (
      <div className="space-y-4" aria-label={t("loading")}>
        <div className="mc-skeleton h-36 rounded-3xl" />
        <div className="grid grid-cols-3 gap-2.5">
          <div className="mc-skeleton h-20 rounded-2xl" />
          <div className="mc-skeleton h-20 rounded-2xl" />
          <div className="mc-skeleton h-20 rounded-2xl" />
        </div>
        <p className="text-center text-sm text-slate-muted">{t("loading")}</p>
      </div>
    );
  }

  return (
    <div className="space-y-5">
      <OfflineViewBanner
        refreshing={refreshing}
        offline={offlineView}
        cachedAt={cachedAt}
        refreshingLabel={t("offlineViewRefreshing")}
        offlineLabel={t("offlineViewCachedAt")}
      />
      <Link
        href="/doctor/patients"
        className="inline-flex items-center gap-1.5 text-sm font-semibold text-primary-600 hover:text-primary-800"
      >
        <ArrowRight className="h-4 w-4 ltr:rotate-180" />
        {t("docPatientList")}
      </Link>

      <section className="mc-panel rounded-3xl">
        <div className="relative p-5">
          <div
            aria-hidden
            className="pointer-events-none absolute inset-x-0 top-0 h-20 bg-gradient-to-b from-premium-100/40 to-transparent dark:from-premium-500/10"
          />
          <div className="relative flex items-center gap-4">
            <div className="flex h-16 w-16 shrink-0 items-center justify-center rounded-3xl bg-mc-pearl text-xl font-bold text-[#0b1f3a] shadow-gold ring-1 ring-inset ring-premium-300/60">
              {patient.full_name_ar.slice(0, 2)}
            </div>
            <div className="min-w-0">
              <p className="text-[11px] font-bold uppercase tracking-[0.14em] text-premium-600">
                {bi("بوابة الطبيب", "Doctor portal")}
              </p>
              <h1 className="mt-0.5 truncate text-xl font-bold text-slate-text">
                {patient.full_name_ar}
              </h1>
              {getPatientDisplayPhone(patient) && (
                <p dir="ltr" className="mt-1 inline-flex items-center gap-1.5 text-sm text-slate-muted tabular-nums">
                  <Phone className="h-3.5 w-3.5 text-premium-500" />
                  {getPatientDisplayPhone(patient)}
                </p>
              )}
            </div>
          </div>

          <div className="relative mt-5 grid grid-cols-1 gap-2.5 sm:grid-cols-3">
            <StatTile
              icon={CalendarCheck}
              tone="navy"
              value={<span className="tabular-nums">{clinicalSessionCount}</span>}
              label={t("docTreatmentSessions")}
            />
            <StatTile
              icon={Wallet}
              tone="gold"
              value={<span className="tabular-nums">{formatMoney(totalPaid)}</span>}
              label={t("paid")}
            />
            <StatTile
              icon={totalDebt > FINANCIAL_EPSILON ? AlertCircle : CheckCircle2}
              tone={totalDebt > FINANCIAL_EPSILON ? "danger" : "success"}
              value={<span className="tabular-nums">{formatMoney(totalDebt)}</span>}
              label={
                totalDebt > FINANCIAL_EPSILON ? t("docRemainingDebt") : t("docNoDebt")
              }
            />
          </div>
        </div>

        <div className="flex flex-col gap-2.5 border-t border-slate-border bg-surface px-5 py-4">
          <Button
            variant="primary"
            size="md"
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
          <Link href={`/doctor/statement?patientId=${id}`} className="mc-btn-soft w-full py-2.5">
            <FileText className="h-4 w-4 text-premium-500" />
            {t("docStatementShare")}
          </Link>
        </div>
      </section>

      {showClinicalPanel && (
        <VisitSessionClinicalPanel
          patientId={id}
          portal="doctor"
          showSendToAccounting={false}
          defaultOpen
        />
      )}

      {treatments.length > 0 && (
        <section className="mc-panel">
          <div className="mc-panel-head">
            <h3 className="mc-panel-title">
              <Activity />
              {t("docActiveTreatments")}
            </h3>
          </div>
          <ul className="divide-y divide-slate-border text-sm">
            {treatments.map((t) => (
              <li key={t.id} className="flex items-center justify-between gap-3 px-5 py-3">
                <span className="min-w-0 truncate font-medium text-slate-text">{t.title_ar}</span>
                <span className="shrink-0 rounded-full border border-warning-border bg-warning px-2.5 py-0.5 text-xs font-bold text-warning-text tabular-nums">
                  ({t.completed_sessions}/{t.expected_sessions})
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}

      <div id="patient-sessions" className="space-y-3">
        <div className="flex items-start gap-3 px-1">
          <span className="mc-icon-tile h-9 w-9 rounded-xl">
            <ClipboardList className="h-4 w-4" />
          </span>
          <div className="min-w-0">
            <h3 className="text-lg font-bold text-slate-text">
              {t("docSessionsByCase")}
            </h3>
            <p className="text-xs text-slate-muted">
              {t("docSessionsByCaseHint")}
            </p>
          </div>
        </div>

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

      <section className="mc-panel">
        <div className="mc-panel-head">
          <h3 className="mc-panel-title">
            <NotebookPen />
            {t("docAddMedicalNote")}
          </h3>
        </div>
        <div className="mc-panel-body space-y-3">
          {draftRestored && (
            <Alert variant="info">
              تم استعادة الملاحظة التي كتبتها.
              <button
                type="button"
                className="ms-2 underline"
                onClick={dismissDraftNotice}
              >
                إخفاء
              </button>
            </Alert>
          )}
          <textarea
            className="mc-field min-h-[96px] resize-y leading-relaxed"
            rows={3}
            value={newLog}
            onChange={(e) => setNewLog(e.target.value)}
            placeholder={t("docVisitNotesPlaceholder")}
          />
          <div className="flex justify-end">
            <Button size="sm" onClick={addLog} disabled={saving}>
              {saving ? t("saving") : t("docSaveRecord")}
            </Button>
          </div>
          {logs.length > 0 && (
            <ol className="relative mt-2 space-y-3 border-s-2 border-premium-300/50 ps-5 text-sm">
              {logs.map((log) => (
                <li key={log.id} className="relative">
                  <span
                    aria-hidden
                    className="absolute -start-[27px] top-3 h-3 w-3 rounded-full border-2 border-surface-card bg-premium-500 shadow-gold"
                  />
                  <div className="rounded-xl border border-slate-border bg-surface p-3">
                    <div className="mb-1.5 flex flex-wrap items-center justify-between gap-2">
                      <p className="text-xs font-semibold text-primary-700 dark:text-primary-300">
                        {formatDoctorDisplayName(
                          (log as { doctor?: { full_name_ar: string } }).doctor
                            ?.full_name_ar ?? doctor?.full_name_ar
                        )}
                      </p>
                      <p className="text-[11px] text-slate-muted tabular-nums">
                        {formatDate(log.log_date, dateLocale)}
                      </p>
                    </div>
                    <p className="leading-relaxed text-slate-text">{log.content_ar}</p>
                  </div>
                </li>
              ))}
            </ol>
          )}
        </div>
      </section>
    </div>
  );
}
