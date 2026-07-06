"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import { Card, CardHeader, CardTitle } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { Alert } from "@/components/ui/Alert";
import { createClient } from "@/lib/supabase/client";
import { formatCurrency } from "@/lib/utils";
import { useClinicProfile } from "@/contexts/ClinicProfileContext";
import { ClinicBrandingHeader } from "@/components/branding/ClinicBrandingHeader";
import { QuickEntryForm } from "@/components/accountant/QuickEntryForm";
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
import { ArrowRight, Plus, X } from "lucide-react";

export default function PatientProfilePage() {
  const params = useParams();
  const id = params.id as string;
  const { profile, displayName } = useClinicProfile();
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
    const data = await fetchPatientOperationsForProfile(supabase, id, {
      clinicId: clinic.clinicId,
    });
    setOperations(data);
    const clinical = await fetchPatientClinicalRecords(id);
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
      const supabase = createClient();
      const clinic = await getActiveClinicId(supabase);
      if (!clinic?.clinicId) {
        setAccessDenied(true);
        return;
      }
      const { data: pRes } = await supabase
        .from("patients")
        .select("*")
        .eq("id", id)
        .eq("clinic_id", clinic.clinicId)
        .maybeSingle();
      if (!pRes) {
        setAccessDenied(true);
        return;
      }
      setAccessDenied(false);
      setPatient(pRes as Patient);
      const logsRes = await supabase
        .from("medical_logs")
        .select("*, doctor:doctors!doctor_id(full_name_ar)")
        .eq("patient_id", id)
        .order("log_date", { ascending: false });
      setMedicalLogs((logsRes.data as typeof medicalLogs) ?? []);
      await Promise.all([loadOperations(), loadTreatmentCases()]);
    }
    if (id) load();
  }, [id, loadOperations, loadTreatmentCases]);

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
      <div className="space-y-4 py-8">
        <Link href="/dashboard/patients">
          <Button variant="ghost" size="sm">
            <ArrowRight className="h-4 w-4" />
            العودة للبحث
          </Button>
        </Link>
        <Alert variant="warning">
          هذا المريض غير تابع لعيادتك أو حسابك غير مربوط بعيادة.
        </Alert>
      </div>
    );
  }

  if (!patient) {
    return (
      <div className="flex items-center justify-center py-16 text-slate-muted">
        جاري تحميل ملف المريض...
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <Link href="/dashboard/patients">
        <Button variant="ghost" size="sm">
          <ArrowRight className="h-4 w-4" />
          البحث عن مريض
        </Button>
      </Link>

      <div className="mc-tab-group">
        <button
          type="button"
          onClick={() => setActiveTab("file")}
          className={cn("mc-tab", activeTab === "file" && "mc-tab--active")}
        >
          الملف المالي
        </button>
        <button
          type="button"
          onClick={() => setActiveTab("archive")}
          className={cn("mc-tab", activeTab === "archive" && "mc-tab--active")}
        >
          الأرشيف الطبي
        </button>
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
      <Card className="overflow-hidden">
        <div className="border-b border-slate-border bg-surface/50 px-4 py-3">
          <ClinicBrandingHeader profile={profile} size="sm" className="border-0 pb-0" />
        </div>
        <CardHeader>
          <div className="flex items-start justify-between gap-4">
            <div className="flex items-start gap-3">
              <div className="mt-0.5 flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-primary to-primary-700 text-base font-bold text-white shadow-sm">
                {patient.full_name_ar.slice(0, 2)}
              </div>
              <div>
                <CardTitle>{patient.full_name_ar}</CardTitle>
                {getPatientDisplayPhone(patient) && (
                  <p className="text-sm text-slate-muted" dir="ltr">
                    📱 {getPatientDisplayPhone(patient)}
                  </p>
                )}
                {patient.notes && (
                  <p className="mt-1 text-xs text-slate-muted">{patient.notes}</p>
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
              size="sm"
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
        </CardHeader>

        <div className="grid grid-cols-3 gap-3 px-4 pb-4">
          <div className="mc-stat-neutral">
            <p className="mc-stat-value">{operations.length}</p>
            <p className="mc-stat-label">إجمالي الجلسات (كل الحالات)</p>
          </div>
          <div className="mc-stat-primary">
            <p className="mc-stat-value">{formatCurrency(totalPaid)}</p>
            <p className="mc-stat-label">مدفوع</p>
          </div>
          <div className={totalDebt > 0 ? "mc-stat-debt" : "mc-stat-success"}>
            <p className="mc-stat-value">{formatCurrency(totalDebt)}</p>
            <p className="mc-stat-label">
              {totalDebt > 0 ? "ذمة متبقية" : "لا ذمة"}
            </p>
          </div>
        </div>

        <div className="space-y-4 px-4 pb-4">
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
          <div className="border-t border-slate-border px-4 pb-4 pt-3">
            <p className="text-xs font-semibold text-slate-muted mb-2">
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
                        className="rounded-full border border-primary/40 bg-primary/5 px-3 py-1 text-xs hover:bg-primary/10"
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
                      <span className="inline-block rounded-full border border-slate-border bg-surface/80 px-3 py-1 text-xs">
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
                          <span className="text-emerald-700 font-semibold">مكتمل</span>
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
      </Card>

      {showAddSession && !continueCaseId && (
        <div
          ref={sessionFormRef}
          id="session-entry-form"
          className="rounded-xl border-2 border-primary/20 bg-primary/5 p-4 scroll-mt-4"
        >
          <p className="mb-3 text-sm font-semibold text-primary">
            إضافة جلسة جديدة للمريض: {patient.full_name_ar}
          </p>
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
      )}

      <div>
        <h3 className="mb-3 text-lg font-semibold text-slate-text">
          سجل الجلسات حسب الحالة
          {totalBilled > 0 && (
            <span className="text-sm font-normal text-slate-muted mr-2">
              — فواتير {formatCurrency(totalBilled)}
            </span>
          )}
        </h3>

        {operations.length === 0 ? (
          <Alert variant="info">لا توجد جلسات مسجّلة لهذا المريض</Alert>
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
            className="mt-4 rounded-xl border-2 border-primary bg-primary/10 p-4 shadow-sm scroll-mt-4"
          >
            <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
              <div>
                <p className="text-lg font-bold text-primary">
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
        )}
      </div>
        </>
      )}
    </div>
  );
}
