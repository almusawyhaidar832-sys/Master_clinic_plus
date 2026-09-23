"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import { Button } from "@/components/ui/Button";
import { Alert } from "@/components/ui/Alert";
import { StatTile } from "@/components/ui/StatTile";
import { EmptyState } from "@/components/ui/EmptyState";
import { createClient } from "@/lib/supabase/client";
import { formatCurrency } from "@/lib/utils";
import { useClinicProfile } from "@/contexts/ClinicProfileContext";
import { useClinicSync } from "@/hooks/useClinicSync";
import { useLanguage } from "@/contexts/LanguageContext";
import { ClinicBrandingHeader } from "@/components/branding/ClinicBrandingHeader";
import { QuickEntryForm } from "@/components/accountant/QuickEntryForm.lazy";
import {
  computedCaseRemaining,
  FINANCIAL_EPSILON,
  isTreatmentCaseSettledForPicker,
} from "@/lib/services/patient-financial-plan";
import {
  fetchPatientTreatmentCases,
  isPersistedTreatmentCaseId,
  treatmentCaseDisplayLabel,
  type PatientTreatmentCase,
} from "@/lib/services/patient-treatment-cases";
import { getActiveClinicId } from "@/lib/clinic-context";
import { fetchPatientOperationsForProfile } from "@/lib/services/patient-operations-profile";
import {
  buildPatientCaseGroups,
  sumCaseGroupsFinancials,
} from "@/lib/services/patient-case-groups";
import { PatientSessionsByCase } from "@/components/patients/PatientSessionsByCase";
import { PatientMedicalArchive } from "@/components/patients/PatientMedicalArchive";
import { fetchPatientClinicalRecords } from "@/lib/clinical/fetch-patient-clinical";
import type { ClinicalByOperationId } from "@/lib/clinical/types";
import type { MedicalLog, Patient, PatientOperation } from "@/types";
import { cn } from "@/lib/utils";
import { getPatientDisplayPhone } from "@/lib/phone";
import { TransferDoctorPanel } from "@/components/patients/TransferDoctorPanel";
import { DeletePatientPanel } from "@/components/patients/DeletePatientPanel";
import { PatientBasicInfoEditor } from "@/components/patients/PatientBasicInfoEditor";
import { PatientSpeechNameEditor } from "@/components/patients/PatientSpeechNameEditor";
import type { PatientPrimaryDoctor } from "@/lib/services/patient-primary-doctor";
import { formatDoctorDisplayName } from "@/lib/services/clinic-profile";
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
  AlertCircle,
  ArrowRight,
  CalendarCheck,
  CheckCircle2,
  ClipboardList,
  FolderHeart,
  Layers,
  Phone,
  Plus,
  Wallet,
  X,
} from "lucide-react";

export default function PatientProfilePage() {
  const params = useParams();
  const id = params.id as string;
  const { profile, displayName } = useClinicProfile();
  const { bi } = useLanguage();
  const [activeTab, setActiveTab] = useState<"file" | "archive">("file");
  const [medicalLogs, setMedicalLogs] = useState<
    (MedicalLog & { doctor?: { full_name_ar: string } })[]
  >([]);
  const [patient, setPatient] = useState<Patient | null>(null);
  const [operations, setOperations] = useState<PatientOperation[]>([]);
  const [clinicalByOp, setClinicalByOp] = useState<ClinicalByOperationId>({});
  const [showAddSession, setShowAddSession] = useState(false);
  const [treatmentCases, setTreatmentCases] = useState<PatientTreatmentCase[]>(
    []
  );
  const [continueCaseId, setContinueCaseId] = useState<string | null>(null);
  const [newCasePrefillName, setNewCasePrefillName] = useState<string | null>(
    null
  );
  const sessionFormRef = useRef<HTMLDivElement>(null);
  const continueFormRef = useRef<HTMLDivElement>(null);
  const [caseDoctors, setCaseDoctors] = useState<
    Record<string, PatientPrimaryDoctor>
  >({});
  const [accessDenied, setAccessDenied] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [offlineView, setOfflineView] = useState(false);
  const [cachedAt, setCachedAt] = useState<number | null>(null);
  const [offlineMiss, setOfflineMiss] = useState(false);

  const continueCase = useMemo(
    () => treatmentCases.find((c) => c.id === continueCaseId) ?? null,
    [treatmentCases, continueCaseId]
  );

  const openContinueCase = useCallback(
    (caseId: string) => {
      const c = treatmentCases.find((x) => x.id === caseId);
      if (c && isTreatmentCaseSettledForPicker(c)) {
        setNewCasePrefillName(c.treatment_name_ar);
        setContinueCaseId(null);
        setShowAddSession(true);
        requestAnimationFrame(() => {
          sessionFormRef.current?.scrollIntoView({
            behavior: "smooth",
            block: "start",
          });
        });
        return;
      }
      setNewCasePrefillName(null);
      setContinueCaseId(caseId);
      setShowAddSession(false);
      requestAnimationFrame(() => {
        continueFormRef.current?.scrollIntoView({
          behavior: "smooth",
          block: "start",
        });
      });
    },
    [treatmentCases]
  );

  const closeSessionForms = useCallback(() => {
    setShowAddSession(false);
    setContinueCaseId(null);
    setNewCasePrefillName(null);
  }, []);

  const loadOperations = useCallback(async () => {
    const supabase = createClient();
    const clinic = await getActiveClinicId(supabase);
    if (!clinic?.clinicId) return;
    const [data, clinical] = await Promise.all([
      fetchPatientOperationsForProfile(supabase, id, {
        clinicId: clinic.clinicId,
      }),
      fetchPatientClinicalRecords(id),
    ]);
    setOperations(data);
    setClinicalByOp(clinical);
  }, [id]);

  const loadTreatmentCases = useCallback(async () => {
    const supabase = createClient();
    const clinic = await getActiveClinicId(supabase);
    const cases = await fetchPatientTreatmentCases(supabase, id, clinic?.clinicId);
    setTreatmentCases(cases);
  }, [id]);

  const handleSessionSaved = useCallback(
    async (op: PatientOperation, opts?: { wasNewPlan?: boolean }) => {
      await Promise.all([loadOperations(), loadTreatmentCases()]);
      const linkedCaseId = op.treatment_case_id?.trim();
      const isNewPlan =
        opts?.wasNewPlan ||
        op.session_kind === "plan" ||
        Number(op.total_amount) > 0;
      if (
        isNewPlan &&
        linkedCaseId &&
        isPersistedTreatmentCaseId(linkedCaseId)
      ) {
        setShowAddSession(false);
        setNewCasePrefillName(null);
        setContinueCaseId(linkedCaseId);
        requestAnimationFrame(() => {
          continueFormRef.current?.scrollIntoView({
            behavior: "smooth",
            block: "start",
          });
        });
        return;
      }
      closeSessionForms();
    },
    [loadOperations, loadTreatmentCases, closeSessionForms]
  );

  useEffect(() => {
    async function load() {
      setOfflineMiss(false);
      setRefreshing(false);

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
        setMedicalLogs(bundle.medicalLogs);
        setCachedAt(bundle.cachedAt);
        setAccessDenied(false);
      };

      const cached = readPatientProfileCacheForPatient("accountant", id);
      if (cached) {
        await applyBundle(cached);
        if (isBrowserOffline()) {
          setOfflineView(true);
          return;
        }
        setOfflineView(false);
        setRefreshing(true);
      }

      if (isBrowserOffline()) {
        if (!cached) setOfflineMiss(true);
        setRefreshing(false);
        return;
      }

      const supabase = createClient();
      const clinic = await getActiveClinicId(supabase);
      if (!clinic?.clinicId) {
        if (!cached) setAccessDenied(true);
        setRefreshing(false);
        return;
      }

      const [{ data: pRes }, logsRes, ops, clinical, cases] = await Promise.all([
        supabase
          .from("patients")
          .select("*")
          .eq("id", id)
          .eq("clinic_id", clinic.clinicId)
          .maybeSingle(),
        supabase
          .from("medical_logs")
          .select("*, doctor:doctors!doctor_id(full_name_ar)")
          .eq("patient_id", id)
          .order("log_date", { ascending: false }),
        fetchPatientOperationsForProfile(supabase, id, {
          clinicId: clinic.clinicId,
        }),
        fetchPatientClinicalRecords(id, "accountant"),
        fetchPatientTreatmentCases(supabase, id, clinic.clinicId),
      ]);
      if (!pRes) {
        setAccessDenied(true);
        setRefreshing(false);
        return;
      }
      setAccessDenied(false);
      setPatient(pRes as Patient);

      const nextLogs = (logsRes.data as typeof medicalLogs) ?? [];
      setMedicalLogs(nextLogs);
      setOperations(ops);
      setClinicalByOp(clinical);
      setTreatmentCases(cases);

      writePatientProfileCache({
        portal: "accountant",
        clinicId: clinic.clinicId,
        patientId: id,
        patient: pRes as Patient,
        operations: ops,
        treatmentCases: cases,
        clinicalByOp: clinical,
        medicalLogs: nextLogs,
      });
      void cacheXraysForClinicalData(id, clinical);

      setOfflineView(false);
      setCachedAt(Date.now());
      setRefreshing(false);
    }
    if (id) load();
  }, [id]);

  useClinicSync({
    topics: ["sessions", "financial"],
    clinicId: profile?.id,
    patientId: id,
    onRefresh: () => {
      void loadOperations();
      void loadTreatmentCases();
    },
    enabled: !!profile?.id && !!id,
  });

  const handleDoctorTransferred = useCallback(
    async (caseId: string, doc: PatientPrimaryDoctor) => {
      setCaseDoctors((prev) => ({ ...prev, [caseId]: doc }));
      setTreatmentCases((prev) =>
        prev.map((c) =>
          c.id === caseId
            ? {
                ...c,
                primary_doctor_id: doc.id,
                primary_doctor_name: doc.full_name_ar,
              }
            : c
        )
      );
      await loadTreatmentCases();
    },
    [loadTreatmentCases]
  );

  const continueCaseDoctor =
    (continueCaseId && caseDoctors[continueCaseId]) ||
    (continueCase?.primary_doctor_id && continueCase?.primary_doctor_name
      ? {
          id: continueCase.primary_doctor_id,
          full_name_ar: continueCase.primary_doctor_name,
        }
      : null);

  const continueFormKey = continueCaseId
    ? `${id}-continue-${continueCaseDoctor?.id ?? "x"}-${continueCaseId}`
    : "";

  const caseGroups = useMemo(
    () => buildPatientCaseGroups(operations, treatmentCases),
    [operations, treatmentCases]
  );
  const caseTotals = useMemo(
    () => sumCaseGroupsFinancials(caseGroups),
    [caseGroups]
  );
  const totalDebt = caseTotals.totalRemaining;
  const totalPaid = caseTotals.totalPaid;
  const totalBilled = caseGroups.reduce((s, g) => s + g.total, 0);

  if (accessDenied) {
    return (
      <div className="mx-auto max-w-2xl space-y-4 py-8">
        <Link href="/dashboard/patients" className="mc-btn-soft">
          <ArrowRight className="h-4 w-4 ltr:rotate-180" />
          العودة للبحث
        </Link>
        <Alert variant="warning">
          هذا المريض غير تابع لعيادتك أو حسابك غير مربوط بعيادة.
        </Alert>
      </div>
    );
  }

  if (!patient) {
    if (offlineMiss) {
      return (
        <div className="mx-auto max-w-2xl space-y-4 py-8">
          <Link href="/dashboard/patients" className="mc-btn-soft">
            <ArrowRight className="h-4 w-4 ltr:rotate-180" />
            العودة للبحث
          </Link>
          <Alert variant="warning">
            لا يوجد اتصال ولا نسخة محفوظة لهذا المريض — افتح ملفه مرة مع النت أولاً.
          </Alert>
        </div>
      );
    }
    return (
      <div className="space-y-4 py-6" aria-busy>
        <div className="mc-skeleton h-40 rounded-3xl" />
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          <div className="mc-skeleton h-20 rounded-2xl" />
          <div className="mc-skeleton h-20 rounded-2xl" />
          <div className="mc-skeleton h-20 rounded-2xl" />
        </div>
        <p className="text-center text-sm text-slate-muted">
          جاري تحميل ملف المريض...
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <OfflineViewBanner
        refreshing={refreshing}
        offline={offlineView}
        cachedAt={cachedAt}
        refreshingLabel="عرض سريع من الذاكرة — جاري التحديث من السيرفر…"
        offlineLabel="بدون اتصال — آخر تحديث: {time}"
      />

      <div className="flex flex-wrap items-center justify-between gap-3">
        <Link
          href="/dashboard/patients"
          className="inline-flex items-center gap-1.5 text-sm font-semibold text-primary-600 hover:text-primary-800"
        >
          <ArrowRight className="h-4 w-4 ltr:rotate-180" />
          البحث عن مريض
        </Link>

        <div className="mc-tab-group">
          <button
            type="button"
            onClick={() => setActiveTab("file")}
            className={cn("mc-tab", activeTab === "file" && "mc-tab--active")}
          >
            <Wallet className="h-4 w-4" />
            الملف المالي
          </button>
          <button
            type="button"
            onClick={() => setActiveTab("archive")}
            className={cn("mc-tab", activeTab === "archive" && "mc-tab--active")}
          >
            <FolderHeart className="h-4 w-4" />
            الأرشيف الطبي
          </button>
        </div>
      </div>

      {activeTab === "archive" ? (
        <PatientMedicalArchive
          patient={patient}
          operations={operations}
          treatmentCases={treatmentCases}
          clinicalByOp={clinicalByOp}
          medicalLogs={medicalLogs}
          clinic={profile}
          clinicName={displayName}
        />
      ) : (
        <>
      <section className="mc-panel rounded-3xl">
        <div className="border-b border-slate-border bg-surface px-5 py-3">
          <ClinicBrandingHeader profile={profile} size="sm" className="border-0 pb-0" />
        </div>
        <div className="relative p-5 sm:p-6">
          <div
            aria-hidden
            className="pointer-events-none absolute inset-x-0 top-0 h-24 bg-gradient-to-b from-premium-100/40 to-transparent dark:from-premium-500/10"
          />
          <div className="relative flex flex-col gap-5 md:flex-row md:items-start md:justify-between">
            <div className="flex min-w-0 items-start gap-4">
              <div className="flex h-16 w-16 shrink-0 items-center justify-center rounded-3xl bg-mc-pearl text-xl font-bold text-[#0b1f3a] shadow-gold ring-1 ring-inset ring-premium-300/60">
                {patient.full_name_ar.slice(0, 2)}
              </div>
              <div className="min-w-0 flex-1">
                <p className="text-[11px] font-bold uppercase tracking-[0.14em] text-premium-600">
                  {bi("ملفات المرضى", "Patient files")}
                </p>
                <h1 className="mt-0.5 text-2xl font-bold leading-tight text-slate-text">
                  {patient.full_name_ar}
                </h1>
                {getPatientDisplayPhone(patient) && (
                  <p className="mt-1 inline-flex items-center gap-1.5 text-sm text-slate-muted tabular-nums" dir="ltr">
                    <Phone className="h-3.5 w-3.5 text-premium-500" />
                    {getPatientDisplayPhone(patient)}
                  </p>
                )}
                {patient.notes && (
                  <p className="mt-2 rounded-xl border border-slate-border bg-surface px-3 py-2 text-xs leading-relaxed text-slate-muted">
                    {patient.notes}
                  </p>
                )}
                <PatientBasicInfoEditor
                  patient={patient}
                  onSaved={(updates) =>
                    setPatient((prev) => (prev ? { ...prev, ...updates } : prev))
                  }
                />
                <div className="mt-3 max-w-md">
                  <PatientSpeechNameEditor
                    patientId={patient.id}
                    fullNameAr={patient.full_name_ar}
                    initialSpeechName={patient.speech_name_ar}
                  />
                </div>
              </div>
            </div>
            <Button
              size="md"
              className="shrink-0 self-start"
              onClick={() => {
                if (showAddSession || continueCaseId) {
                  closeSessionForms();
                } else {
                  setNewCasePrefillName(null);
                  setShowAddSession(true);
                }
              }}
              variant={showAddSession || continueCaseId ? "outline" : "primary"}
            >
              {showAddSession || continueCaseId ? (
                <>
                  <X className="h-4 w-4" />
                  إغلاق
                </>
              ) : (
                <>
                  <Plus className="h-4 w-4" />
                  إضافة جلسة جديدة
                </>
              )}
            </Button>
          </div>

          <div className="relative mt-6 grid grid-cols-1 gap-3 sm:grid-cols-3">
            <StatTile
              icon={CalendarCheck}
              tone="navy"
              value={<span className="tabular-nums">{operations.length}</span>}
              label="إجمالي الجلسات (كل الحالات)"
            />
            <StatTile
              icon={Wallet}
              tone="gold"
              value={<span className="tabular-nums">{formatCurrency(totalPaid)}</span>}
              label="مدفوع"
            />
            <StatTile
              icon={totalDebt > 0 ? AlertCircle : CheckCircle2}
              tone={totalDebt > 0 ? "danger" : "success"}
              value={<span className="tabular-nums">{formatCurrency(totalDebt)}</span>}
              label={totalDebt > 0 ? "ذمة متبقية" : "لا ذمة"}
            />
          </div>
        </div>

        <div className="space-y-4 border-t border-slate-border bg-surface px-5 py-4">
          <TransferDoctorPanel
            patientId={id}
            clinicId={patient.clinic_id}
            treatmentCases={treatmentCases}
            onTransferred={handleDoctorTransferred}
          />
          <DeletePatientPanel
            patientId={id}
            patientName={patient.full_name_ar}
          />
        </div>

        {treatmentCases.length > 0 && (
          <div className="border-t border-slate-border px-5 pb-5 pt-4">
            <p className="mb-3 flex items-center gap-2 text-xs font-bold text-slate-muted">
              <Layers className="h-4 w-4 text-premium-500" />
              ملخص الحالات
            </p>
            <ul className="flex flex-wrap gap-2">
              {treatmentCases.map((c) => {
                const remaining = computedCaseRemaining(c);
                const hasDebt = remaining > FINANCIAL_EPSILON;
                const settled =
                  !hasDebt && isTreatmentCaseSettledForPicker(c);
                const caseDoctor =
                  caseDoctors[c.id] ??
                  (c.primary_doctor_id && c.primary_doctor_name
                    ? {
                        id: c.primary_doctor_id,
                        full_name_ar: c.primary_doctor_name,
                      }
                    : null);
                return (
                  <li key={c.id}>
                    {hasDebt ? (
                      <button
                        type="button"
                        onClick={() => openContinueCase(c.id)}
                        className="mc-press rounded-full border border-debt-border bg-surface-card px-3.5 py-1.5 text-xs shadow-card transition-all hover:-translate-y-px hover:border-primary-300 hover:shadow-soft"
                      >
                        <span className="font-medium text-slate-text">
                          {treatmentCaseDisplayLabel(c, treatmentCases)}
                        </span>
                        {caseDoctor ? (
                          <span className="text-primary font-medium">
                            {" "}
                            — د.{" "}
                            {formatDoctorDisplayName(caseDoctor.full_name_ar)}
                          </span>
                        ) : null}
                        {" — "}
                        <span className="text-debt-text font-semibold tabular-nums">
                          متبقي {formatCurrency(remaining)}
                        </span>
                        <span className="text-primary font-semibold mr-1">
                          · متابعة
                        </span>
                      </button>
                    ) : (
                      <span className="inline-block rounded-full border border-slate-border bg-surface px-3.5 py-1.5 text-xs">
                        <span className="font-medium text-slate-text">
                          {treatmentCaseDisplayLabel(c, treatmentCases)}
                        </span>
                        {caseDoctor ? (
                          <span className="text-primary font-medium">
                            {" "}
                            — د.{" "}
                            {formatDoctorDisplayName(caseDoctor.full_name_ar)}
                          </span>
                        ) : null}
                        {" — "}
                        {settled ? (
                          <span className="font-semibold text-success-text">مكتمل</span>
                        ) : (
                          <span className="text-slate-muted">—</span>
                        )}
                      </span>
                    )}
                  </li>
                );
              })}
            </ul>
          </div>
        )}
      </section>

      {showAddSession && !continueCaseId && (
        <div
          ref={sessionFormRef}
          id="session-entry-form"
          className="mc-panel scroll-mt-4 animate-fade-in border-primary-200"
        >
          <div className="mc-panel-head">
            <p className="mc-panel-title">
              <Plus />
              إضافة جلسة جديدة للمريض: {patient.full_name_ar}
            </p>
          </div>
          <div className="mc-panel-body">
          <QuickEntryForm
            key={`${id}-new-${newCasePrefillName ?? "generic"}`}
            defaultPatientId={id}
            defaultPatientName={patient.full_name_ar}
            defaultPatientPhone={getPatientDisplayPhone(patient) ?? undefined}
            prefetchedCases={treatmentCases}
            defaultForceNewPlan
            defaultNewCaseTreatmentName={newCasePrefillName ?? undefined}
            onTreatmentCasesChanged={setTreatmentCases}
            onSuccess={(op) => handleSessionSaved(op, { wasNewPlan: true })}
          />
          </div>
        </div>
      )}

      <div className="space-y-4">
        <div className="flex flex-wrap items-end justify-between gap-2 px-1">
          <h3 className="flex items-center gap-3 text-lg font-bold text-slate-text">
            <span className="mc-icon-tile h-9 w-9 rounded-xl">
              <ClipboardList className="h-4 w-4" />
            </span>
            سجل الجلسات حسب الحالة
          </h3>
          {totalBilled > 0 && (
            <span className="rounded-full border border-premium-300/60 bg-premium-50 px-3 py-1 text-xs font-semibold text-premium-800 tabular-nums dark:bg-premium-500/10 dark:text-premium-200">
              — فواتير {formatCurrency(totalBilled)}
            </span>
          )}
        </div>

        {operations.length === 0 ? (
          <EmptyState
            icon={ClipboardList}
            message="لا توجد جلسات مسجّلة لهذا المريض"
            className="rounded-2xl"
          />
        ) : (
          <PatientSessionsByCase
            patientId={id}
            operations={operations}
            treatmentCases={treatmentCases}
            clinicalByOp={clinicalByOp}
            onClinicalSaved={loadOperations}
            onContinueCase={openContinueCase}
            allowEdit
          />
        )}

        {continueCaseId && (
          <div
            ref={continueFormRef}
            id="continue-case-form"
            className="mc-panel mt-4 scroll-mt-4 animate-fade-in border-primary-300 shadow-elevated"
          >
            <div className="mc-panel-head items-start">
              <div className="min-w-0">
                <p className="text-lg font-bold text-primary-800 dark:text-primary-200">
                  متابعة: {continueCase?.treatment_name_ar ?? "حالة العلاج"}
                </p>
                {continueCase ? (
                  <p className="text-sm text-slate-muted mt-1">
                    {continueCaseDoctor ? (
                      <>
                        الطبيب المعالج:{" "}
                        <span className="font-semibold text-primary">
                          {formatDoctorDisplayName(
                            continueCaseDoctor.full_name_ar
                          )}
                        </span>
                        {" — "}
                      </>
                    ) : null}
                    السعر الكلي {formatCurrency(continueCase.case_price)} — مدفوع{" "}
                    {formatCurrency(continueCase.total_paid)} — المتبقي{" "}
                    <span className="font-bold text-debt-text">
                      {formatCurrency(continueCase.remaining_balance)}
                    </span>
                  </p>
                ) : (
                  <p className="text-sm text-slate-muted mt-1 animate-pulse">
                    جاري تحميل بيانات الحالة...
                  </p>
                )}
                <p className="text-xs text-slate-muted mt-1">
                  أدخل المبلغ المدفوع في هذه الجلسة ثم اضغط «تسجيل الدفعة»
                </p>
              </div>
              <Button type="button" variant="outline" size="sm" onClick={closeSessionForms}>
                <X className="h-4 w-4" />
                إلغاء
              </Button>
            </div>
            <div className="mc-panel-body">
            <QuickEntryForm
              key={continueFormKey}
              embedded
              defaultPatientId={id}
              defaultPatientName={patient.full_name_ar}
              defaultPatientPhone={getPatientDisplayPhone(patient) ?? undefined}
              defaultCaseId={continueCaseId}
              prefetchedCases={treatmentCases}
              lockDoctorId={continueCaseDoctor?.id}
              lockDoctorName={continueCaseDoctor?.full_name_ar}
              onTreatmentCasesChanged={setTreatmentCases}
              onSuccess={handleSessionSaved}
            />
            </div>
          </div>
        )}
      </div>
        </>
      )}
    </div>
  );
}
