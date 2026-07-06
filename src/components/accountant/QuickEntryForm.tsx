"use client";

import { useState, useEffect, useRef, useCallback, useMemo } from "react";
import { Button } from "@/components/ui/Button";
import { CurrencyInput } from "@/components/ui/CurrencyInput";
import { Select } from "@/components/ui/Select";
import { Card, CardHeader, CardTitle } from "@/components/ui/Card";
import { Alert } from "@/components/ui/Alert";
import { formatCurrency, parseFormattedNumber, todayISO } from "@/lib/utils";
import { createClient } from "@/lib/supabase/client";
import { getActiveClinicId } from "@/lib/clinic-context";
import { FinancialPreview } from "@/components/financial/FinancialPreview";
import { VisualMedicalRecord } from "@/components/clinical/VisualMedicalRecord";
import { VisitSessionClinicalPanel } from "@/components/clinical/VisitSessionClinicalPanel";
import {
  EMPTY_CLINICAL_DRAFT,
  type SessionClinicalDraft,
} from "@/lib/clinical/constants";
import { saveSessionClinicalRecords } from "@/lib/clinical/session-records";
import {
  applyAdditionalDiscountFallback,
  computeFinalPrice,
  computeFinalPriceWithDiscounts,
  computePatientDebtRemaining,
  fetchPatientFinancialPlan,
  hasTreatmentPlan,
  isCaseFullySettled,
  isTreatmentCaseClosed,
  isTreatmentCaseComplete,
  FINANCIAL_EPSILON,
  previewTreatmentSplitWithReview,
  previewPaidSessionSplit,
  resolveCaseFinancialSplit,
  resolveSessionKind,
  saveFirstSessionPlanFallback,
  type PatientFinancialPlan,
} from "@/lib/services/patient-financial-plan";
import {
  buildSessionEntrySchema,
  previewSessionFinancials,
} from "@/lib/services/session-entry-form";
import {
  backfillTreatmentCaseSharesIfMissing,
  caseToFinancialPlan,
  createTreatmentCaseViaApi,
  fetchPatientTreatmentCases,
  isPersistedTreatmentCaseId,
  linkOperationToTreatmentCase,
  linkUnlinkedCaseOperations,
  resolveCaseIdForOp,
  resolvePersistedCaseId,
  syncTreatmentCaseAfterSessionViaApi,
  registerTreatmentCaseDebtViaApi,
  completeTreatmentCaseViaApi,
  type PatientTreatmentCase,
} from "@/lib/services/patient-treatment-cases";
import {
  fetchCasePrimaryDoctor,
  fetchPatientPrimaryDoctor,
  assignPrimaryDoctorForSession,
  type PatientPrimaryDoctor,
} from "@/lib/services/patient-primary-doctor";
import { TreatmentCasePicker } from "@/components/accountant/TreatmentCasePicker";
import { PatientSearchField } from "@/components/patients/PatientSearchField";
import { TransferDoctorPanel } from "@/components/patients/TransferDoctorPanel";
import type { Doctor, Patient, PatientOperation } from "@/types";
import {
  ensurePatientPhoneOnRecord,
  getPatientDisplayPhone,
  patientPhoneColumns,
  validatePatientPhone,
} from "@/lib/phone";
import { notifySessionMutation } from "@/lib/sync/mutation-notify";
import { notifyClinicProfitRefresh } from "@/lib/services/clinic-profit";
import { authPortalHeaders } from "@/lib/auth/api-portal";
import { notifyQueueRefresh } from "@/lib/queue/queue-refresh";
import { useClinicProfile } from "@/contexts/ClinicProfileContext";
import { SessionInvoiceModal } from "@/components/invoices/SessionInvoiceModal";
import { PrescriptionPrintModal } from "@/components/prescriptions/PrescriptionPrintModal";
import { resolvePrescriptionForSession } from "@/lib/prescriptions/client";
import {
  quickEntryDraftKey,
  hasQuickEntryDraftContent,
  type QuickEntryFormDraft,
} from "@/lib/forms/quick-entry-draft";
import { useSessionFormDraft } from "@/hooks/useSessionFormDraft";
import { tryEnqueueQuickEntryOffline } from "@/lib/offline/quick-entry/enqueue";
import type { QuickEntryOfflineInput } from "@/lib/offline/quick-entry/validate";
import { isNetworkFailure } from "@/lib/offline/network";
import { doctorToShareInput } from "@/lib/offline/quick-entry/doctor-share";
import {
  buildSessionInvoiceData,
  type SessionInvoiceData,
} from "@/lib/invoices/session-invoice";
import { computeLabCostSplit } from "@/lib/invoices/lab-session-details";
import { resolveExistingPatientId } from "@/lib/services/resolve-patient-id";
import {
  amountFieldLabel,
  examinationFeeAmount,
  previewSessionBillingTotals,
  resolveSessionPaymentShares,
  SESSION_BILLING_MODE_OPTIONS,
  validateBillingAmount,
  type SessionBillingMode,
} from "@/lib/services/session-billing-mode";
import { Scan, X } from "lucide-react";

/** Common dental procedure suggestions — user can also type freely */
const DENTAL_SUGGESTIONS = [
  "كشفية",
  "حشوة ضوئية",
  "حشوة جذر (علاج عصب)",
  "حشوة أملغم",
  "خلع سن",
  "خلع ضرس عقل",
  "تنظيف جير",
  "تقويم أسنان — جلسة",
  "تاج زيركون",
  "تاج إيماكس (E-max)",
  "فينير",
  "جسر أسنان",
  "طقم أسنان متحرك",
  "غسيل لثة",
  "تبييض أسنان",
  "أشعة بانورامية",
  "زراعة أسنان",
  "تركيب",
];

const EMPTY_FINANCIAL_PLAN: PatientFinancialPlan = {
  case_price: 0,
  discount_total: 0,
  final_price: 0,
  agreed_total: 0,
  original_agreed_total: 0,
  doctor_share_total: 0,
  clinic_share_total: 0,
  total_paid: 0,
  remaining_balance: 0,
  financial_locked: false,
  treatment_status: "active",
};

function buildPostSaveFinancialSnap(
  plan: PatientFinancialPlan,
  opts: {
    billingMode: SessionBillingMode;
    paid: number;
    debtAmount: number;
    additionalDiscount: number;
    completed?: boolean;
  }
): PatientFinancialPlan {
  const paidDelta =
    opts.billingMode === "session" ||
    opts.billingMode === "complete" ||
    opts.billingMode === "examination"
      ? opts.paid
      : 0;
  const totalPaid = plan.total_paid + paidDelta;
  let finalPrice = plan.final_price;

  if (opts.billingMode === "debt" && opts.debtAmount > 0) {
    finalPrice = Math.max(finalPrice, totalPaid + opts.debtAmount);
  }

  const remaining = Math.max(0, finalPrice - totalPaid);

  return {
    ...plan,
    discount_total: plan.discount_total + opts.additionalDiscount,
    final_price: finalPrice,
    agreed_total: finalPrice,
    total_paid: totalPaid,
    remaining_balance:
      opts.billingMode === "complete" ? 0 : remaining,
    treatment_status:
      opts.billingMode === "complete" ||
      (finalPrice > FINANCIAL_EPSILON &&
        totalPaid >= finalPrice - FINANCIAL_EPSILON)
        ? "completed"
        : "active",
  };
}

function applyTreatmentCaseSelection(
  c: PatientTreatmentCase,
  setters: {
    setSelectedCaseId: (id: string) => void;
    setFinancialPlan: (p: PatientFinancialPlan) => void;
    setOperationName: (n: string) => void;
    setForceNewPlan: (v: boolean) => void;
  }
) {
  setters.setSelectedCaseId(c.id);
  setters.setFinancialPlan(caseToFinancialPlan(c));
  setters.setOperationName(c.treatment_name_ar);
  setters.setForceNewPlan(false);
}

interface QuickEntryFormProps {
  /** Pre-selected patient (used from patient file page) */
  defaultPatientId?: string;
  defaultPatientName?: string;
  /** فتح متابعة حالة محددة (UUID من patient_treatment_cases) */
  defaultCaseId?: string;
  /** رقم المراجع — يُحمّل فوراً لإرسال الواتساب */
  defaultPatientPhone?: string;
  /** حالات محمّلة مسبقاً — تُفعّل المتابعة فوراً بدون انتظار */
  prefetchedCases?: PatientTreatmentCase[];
  /** يبدأ مباشرة بوضع «حالة علاج جديدة» (إجمالي كلي جديد) */
  defaultForceNewPlan?: boolean;
  /** اسم العلاج المقترح عند تكرار حالة مكتملة */
  defaultNewCaseTreatmentName?: string;
  /** Lock doctor (doctor portal session entry) */
  lockDoctorId?: string;
  /** اسم الطبيب عند القفل — للعرض الفوري قبل تحميل قائمة الأطباء */
  lockDoctorName?: string;
  /** بدون إطار Card — للتضمين داخل لوحة المتابعة */
  embedded?: boolean;
  /** زيارة من الطابور — السجل البصري يُعرض في اللوحة أعلاه */
  visitQueueEntryId?: string;
  onSuccess?: (operation: PatientOperation) => void;
  /** تحديث ملخص الحالات في الصفحة الأم فور جلب الحالات */
  onTreatmentCasesChanged?: (cases: PatientTreatmentCase[]) => void;
}

export function QuickEntryForm({
  defaultPatientId,
  defaultPatientName,
  defaultCaseId,
  defaultPatientPhone,
  prefetchedCases,
  defaultForceNewPlan = false,
  defaultNewCaseTreatmentName,
  lockDoctorId,
  lockDoctorName,
  embedded = false,
  visitQueueEntryId,
  onSuccess,
  onTreatmentCasesChanged,
}: QuickEntryFormProps) {
  const { profile: clinicProfile } = useClinicProfile();
  const [invoiceData, setInvoiceData] = useState<SessionInvoiceData | null>(null);
  const [prescriptionModalId, setPrescriptionModalId] = useState<string | null>(
    null
  );
  const [pendingPrescriptionId, setPendingPrescriptionId] = useState<
    string | null
  >(null);
  const [pendingSuccessOp, setPendingSuccessOp] = useState<PatientOperation | null>(
    null
  );
  const listId = "dental-suggestions";

  // Patient search state
  const [patientQuery, setPatientQuery] = useState(defaultPatientName ?? "");
  const [patientPhone, setPatientPhone] = useState(defaultPatientPhone ?? "");
  const [selectedPatientId, setSelectedPatientId] = useState<string | null>(
    defaultPatientId ?? null
  );

  const initialCase = defaultCaseId
    ? prefetchedCases?.find((c) => c.id === defaultCaseId)
    : undefined;
  const initialCaseIsComplete =
    !defaultForceNewPlan &&
    !!initialCase &&
    isTreatmentCaseComplete(caseToFinancialPlan(initialCase));

  // Form fields
  const [doctorId, setDoctorId] = useState(lockDoctorId ?? "");
  const [clinical, setClinical] = useState<SessionClinicalDraft>(EMPTY_CLINICAL_DRAFT);
  const [clinicalResetKey, setClinicalResetKey] = useState(0);
  const resetClinical = useCallback(() => {
    setClinical(EMPTY_CLINICAL_DRAFT);
    setClinicalResetKey((k) => k + 1);
  }, []);

  const openPrescriptionModalIfAny = useCallback(
    async (
      queueEntryId: string | null | undefined,
      openImmediately = true
    ) => {
      if (!queueEntryId) return;

      try {
        const rx = await resolvePrescriptionForSession(
          { queueEntryId },
          "accountant",
          { retries: 3, retryDelayMs: 2000 }
        );
        if (rx) {
          setPendingPrescriptionId(rx.id);
          if (openImmediately) {
            setPrescriptionModalId(rx.id);
          }
        }
      } catch {
        /* لا وصفة — طبيعي */
      }
    },
    []
  );
  const [operationName, setOperationName] = useState(() => {
    if (defaultForceNewPlan && defaultNewCaseTreatmentName?.trim()) {
      return defaultNewCaseTreatmentName.trim();
    }
    return initialCase ? initialCase.treatment_name_ar : "";
  });
  const [totalAmount, setTotalAmount] = useState("");
  const [billingMode, setBillingMode] = useState<SessionBillingMode>("session");
  const [paidAmount, setPaidAmount] = useState("");
  const [discountAmount, setDiscountAmount] = useState("");
  const [additionalDiscountAmount, setAdditionalDiscountAmount] = useState("");
  const [materialsCost, setMaterialsCost] = useState("");
  const [labNotes, setLabNotes] = useState("");
  const [notes, setNotes] = useState("");
  const [isReviewStatement, setIsReviewStatement] = useState(false);
  const [reviewFeeEnabled, setReviewFeeEnabled] = useState(false);
  const [applyExaminationFee, setApplyExaminationFee] = useState(false);
  const [clinicReviewFeeAmount, setClinicReviewFeeAmount] = useState(0);
  const [doctors, setDoctors] = useState<Doctor[]>([]);
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState<{
    type: "success" | "error";
    text: string;
  } | null>(null);
  const [financialPlan, setFinancialPlan] =
    useState<PatientFinancialPlan | null>(() =>
      defaultForceNewPlan || initialCaseIsComplete
        ? EMPTY_FINANCIAL_PLAN
        : initialCase
          ? caseToFinancialPlan(initialCase)
          : null
    );
  const [loadingPlan, setLoadingPlan] = useState(
    () => !!defaultPatientId && !initialCase
  );
  const [forceNewPlan, setForceNewPlan] = useState(
    () => defaultForceNewPlan || initialCaseIsComplete
  );
  const [treatmentCases, setTreatmentCases] = useState<PatientTreatmentCase[]>(
    () => prefetchedCases ?? []
  );
  const [activeClinicId, setActiveClinicId] = useState<string | null>(null);
  const [selectedCaseId, setSelectedCaseId] = useState<string | null>(() =>
    defaultForceNewPlan || initialCaseIsComplete
      ? null
      : initialCase?.id ??
          (defaultCaseId && isPersistedTreatmentCaseId(defaultCaseId)
            ? defaultCaseId
            : null)
  );
  const [assignedDoctor, setAssignedDoctor] = useState<{
    id: string;
    full_name_ar: string;
  } | null>(null);
  const [showVisualRecordReview, setShowVisualRecordReview] = useState(
    () => Boolean(visitQueueEntryId)
  );

  useEffect(() => {
    setShowVisualRecordReview(Boolean(visitQueueEntryId));
  }, [visitQueueEntryId]);

  const draftStorageKey = useMemo(
    () =>
      quickEntryDraftKey({
        visitQueueEntryId,
        defaultPatientId: defaultPatientId ?? selectedPatientId,
      }),
    [visitQueueEntryId, defaultPatientId, selectedPatientId]
  );

  const applyQuickEntryDraft = useCallback((draft: QuickEntryFormDraft) => {
    setPatientQuery(draft.patientQuery);
    setPatientPhone(draft.patientPhone);
    setSelectedPatientId(draft.selectedPatientId);
    if (!lockDoctorId && draft.doctorId) setDoctorId(draft.doctorId);
    setOperationName(draft.operationName);
    setTotalAmount(draft.totalAmount);
    setBillingMode(draft.billingMode ?? "session");
    setPaidAmount(draft.paidAmount);
    setDiscountAmount(draft.discountAmount);
    setAdditionalDiscountAmount(draft.additionalDiscountAmount);
    setMaterialsCost(draft.materialsCost);
    setLabNotes(draft.labNotes);
    setNotes(draft.notes);
    setIsReviewStatement(draft.isReviewStatement);
    setReviewFeeEnabled(draft.reviewFeeEnabled);
    setApplyExaminationFee(draft.applyExaminationFee ?? false);
    setSelectedCaseId(draft.selectedCaseId);
    setForceNewPlan(draft.forceNewPlan);
    setClinical({ xrayFiles: [], teeth: draft.clinicalTeeth ?? {} });
    setClinicalResetKey((k) => k + 1);
    setShowVisualRecordReview(draft.showVisualRecordReview);
  }, [lockDoctorId]);

  const draftSnapshot = useMemo(
    () => ({
      patientQuery,
      patientPhone,
      selectedPatientId,
      doctorId,
      operationName,
      totalAmount,
      billingMode,
      paidAmount,
      discountAmount,
      additionalDiscountAmount,
      materialsCost,
      labNotes,
      notes,
      isReviewStatement,
      reviewFeeEnabled,
      applyExaminationFee,
      selectedCaseId,
      forceNewPlan,
      clinicalTeeth: clinical.teeth,
      showVisualRecordReview,
    }),
    [
      patientQuery,
      patientPhone,
      selectedPatientId,
      doctorId,
      operationName,
      totalAmount,
      billingMode,
      paidAmount,
      discountAmount,
      additionalDiscountAmount,
      materialsCost,
      labNotes,
      notes,
      isReviewStatement,
      reviewFeeEnabled,
      applyExaminationFee,
      selectedCaseId,
      forceNewPlan,
      clinical.teeth,
      showVisualRecordReview,
    ]
  );

  const { draftRestored, dismissDraftNotice, clearDraft } = useSessionFormDraft(
    draftStorageKey,
    draftSnapshot,
    applyQuickEntryDraft,
    { hasContent: hasQuickEntryDraftContent }
  );

  const handleCaseDoctorTransferred = useCallback(
    async (caseId: string, doc: PatientPrimaryDoctor) => {
      const activeCase =
        resolvePersistedCaseId(treatmentCases, selectedCaseId) ?? selectedCaseId;
      if (activeCase === caseId || selectedCaseId === caseId) {
        setAssignedDoctor(doc);
        if (!lockDoctorId) setDoctorId(doc.id);
      }
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
      if (!selectedPatientId) return;
      const supabase = createClient();
      const clinic = await getActiveClinicId(supabase);
      if (!clinic?.clinicId) return;
      setActiveClinicId(clinic.clinicId);
      const cases = await fetchPatientTreatmentCases(
        supabase,
        selectedPatientId,
        clinic.clinicId
      );
      setTreatmentCases(cases);
      onTreatmentCasesChanged?.(cases);
    },
    [
      selectedPatientId,
      selectedCaseId,
      treatmentCases,
      lockDoctorId,
      onTreatmentCasesChanged,
    ]
  );

  const plan = financialPlan ?? EMPTY_FINANCIAL_PLAN;
  const showCasePicker =
    !!selectedPatientId &&
    !loadingPlan &&
    treatmentCases.length > 0 &&
    !selectedCaseId &&
    !forceNewPlan;
  const planUiReady = !selectedPatientId || !loadingPlan;
  const formSchema = buildSessionEntrySchema({
    plan,
    forceNewPlan,
    defaultPatientId,
    lockDoctorId,
    showCasePicker,
    hasSelectedCase: !!selectedCaseId,
    hasAssignedDoctor: !!assignedDoctor && !lockDoctorId,
  });
  const isFirstSession = planUiReady && formSchema.mode === "first";
  const isFollowUpSession = planUiReady && formSchema.mode === "follow_up";
  const selectedCase =
    treatmentCases.find((c) => c.id === selectedCaseId) ?? null;
  const isCaseClosed =
    !defaultForceNewPlan &&
    !forceNewPlan &&
    !loadingPlan &&
    isFollowUpSession &&
    !!selectedCaseId &&
    (selectedCase
      ? isTreatmentCaseComplete(caseToFinancialPlan(selectedCase))
      : false);

  const beginNewTreatmentCase = useCallback(
    (prefillTreatmentName?: string) => {
      setForceNewPlan(true);
      setSelectedCaseId(null);
      setFinancialPlan(EMPTY_FINANCIAL_PLAN);
      setOperationName(prefillTreatmentName?.trim() ?? "");
      setTotalAmount("");
      setBillingMode("session");
      setApplyExaminationFee(false);
      setPaidAmount("");
      setDiscountAmount("");
      setAdditionalDiscountAmount("");
      setMaterialsCost("");
      setLabNotes("");
      resetClinical();
      setMessage(null);
    },
    [resetClinical]
  );

  const parseAmount = (raw: string) =>
    Number(parseFormattedNumber(raw)) || 0;

  const casePriceNum = parseAmount(totalAmount);
  const discountNum = parseAmount(discountAmount);
  const additionalDiscountNum = parseAmount(additionalDiscountAmount);
  const paid = parseAmount(paidAmount);
  const materials = parseAmount(materialsCost);
  const phoneInputRequired =
    !defaultPatientPhone?.trim() && !patientPhone.trim();

  const reviewFeeLive =
    billingMode !== "examination" &&
    isReviewStatement &&
    reviewFeeEnabled &&
    clinicReviewFeeAmount > 0
      ? clinicReviewFeeAmount
      : 0;

  const examinationFeeLive = examinationFeeAmount({
    applyExaminationFee:
      billingMode === "examination" ? applyExaminationFee : false,
    reviewFeeEnabled,
    clinicReviewFeeAmount,
  });

  const entryAmountLive =
    billingMode === "examination" ? examinationFeeLive : paid;

  const financialPreview = previewSessionFinancials(plan, {
    isFirstSession,
    casePrice: casePriceNum,
    initialDiscount: discountNum,
    additionalDiscount: additionalDiscountNum,
    newPayment: paid,
    reviewFee: reviewFeeLive,
  });
  const finalPriceLive = financialPreview.finalPrice;
  const selectedDoctor = doctors.find((d) => d.id === doctorId) ?? null;
  const billingPreview = previewSessionBillingTotals(plan, {
    mode: billingMode,
    amount: entryAmountLive,
    additionalDiscount: additionalDiscountNum,
  });
  const remaining = billingPreview.registeredDebt;
  const sessionPaymentShares =
    billingMode === "examination" && examinationFeeLive > 0
      ? { doctorShare: 0, clinicShare: examinationFeeLive }
      : resolveSessionPaymentShares({
          paidAmount: entryAmountLive,
          reviewFee:
            isReviewStatement && billingMode !== "examination"
              ? reviewFeeLive
              : 0,
          isReviewStatement:
            isReviewStatement && billingMode !== "examination",
          materialsCost: materials,
          doctor: selectedDoctor,
          plan,
        });

  const paymentPreviewSplit = useMemo(() => {
    if (!selectedDoctor) return null;
    if (billingMode === "debt") return null;
    if (billingMode === "examination") {
      if (examinationFeeLive <= 0) return null;
      return {
        paidAmount: examinationFeeLive,
        doctorShare: 0,
        clinicShare: examinationFeeLive,
      };
    }
    if (entryAmountLive <= 0 && materials <= 0) return null;
    return previewPaidSessionSplit({
      paidAmount: entryAmountLive,
      reviewFee: isReviewStatement ? reviewFeeLive : 0,
      isReviewStatement,
      caseFinalPrice: plan.final_price,
      caseDoctorShare: plan.doctor_share_total,
      caseClinicShare: plan.clinic_share_total,
      doctor: selectedDoctor,
      materialsCost: materials,
    });
  }, [
    selectedDoctor,
    billingMode,
    examinationFeeLive,
    entryAmountLive,
    materials,
    plan.final_price,
    plan.doctor_share_total,
    plan.clinic_share_total,
    isReviewStatement,
    reviewFeeLive,
  ]);

  const treatmentOnly = Math.max(0, finalPriceLive - reviewFeeLive);

  const liveSplit = isFirstSession
    ? previewTreatmentSplitWithReview(
        treatmentOnly,
        reviewFeeLive,
        materials,
        selectedDoctor
      )
    : null;

  const lockedSplit =
    isFollowUpSession && plan.final_price > 0
      ? resolveCaseFinancialSplit(plan, selectedDoctor, {
          materialsCost: materials,
        }) ?? undefined
      : liveSplit
        ? {
            agreedTotal: liveSplit.agreedTotal,
            doctorShare: liveSplit.doctorShare,
            clinicShare: liveSplit.clinicShare,
          }
        : undefined;

  useEffect(() => {
    async function load() {
      const supabase = createClient();
      const clinic = await getActiveClinicId(supabase);
      const doctorsQuery = clinic?.clinicId
        ? supabase
            .from("doctors")
            .select("*")
            .eq("clinic_id", clinic.clinicId)
            .eq("is_active", true)
            .order("full_name_ar")
        : Promise.resolve({ data: [], error: null });

      const [docRes, clinicRes] = await Promise.all([
        doctorsQuery,
        clinic
          ? supabase
              .from("clinics")
              .select("review_fee_enabled, review_fee_amount")
              .eq("id", clinic.clinicId)
              .maybeSingle()
          : Promise.resolve({ data: null, error: null }),
      ]);
      if (docRes.data) setDoctors(docRes.data as Doctor[]);
      if (clinicRes.data) {
        const c = clinicRes.data as {
          review_fee_enabled?: boolean;
          review_fee_amount?: number;
        };
        setReviewFeeEnabled(!!c.review_fee_enabled);
        setClinicReviewFeeAmount(Number(c.review_fee_amount ?? 0));
      }
      if (lockDoctorId) {
        setDoctorId(lockDoctorId);
        if (lockDoctorName) {
          setAssignedDoctor({ id: lockDoctorId, full_name_ar: lockDoctorName });
        }
      }
    }
    load();
  }, [lockDoctorId, lockDoctorName]);

  useEffect(() => {
    if (!lockDoctorId || lockDoctorName) return;
    let cancelled = false;
    async function loadLockedDoctorName() {
      const supabase = createClient();
      const { data } = await supabase
        .from("doctors")
        .select("id, full_name_ar")
        .eq("id", lockDoctorId!)
        .maybeSingle();
      if (!cancelled && data?.full_name_ar) {
        setAssignedDoctor({
          id: data.id as string,
          full_name_ar: data.full_name_ar as string,
        });
      }
    }
    void loadLockedDoctorName();
    return () => {
      cancelled = true;
    };
  }, [lockDoctorId, lockDoctorName]);

  useEffect(() => {
    if (defaultPatientPhone?.trim()) {
      setPatientPhone(defaultPatientPhone);
    }
  }, [defaultPatientPhone]);

  useEffect(() => {
    if (defaultPatientName?.trim()) {
      setPatientQuery(defaultPatientName.trim());
    }
  }, [defaultPatientName]);

  useEffect(() => {
    if (defaultPatientId) {
      setSelectedPatientId(defaultPatientId);
    }
  }, [defaultPatientId]);

  useEffect(() => {
    let cancelled = false;
    async function loadCases() {
      if (!selectedPatientId) {
        setTreatmentCases([]);
        setSelectedCaseId(null);
        setFinancialPlan(null);
        setForceNewPlan(false);
        setAssignedDoctor(null);
        if (!lockDoctorId) setDoctorId("");
        setLoadingPlan(false);
        return;
      }

      const hadInstantCase =
        !!defaultCaseId &&
        !!treatmentCases.find((c) => c.id === defaultCaseId) &&
        !!selectedCaseId;

      if (!hadInstantCase) {
        setLoadingPlan(true);
      }

      try {
        const supabase = createClient();
        if (!lockDoctorId) {
          const persistedCaseId =
            defaultCaseId && isPersistedTreatmentCaseId(defaultCaseId)
              ? defaultCaseId
              : null;
          const primaryDoc = persistedCaseId
            ? await fetchCasePrimaryDoctor(supabase, persistedCaseId)
            : await fetchPatientPrimaryDoctor(supabase, selectedPatientId);
          if (cancelled) return;
          setAssignedDoctor(primaryDoc);
          if (primaryDoc) setDoctorId(primaryDoc.id);
        }
        const clinic = await getActiveClinicId(supabase);
        if (clinic?.clinicId) setActiveClinicId(clinic.clinicId);
        const cases = await fetchPatientTreatmentCases(
          supabase,
          selectedPatientId,
          clinic?.clinicId
        );
        if (cancelled) return;

        setTreatmentCases(cases);
        onTreatmentCasesChanged?.(cases);

        if (forceNewPlan || defaultForceNewPlan) {
          setForceNewPlan(true);
          setFinancialPlan(EMPTY_FINANCIAL_PLAN);
          setSelectedCaseId(null);
          if (!lockDoctorId) {
            setAssignedDoctor(null);
            setDoctorId("");
          }
          if (defaultNewCaseTreatmentName?.trim()) {
            setOperationName(defaultNewCaseTreatmentName.trim());
          }
          return;
        }

        const pickCase = (caseId: string): boolean => {
          const resolveRow = (): PatientTreatmentCase | undefined => {
            if (isPersistedTreatmentCaseId(caseId)) {
              return cases.find((x) => x.id === caseId);
            }
            const persisted = resolvePersistedCaseId(cases, caseId);
            return persisted
              ? cases.find((x) => x.id === persisted)
              : undefined;
          };
          const c = resolveRow();
          if (!c) return false;
          if (isTreatmentCaseComplete(caseToFinancialPlan(c))) {
            setForceNewPlan(true);
            setSelectedCaseId(null);
            setFinancialPlan(EMPTY_FINANCIAL_PLAN);
            setOperationName(c.treatment_name_ar);
            return true;
          }
          applyTreatmentCaseSelection(c, {
            setSelectedCaseId,
            setFinancialPlan,
            setOperationName,
            setForceNewPlan,
          });
          return true;
        };

        if (defaultCaseId && pickCase(defaultCaseId)) {
          return;
        }

        if (cases.length > 0 && !selectedCaseId) {
          setFinancialPlan(EMPTY_FINANCIAL_PLAN);
        } else if (cases.length === 0) {
          setSelectedCaseId(null);
          const legacy = await fetchPatientFinancialPlan(
            supabase,
            selectedPatientId
          );
          if (!cancelled) setFinancialPlan(legacy);
        }
      } finally {
        if (!cancelled) {
          setLoadingPlan(false);
        }
      }
    }
    void loadCases();
    return () => {
      cancelled = true;
    };
  }, [
    selectedPatientId,
    forceNewPlan,
    defaultForceNewPlan,
    defaultCaseId,
    defaultNewCaseTreatmentName,
  ]);

  useEffect(() => {
    if (
      !defaultCaseId ||
      !selectedPatientId ||
      treatmentCases.length === 0 ||
      forceNewPlan ||
      defaultForceNewPlan
    ) {
      return;
    }
    if (!isPersistedTreatmentCaseId(defaultCaseId)) return;
    const c = treatmentCases.find((x) => x.id === defaultCaseId);
    if (!c) return;
    if (selectedCaseId !== defaultCaseId) {
      setSelectedCaseId(defaultCaseId);
      setFinancialPlan(caseToFinancialPlan(c));
      setOperationName(c.treatment_name_ar);
    }
  }, [
    defaultCaseId,
    selectedPatientId,
    treatmentCases,
    forceNewPlan,
    defaultForceNewPlan,
    selectedCaseId,
  ]);

  useEffect(() => {
    if (!selectedPatientId) {
      setPatientPhone("");
      return;
    }
    let cancelled = false;
    async function loadPatientPhone() {
      const supabase = createClient();
      const { data } = await supabase
        .from("patients")
        .select("phone, phone_number")
        .eq("id", selectedPatientId)
        .maybeSingle();
      if (cancelled) return;
      setPatientPhone(getPatientDisplayPhone(data ?? {}) ?? "");
    }
    void loadPatientPhone();
    return () => {
      cancelled = true;
    };
  }, [selectedPatientId]);

  useEffect(() => {
    if (isFollowUpSession) {
      setTotalAmount("");
      setDiscountAmount("");
      setAdditionalDiscountAmount("");
      setMaterialsCost("");
      setLabNotes("");
    }
  }, [isFollowUpSession, selectedCaseId]);

  useEffect(() => {
    resetClinical();
  }, [selectedPatientId, selectedCaseId, forceNewPlan, resetClinical]);

  useEffect(() => {
    if (lockDoctorId || !selectedPatientId) return;
    const caseRow = selectedCaseId
      ? treatmentCases.find((c) => c.id === selectedCaseId)
      : undefined;
    if (caseRow?.primary_doctor_id && caseRow.primary_doctor_name) {
      setAssignedDoctor({
        id: caseRow.primary_doctor_id,
        full_name_ar: caseRow.primary_doctor_name,
      });
      setDoctorId(caseRow.primary_doctor_id);
      return;
    }
    let cancelled = false;
    (async () => {
      const supabase = createClient();
      const persisted =
        selectedCaseId && isPersistedTreatmentCaseId(selectedCaseId)
          ? selectedCaseId
          : null;
      const primaryDoc = persisted
        ? await fetchCasePrimaryDoctor(supabase, persisted)
        : await fetchPatientPrimaryDoctor(supabase, selectedPatientId);
      if (cancelled) return;
      setAssignedDoctor(primaryDoc);
      if (primaryDoc) setDoctorId(primaryDoc.id);
    })();
    return () => {
      cancelled = true;
    };
  }, [selectedPatientId, selectedCaseId, lockDoctorId, treatmentCases]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setMessage(null);

    if (showCasePicker) {
      setMessage({ type: "error", text: "اختر الحالة من القائمة أولاً" });
      return;
    }

    if (formSchema.showOperation && !operationName.trim() && billingMode !== "examination") {
      setMessage({
        type: "error",
        text: "أدخل نوع العلاج للحالة الجديدة (مثلاً حشوة ضوئية أو تقويم)",
      });
      return;
    }

    if (!doctorId) {
      setMessage({
        type: "error",
        text: assignedDoctor
          ? "تعذر تحميل الطبيب — أعد اختيار المريض"
          : "اختر الطبيب",
      });
      return;
    }

    setLoading(true);

    const offlineCaseRow =
      selectedCaseId != null
        ? treatmentCases.find((c) => c.id === selectedCaseId)
        : undefined;
    const offlineInput: QuickEntryOfflineInput = {
      clinicId: activeClinicId,
      showCasePicker,
      selectedPatientId,
      patientQuery,
      patientPhone,
      doctorId,
      sessionDoctorId: assignedDoctor?.id ?? doctorId,
      doctorShareInput: doctorToShareInput(selectedDoctor),
      forceNewPlan,
      selectedCaseId,
      operationName,
      operationLabel:
        offlineCaseRow?.treatment_name_ar?.trim() || operationName.trim(),
      billingMode,
      totalAmount,
      paidAmount,
      discountAmount,
      additionalDiscountAmount,
      materialsCost,
      notes,
      labNotes,
      isReviewStatement,
      reviewFeeEnabled,
      applyExaminationFee,
      reviewFeeLive:
        billingMode === "examination" ? examinationFeeLive : reviewFeeLive,
      financialPlan: financialPlan,
      visitQueueEntryId: visitQueueEntryId ?? null,
      clinicalTeeth: clinical.teeth,
      treatmentCaseId:
        resolvePersistedCaseId(treatmentCases, selectedCaseId) ?? null,
    };

    try {
    const offlineAttempt = await tryEnqueueQuickEntryOffline(offlineInput);
    if (offlineAttempt.handled) {
      if (offlineAttempt.ok) {
        setMessage({ type: "success", text: offlineAttempt.message });
        clearDraft();
        resetClinical();
        setPaidAmount("");
        setTotalAmount("");
        setDiscountAmount("");
        setAdditionalDiscountAmount("");
        setMaterialsCost("");
        setLabNotes("");
        setNotes("");
      } else {
        setMessage({ type: "error", text: offlineAttempt.message });
      }
      return;
    }

    const supabase = createClient();
    const activeClinic = await getActiveClinicId(supabase);
    if (!activeClinic) {
      setMessage({ type: "error", text: "لا توجد عيادة في قاعدة البيانات." });
      return;
    }

    // Resolve or create patient
    let patientId = selectedPatientId;
    if (!patientId) {
      const name = patientQuery.trim();
      if (!name) {
        setMessage({ type: "error", text: "أدخل اسم المريض" });
        setLoading(false);
        return;
      }
      const { data: existing } = await supabase
        .from("patients")
        .select("id")
        .eq("full_name_ar", name)
        .eq("clinic_id", activeClinic.clinicId)
        .maybeSingle();

      if (existing?.id) {
        patientId = existing.id;
      } else {
        const byPhoneOrName = await resolveExistingPatientId(
          supabase,
          activeClinic.clinicId,
          { name, phone: patientPhone }
        );
        if (byPhoneOrName) {
          patientId = byPhoneOrName;
        } else {
        const phoneCheck = validatePatientPhone(patientPhone);
        if (!phoneCheck.ok) {
          setMessage({ type: "error", text: phoneCheck.message });
          setLoading(false);
          return;
        }
        const { data: newP, error: pErr } = await supabase
          .from("patients")
          .insert({
            full_name_ar: name,
            clinic_id: activeClinic.clinicId,
            primary_doctor_id: doctorId,
            ...patientPhoneColumns(phoneCheck.normalized),
          })
          .select("id")
          .single();
        if (pErr || !newP) {
          setMessage({ type: "error", text: "تعذر إنشاء سجل المريض" });
          setLoading(false);
          return;
        }
        patientId = newP.id;
        }
      }
    }

    if (!patientId) {
      setMessage({ type: "error", text: "اختر المريض أو أدخل اسمه" });
      setLoading(false);
      return;
    }

    const activeCaseId =
      resolvePersistedCaseId(treatmentCases, selectedCaseId) ?? selectedCaseId;
    const pickedCase =
      treatmentCases.find((c) => c.id === activeCaseId) ??
      treatmentCases.find((c) => c.id === selectedCaseId);
    let activePlan = pickedCase
      ? caseToFinancialPlan(pickedCase)
      : await fetchPatientFinancialPlan(supabase, patientId);
    const discount = parseAmount(discountAmount);
    const additionalDiscount = parseAmount(additionalDiscountAmount);
    const isNewCase = forceNewPlan || !selectedCaseId;
    const entryAmount =
      billingMode === "examination" ? examinationFeeLive : paid;

    const phoneReady = await ensurePatientPhoneOnRecord(
      supabase,
      patientId,
      patientPhone
    );
    if (!phoneReady.ok) {
      setMessage({ type: "error", text: phoneReady.message });
      setLoading(false);
      return;
    }

    if (
      billingMode !== "complete" &&
      (pickedCase
        ? isTreatmentCaseComplete(caseToFinancialPlan(pickedCase))
        : isTreatmentCaseClosed(activePlan)) &&
      !forceNewPlan
    ) {
      setMessage({
        type: "error",
        text: "تم إكمال العلاج — الحالة مغلقة. ابدأ «حالة علاج جديدة» للمتابعة.",
      });
      setLoading(false);
      return;
    }

    if (isNewCase && !operationName.trim() && billingMode !== "complete" && billingMode !== "examination") {
      setMessage({
        type: "error",
        text: "أدخل نوع العلاج للحالة الجديدة",
      });
      setLoading(false);
      return;
    }

    const amountError = validateBillingAmount(billingMode, entryAmount);
    if (amountError && !(billingMode === "complete" && entryAmount <= 0)) {
      setMessage({ type: "error", text: amountError });
      setLoading(false);
      return;
    }

    if (
      !isNewCase &&
      billingMode === "session" &&
      !hasTreatmentPlan(activePlan) &&
      entryAmount <= 0 &&
      additionalDiscount <= 0
    ) {
      setMessage({
        type: "error",
        text: "لا توجد حالة — ابدأ بجلسة جديدة أو اختر حالة من القائمة",
      });
      setLoading(false);
      return;
    }

    if (additionalDiscount > 0 && activePlan.final_price > FINANCIAL_EPSILON) {
      const maxDisc = Math.max(
        activePlan.remaining_balance,
        activePlan.final_price - activePlan.total_paid
      );
      if (additionalDiscount > maxDisc) {
        setMessage({
          type: "error",
          text: `الخصم الإضافي أكبر من الذمة (${formatCurrency(maxDisc)})`,
        });
        setLoading(false);
        return;
      }
    }

    const operationLabel =
      billingMode === "examination"
        ? operationName.trim() || "كشف"
        : pickedCase?.treatment_name_ar?.trim() || operationName.trim();

    if (billingMode === "examination" && applyExaminationFee) {
      if (!reviewFeeEnabled) {
        setMessage({
          type: "error",
          text: "فعّل كشفية المراجع من إعدادات العيادة أولاً",
        });
        setLoading(false);
        return;
      }
      if (clinicReviewFeeAmount <= 0) {
        setMessage({
          type: "error",
          text: "حدد مبلغ الكشفية في إعدادات العيادة",
        });
        setLoading(false);
        return;
      }
    }

    if (isReviewStatement && billingMode !== "examination" && !reviewFeeEnabled) {
      setMessage({
        type: "error",
        text: "فعّل كشفية المراجع من الإعدادات وحدد المبلغ أولاً",
      });
      setLoading(false);
      return;
    }
    if (isReviewStatement && billingMode !== "examination" && reviewFeeEnabled && clinicReviewFeeAmount <= 0) {
      setMessage({
        type: "error",
        text: "حدد مبلغ الكشفية في إعدادات العيادة",
      });
      setLoading(false);
      return;
    }

    const optionalCols: Record<string, unknown> = {};
    if (notes.trim()) optionalCols.notes = notes.trim();
    if (labNotes.trim()) optionalCols.lab_notes = labNotes.trim();
    if (isReviewStatement && billingMode !== "examination") {
      optionalCols.is_review_statement = true;
      if (reviewFeeLive > 0) optionalCols.review_fee_amount = reviewFeeLive;
    }
    if (!isNewCase) {
      const persistedCaseId = resolvePersistedCaseId(
        treatmentCases,
        selectedCaseId
      );
      if (persistedCaseId && isPersistedTreatmentCaseId(persistedCaseId)) {
        optionalCols.treatment_case_id = persistedCaseId;
      }
    }

    let sessionDoctorId = assignedDoctor?.id ?? doctorId;
    const caseIdForDoctor =
      resolvePersistedCaseId(treatmentCases, selectedCaseId) ??
      (defaultCaseId && isPersistedTreatmentCaseId(defaultCaseId)
        ? defaultCaseId
        : null);
    if (caseIdForDoctor && !assignedDoctor && !lockDoctorId) {
      const primaryDoc = await fetchCasePrimaryDoctor(supabase, caseIdForDoctor);
      if (primaryDoc) sessionDoctorId = primaryDoc.id;
    }

    const insertSession = async (
      sessionKind: "plan" | "payment" | "discount",
      fields: Record<string, unknown>,
      labelOverride?: string
    ): Promise<{ op: PatientOperation | null; error: { message: string } | null }> => {
      const opLabel = labelOverride ?? operationLabel;
      const safePayload: Record<string, unknown> = {
        clinic_id: activeClinic.clinicId,
        patient_id: patientId,
        doctor_id: sessionDoctorId,
        operation_date: todayISO(),
        session_kind: sessionKind,
        ...fields,
      };
      const opColCandidates = [
        { key: "operation_name_ar", val: opLabel },
        { key: "operation_type", val: opLabel },
      ];
      const op: PatientOperation | null = null;
      let err: { message: string } | null = null;

      for (const { key, val } of opColCandidates) {
        const payload = { ...safePayload, [key]: val, ...optionalCols };
        const result = await supabase
          .from("patient_operations")
          .insert(payload)
          .select("*")
          .single();

        if (!result.error && result.data) {
          const row = result.data as PatientOperation;
          if (row.id) {
            return { op: row, error: null };
          }
        }

        const msg = result.error?.message ?? "";
        if (
          msg.includes("session_kind") ||
          msg.includes("discount_amount") ||
          msg.includes("treatment_case_id")
        ) {
          const stripped = { ...payload };
          delete stripped.session_kind;
          delete stripped.discount_amount;
          delete stripped.treatment_case_id;
          const retry = await supabase
            .from("patient_operations")
            .insert(stripped)
            .select("*")
            .single();
          if (!retry.error && retry.data?.id) {
            return { op: retry.data as PatientOperation, error: null };
          }
        }
        if (
          msg.includes("is_review_statement") ||
          msg.includes("review_fee_amount")
        ) {
          return {
            op: null,
            error: {
              message:
                "أعمدة الكشفية غير موجودة — شغّل supabase/scripts/fix-review-fee.sql في Supabase",
            },
          };
        }
        if (
          msg.includes(key) ||
          msg.includes("schema cache") ||
          msg.includes("Could not find")
        ) {
          if (msg.includes("notes")) delete optionalCols.notes;
          if (msg.includes("lab_notes")) delete optionalCols.lab_notes;
          err = result.error;
          continue;
        }
        return { op: null, error: result.error };
      }
      return { op, error: err };
    };

    let op: PatientOperation | null = null;
    let error: { message: string } | null = null;
    let savedCaseIdForWa: string | null = null;

    const ensureCaseForEntry = async (): Promise<{
      caseId: string | null;
      error: { message: string } | null;
    }> => {
      if (savedCaseIdForWa) {
        return { caseId: savedCaseIdForWa, error: null };
      }
      const existing = resolvePersistedCaseId(treatmentCases, selectedCaseId);
      if (existing && isPersistedTreatmentCaseId(existing)) {
        savedCaseIdForWa = existing;
        optionalCols.treatment_case_id = existing;
        return { caseId: existing, error: null };
      }
      if (!isNewCase) return { caseId: null, error: null };

      const initialPaid =
        billingMode === "session" ||
        billingMode === "complete" ||
        billingMode === "examination"
          ? entryAmount
          : 0;
      const created = await createTreatmentCaseViaApi({
        patientId: patientId!,
        treatmentName: operationLabel,
        casePrice: 0,
        discount: 0,
        paid: initialPaid,
        doctorShare: sessionPaymentShares.doctorShare,
        clinicShare: sessionPaymentShares.clinicShare,
        doctorId,
        sessionOnly: true,
      });
      if (!created.case?.id) {
        return {
          caseId: null,
          error: {
            message: created.error ?? "تعذر إنشاء حالة العلاج الجديدة",
          },
        };
      }
      savedCaseIdForWa = created.case.id;
      optionalCols.treatment_case_id = created.case.id;
      setSelectedCaseId(created.case.id);
      return { caseId: created.case.id, error: null };
    };

    if (
      !error &&
      additionalDiscount > 0 &&
      activePlan.final_price > FINANCIAL_EPSILON
    ) {
      const discRes = await insertSession(
        "discount",
        {
          discount_amount: additionalDiscount,
          total_amount: 0,
          paid_amount: 0,
        },
        `${operationLabel} — خصم إضافي`
      );
      if (discRes.error) {
        const fb = await applyAdditionalDiscountFallback(
          supabase,
          patientId!,
          activePlan,
          additionalDiscount
        );
        if (!fb.ok) error = { message: fb.error ?? discRes.error.message };
      } else {
        op = discRes.op;
      }
      activePlan = await fetchPatientFinancialPlan(supabase, patientId!);
    }

    if (!error && billingMode === "session" && entryAmount > 0) {
      const ensured = await ensureCaseForEntry();
      if (ensured.error) {
        error = ensured.error;
      } else {
        const paymentCols: Record<string, unknown> = {
          total_amount: 0,
          paid_amount: entryAmount,
          doctor_share_amount: sessionPaymentShares.doctorShare,
          clinic_share_amount: sessionPaymentShares.clinicShare,
        };
        if (materials > 0) paymentCols.materials_cost = materials;
        const res = await insertSession("payment", paymentCols);
        op = res.op;
        error = res.error;
      }
    }

    if (!error && billingMode === "debt" && entryAmount > 0) {
      const ensured = await ensureCaseForEntry();
      if (ensured.error) {
        error = ensured.error;
      } else if (!ensured.caseId) {
        error = { message: "اختر حالة أو ابدأ حالة جديدة قبل تسجيل الدين" };
      } else {
        const debtRes = await registerTreatmentCaseDebtViaApi({
          caseId: ensured.caseId,
          debtAmount: entryAmount,
        });
        if (!debtRes.ok) {
          error = { message: debtRes.error ?? "تعذر تسجيل الدين" };
        } else {
          const res = await insertSession(
            "payment",
            {
              total_amount: 0,
              paid_amount: 0,
              remaining_debt: entryAmount,
              doctor_share_amount: 0,
              clinic_share_amount: 0,
            },
            `${operationLabel} — تسجيل دين`
          );
          op = res.op;
          error = res.error;
        }
      }
    }

    if (!error && billingMode === "examination") {
      const ensured = await ensureCaseForEntry();
      if (ensured.error) {
        error = ensured.error;
      } else {
        if (examinationFeeLive > 0) {
          optionalCols.is_review_statement = true;
          optionalCols.review_fee_amount = examinationFeeLive;
        }
        const paymentCols: Record<string, unknown> = {
          total_amount: 0,
          paid_amount: examinationFeeLive,
          doctor_share_amount: 0,
          clinic_share_amount: examinationFeeLive,
        };
        const res = await insertSession(
          "payment",
          paymentCols,
          examinationFeeLive > 0
            ? `${operationLabel} — كشف + كشفية`
            : operationLabel
        );
        op = res.op;
        error = res.error;
      }
    }

    if (!error && billingMode === "complete") {
      const ensured = await ensureCaseForEntry();
      if (ensured.error) {
        error = ensured.error;
      } else {
        const caseId = ensured.caseId;
        if (entryAmount > 0) {
          const paymentCols: Record<string, unknown> = {
            total_amount: 0,
            paid_amount: entryAmount,
            doctor_share_amount: sessionPaymentShares.doctorShare,
            clinic_share_amount: sessionPaymentShares.clinicShare,
          };
          if (materials > 0) paymentCols.materials_cost = materials;
          const res = await insertSession("payment", paymentCols);
          op = res.op;
          error = res.error;
        } else if (!op?.id) {
          const res = await insertSession(
            "payment",
            { total_amount: 0, paid_amount: 0 },
            `${operationLabel} — إغلاق الحالة`
          );
          op = res.op;
          error = res.error;
        }
        if (!error && caseId) {
          const done = await completeTreatmentCaseViaApi(caseId);
          if (!done.ok) {
            error = { message: done.error ?? "تعذر إغلاق الحالة" };
          }
        }
      }
    }

    if (!error && !op?.id) {
      error = {
        message:
          "تعذر حفظ الجلسة في قاعدة البيانات — تحقق من صلاحيات الحساب أو أعد تشغيل الصفحة",
      };
    }

    const persistedCaseIdForLink = resolvePersistedCaseId(
      treatmentCases,
      selectedCaseId
    );
    let linkedCaseId = savedCaseIdForWa ?? persistedCaseIdForLink;
    if (!error && op?.id) {
      if (!linkedCaseId) {
        const resolved = await resolveCaseIdForOp(supabase, op);
        linkedCaseId = resolved.caseId;
      }
      if (linkedCaseId && isPersistedTreatmentCaseId(linkedCaseId)) {
        await linkOperationToTreatmentCase(supabase, op.id, linkedCaseId);
      }
    }

    const syncCaseId =
      (linkedCaseId && isPersistedTreatmentCaseId(linkedCaseId)
        ? linkedCaseId
        : null) ??
      (activeCaseId && isPersistedTreatmentCaseId(activeCaseId)
        ? activeCaseId
        : null);

    if (
      !error &&
      (billingMode === "session" ||
        billingMode === "complete" ||
        billingMode === "examination") &&
      (entryAmount > 0 || additionalDiscount > 0)
    ) {
      const sync = await syncTreatmentCaseAfterSessionViaApi({
        patientId: patientId!,
        treatmentName: pickedCase?.treatment_name_ar ?? operationLabel,
        plan: activePlan,
        paidDelta: entryAmount,
        additionalDiscount,
        caseId: syncCaseId,
      });
      if (!sync.ok) {
        setMessage({
          type: "error",
          text:
            `تم حفظ الجلسة لكن فشل تحديث ذمة الحالة: ${sync.error ?? "خطأ غير معروف"}. ` +
            "راجع ملف المريض وتأكد من تطابق الرصيد قبل إغلاق الحساب.",
        });
        return;
      }
    }

    if (error) {
      const msg = error.message ?? "";
      let display = `تعذر حفظ العملية: ${msg}`;

      if (msg.includes("has no field") || msg.includes("doctor_share")) {
        display =
          "خطأ في قاعدة البيانات: يوجد Trigger قديم يحتاج إصلاح.\n" +
          "شغّل هذا في Supabase SQL Editor:\n\n" +
          "DO $$ DECLARE r RECORD; BEGIN\n" +
          "  FOR r IN SELECT trigger_name FROM information_schema.triggers\n" +
          "  WHERE event_object_table = 'patient_operations'\n" +
          "  LOOP EXECUTE 'DROP TRIGGER IF EXISTS ' || r.trigger_name ||\n" +
          "  ' ON public.patient_operations CASCADE'; END LOOP; END $$;";
      }

      setMessage({ type: "error", text: display });
      return;
    }

    const operationIdForNotify = op!.id;
    const savedOp = op!;

    let snap = buildPostSaveFinancialSnap(activePlan, {
      billingMode,
      paid: entryAmount,
      debtAmount: billingMode === "debt" ? entryAmount : 0,
      additionalDiscount,
      completed: billingMode === "complete",
    });

    snap = {
      ...snap,
      doctor_share_total:
        activePlan.doctor_share_total + sessionPaymentShares.doctorShare,
      clinic_share_total:
        activePlan.clinic_share_total + sessionPaymentShares.clinicShare,
    };

    const planFinalForWa = snap.final_price;
    const justCompleted = billingMode === "complete" || snap.treatment_status === "completed";

    const waProcedureLabel =
      pickedCase?.treatment_name_ar?.trim() || operationLabel;
    const finalP =
      snap.final_price > 0
        ? snap.final_price
        : planFinalForWa > 0
          ? planFinalForWa
          : Number(savedOp.total_amount) || paid;
    const totalPaidCase =
      snap.total_paid > FINANCIAL_EPSILON ? snap.total_paid : paid;
    const remainingBal = snap.remaining_balance;

    const treatmentCaseIdForWa =
      savedCaseIdForWa && isPersistedTreatmentCaseId(savedCaseIdForWa)
        ? savedCaseIdForWa
        : syncCaseId ??
          (linkedCaseId && isPersistedTreatmentCaseId(linkedCaseId)
            ? linkedCaseId
            : null);

    const messageSnapshot =
      snap.total_paid > 0 || remainingBal > 0 || entryAmount > 0
        ? {
            remainingBalance: remainingBal,
            sessionNumber: isNewCase ? 1 : 0,
            totalSessionsInCase: isNewCase ? 1 : 0,
            procedureLabel: waProcedureLabel,
            paidThisSession: entryAmount,
            caseFinalPrice: finalP,
            caseTotalPaid: totalPaidCase,
          }
        : undefined;

    const invoicePatientName =
      patientQuery.trim() || defaultPatientName?.trim() || "مراجع";
    const invoicePatientPhone = phoneReady.phone;
    const invoiceDoctorName =
      selectedDoctor?.full_name_ar?.trim() ||
      lockDoctorName?.trim() ||
      "—";
    const invoiceNotes = notes.trim() || null;
    const invoiceLabNotes = labNotes.trim() || null;
    const labCostSplit =
      materials > 0 && selectedDoctor
        ? computeLabCostSplit(
            materials,
            Number(selectedDoctor.materials_share ?? 50)
          )
        : null;
    const shareSplit = resolveCaseFinancialSplit(snap, selectedDoctor, {
      materialsCost: materials,
    });

    setSelectedPatientId(patientId!);
    setFinancialPlan(snap);
    if (treatmentCaseIdForWa && isPersistedTreatmentCaseId(treatmentCaseIdForWa)) {
      setSelectedCaseId(treatmentCaseIdForWa);
    }
    setForceNewPlan(false);

    let successText: string;
    if (billingMode === "complete") {
      successText = `✓ تم إغلاق الحالة «${operationLabel}» — العلاج مكتمل.`;
      if (entryAmount > 0) {
        successText += ` آخر دفعة: ${formatCurrency(entryAmount)}.`;
      }
    } else if (billingMode === "debt") {
      successText = `✓ «${operationLabel}» — دين مسجّل: ${formatCurrency(entryAmount)}`;
      if (snap.total_paid > 0) {
        successText += ` · مجموع المدفوع: ${formatCurrency(snap.total_paid)}`;
      }
    } else if (billingMode === "examination") {
      if (examinationFeeLive > 0) {
        successText = `✓ كشف «${operationLabel}» — كشفية ${formatCurrency(examinationFeeLive)} (للعيادة)`;
      } else {
        successText = `✓ تم تسجيل كشف «${operationLabel}» — بدون رسوم`;
      }
    } else if (isNewCase) {
      successText = `✓ جلسة أولى «${operationLabel}» — دفع ${formatCurrency(entryAmount)}`;
    } else {
      const parts: string[] = [`«${operationLabel}»`];
      if (additionalDiscount > 0) {
        parts.push(`خصم ${formatCurrency(additionalDiscount)}`);
      }
      if (entryAmount > 0) parts.push(`دفع ${formatCurrency(entryAmount)}`);
      successText = `✓ ${parts.join(" — ")} · مجموع المدفوع: ${formatCurrency(snap.total_paid)}`;
      if (snap.remaining_balance > FINANCIAL_EPSILON) {
        successText += ` · الدين: ${formatCurrency(snap.remaining_balance)}`;
      }
    }
    setMessage({
      type: "success",
      text: successText,
    });

    setOperationName("");
      setTotalAmount("");
      setBillingMode("session");
      setApplyExaminationFee(false);
      setPaidAmount("");
    setDiscountAmount("");
    setAdditionalDiscountAmount("");
    setMaterialsCost("");
    setLabNotes("");
    setNotes("");
    resetClinical();
    clearDraft();
    notifySessionMutation({
      clinicId: activeClinic.clinicId,
      doctorId,
      patientId: patientId ?? undefined,
    });
    if (entryAmountLive > 0) {
      notifyClinicProfitRefresh(activeClinic.clinicId);
    }

    if (entryAmountLive > 0) {
      setPendingSuccessOp(savedOp);
      let rxIdForInvoice: string | null = null;
      if (visitQueueEntryId) {
        try {
          const rx = await resolvePrescriptionForSession(
            { queueEntryId: visitQueueEntryId },
            "accountant",
            { retries: 3, retryDelayMs: 1500 }
          );
          rxIdForInvoice = rx?.id ?? null;
        } catch {
          rxIdForInvoice = null;
        }
      }
      setPendingPrescriptionId(rxIdForInvoice);
      setInvoiceData(
        buildSessionInvoiceData({
          operation: savedOp,
          clinic: clinicProfile ?? null,
          patientName: invoicePatientName,
          patientPhone: invoicePatientPhone,
          doctorName: invoiceDoctorName,
          procedureLabel: waProcedureLabel,
          treatmentName:
            pickedCase?.treatment_name_ar?.trim() || operationLabel,
          paidThisSession: paid,
          caseTotalAmount: finalP,
          caseTotalPaid: totalPaidCase,
          remainingBalance: remainingBal,
          treatmentCompleted: justCompleted,
          sessionNumber: messageSnapshot?.sessionNumber,
          totalSessionsInCase: messageSnapshot?.totalSessionsInCase,
          notes: invoiceNotes,
          labNotes: invoiceLabNotes,
          materialsCost: materials > 0 ? materials : undefined,
          materialsSharePct: labCostSplit?.materialsSharePct,
          labDoctorShare: labCostSplit?.doctorShare,
          labClinicShare: labCostSplit?.clinicShare,
          doctorShareTotal:
            shareSplit?.doctorShare ??
            lockedSplit?.doctorShare ??
            snap.doctor_share_total,
          clinicShareTotal:
            shareSplit?.clinicShare ??
            lockedSplit?.clinicShare ??
            snap.clinic_share_total,
        })
      );
    } else {
      onSuccess?.(savedOp);
      void openPrescriptionModalIfAny(visitQueueEntryId, true);
    }

    const postSaveClinical = clinical;
    const postSaveBackfillCaseId =
      syncCaseId ??
      (savedCaseIdForWa && isPersistedTreatmentCaseId(savedCaseIdForWa)
        ? savedCaseIdForWa
        : null);
    const postSaveLinkCaseId =
      linkedCaseId && isPersistedTreatmentCaseId(linkedCaseId)
        ? linkedCaseId
        : null;
    const postSaveIsNewPlanCase = isNewCase && Boolean(savedCaseIdForWa);

    void (async () => {
      let whatsappNote = "";
      let clinicalWarning = "";

      try {
        if (postSaveBackfillCaseId && shareSplit) {
          await backfillTreatmentCaseSharesIfMissing(
            supabase,
            postSaveBackfillCaseId,
            {
              doctorShare: shareSplit.doctorShare,
              clinicShare: shareSplit.clinicShare,
            }
          );
        }

        await assignPrimaryDoctorForSession(supabase, {
          patientId: patientId!,
          doctorId: sessionDoctorId,
          caseId: postSaveBackfillCaseId,
        });

        if (postSaveLinkCaseId && !postSaveIsNewPlanCase) {
          await linkUnlinkedCaseOperations(
            supabase,
            postSaveLinkCaseId,
            patientId!,
            pickedCase?.treatment_name_ar ?? operationLabel
          );
        }

        const hasClinical =
          postSaveClinical.xrayFiles.length > 0 ||
          Object.keys(postSaveClinical.teeth).length > 0;
        if (hasClinical) {
          const clinicalRes = await saveSessionClinicalRecords(
            operationIdForNotify,
            postSaveClinical
          );
          if (!clinicalRes.ok) {
            clinicalWarning = ` — تحذير (مخطط/أشعة): ${clinicalRes.error ?? "تعذر الحفظ"}`;
          }
        }

        if (invoiceNotes) {
          await supabase
            .from("patient_operations")
            .update({ notes: invoiceNotes })
            .eq("id", operationIdForNotify);
        }

        try {
          const waRes = await fetch("/api/automation/dispatch", {
            method: "POST",
            credentials: "include",
            headers: {
              "Content-Type": "application/json",
              ...authPortalHeaders("accountant"),
            },
            body: JSON.stringify({
              event: "session_saved",
              operationId: operationIdForNotify,
              treatmentCompleted: justCompleted,
              treatmentCaseId: treatmentCaseIdForWa,
              messageSnapshot,
              queueEntryId: visitQueueEntryId ?? null,
              skipPatientWhatsApp: true,
              skipDoctorWhatsApp: true,
            }),
          });

          const waData = (await waRes.json()) as {
            whatsapp?: {
              sent?: boolean;
              skipped?: string;
              pending?: boolean;
              errors?: string[];
            };
            error?: string;
          };
          const wa = waData.whatsapp;

          if (!waRes.ok) {
            whatsappNote = ` — واتساب: ${waData.error ?? "فشل الطلب"}`;
          } else if (waData.error && !wa?.sent) {
            whatsappNote = ` — واتساب: ${waData.error}`;
          } else if (wa?.skipped === "manual_patient_only") {
            whatsappNote =
              " — أرسل واتساب للمراجع من نافذة الفاتورة (لا إرسال تلقائي للطبيب).";
          } else if (wa?.sent) {
            whatsappNote =
              " — أُرسل واتساب للمراجع — راجع نافذة الفاتورة إن لزم.";
          } else if (wa?.skipped === "no_patient_phone") {
            whatsappNote =
              " — لم يُرسل واتساب: أضف رقم جوال المراجع في الحقل أعلاه.";
          } else if (wa?.pending) {
            whatsappNote =
              " — واتساب غير مضبوط (WHATSAPP_* في .env.local).";
          } else if (wa?.errors?.includes("operation_context_load_failed")) {
            whatsappNote =
              " — تعذر قراءة الجلسة للواتساب (أعد تشغيل npm run dev وجرب مرة أخرى).";
          } else if (wa?.errors?.length) {
            whatsappNote = ` — تعذر إرسال واتساب: ${wa.errors[0]}`;
          } else if (!wa?.sent) {
            whatsappNote = " — لم يُرسل واتساب (تحقق من السجلات).";
          }
        } catch {
          whatsappNote = " — تعذر تشغيل إرسال واتساب تلقائياً.";
        }

        if (visitQueueEntryId && activeClinic.clinicId && entryAmount > 0) {
          try {
            await fetch("/api/operations/complete-visit", {
              method: "POST",
              credentials: "include",
              headers: {
                "Content-Type": "application/json",
                ...authPortalHeaders("accountant"),
              },
              body: JSON.stringify({ queue_entry_id: visitQueueEntryId }),
            });
            notifyQueueRefresh({
              scope: "clinic",
              clinicId: activeClinic.clinicId,
            });
          } catch {
            // الدفع سُجّل — إغلاق الدور اختياري
          }
        }

        const refreshedCases = await fetchPatientTreatmentCases(
          supabase,
          patientId!,
          activeClinic.clinicId
        );
        setTreatmentCases(refreshedCases);
        onTreatmentCasesChanged?.(refreshedCases);
        const refreshedCase = treatmentCaseIdForWa
          ? refreshedCases.find((c) => c.id === treatmentCaseIdForWa) ?? null
          : null;
        if (refreshedCase) {
          setFinancialPlan(caseToFinancialPlan(refreshedCase));
        }

        if (whatsappNote || clinicalWarning) {
          setMessage((prev) =>
            prev?.type === "success"
              ? { ...prev, text: prev.text + whatsappNote + clinicalWarning }
              : prev
          );
        }
      } catch (bgErr) {
        console.error("[QuickEntryForm] post-save background", bgErr);
      }
    })();

    return;

    } catch (err) {
      console.error("[QuickEntryForm] handleSubmit", err);
      if (isNetworkFailure(err)) {
        const retry = await tryEnqueueQuickEntryOffline(offlineInput, {
          force: true,
        });
        if (retry.handled && retry.ok) {
          setMessage({ type: "success", text: retry.message });
          clearDraft();
          resetClinical();
          setPaidAmount("");
          setTotalAmount("");
          setDiscountAmount("");
          setAdditionalDiscountAmount("");
          setMaterialsCost("");
          setLabNotes("");
          setNotes("");
          return;
        }
      }
      setMessage({
        type: "error",
        text:
          err instanceof Error
            ? `خطأ غير متوقع: ${err.message}`
            : "خطأ غير متوقع أثناء الحفظ — أعد المحاولة",
      });
    } finally {
      setLoading(false);
    }
  }

  return (
    <Card
      className={
        embedded ? "border-0 bg-transparent shadow-none p-0" : undefined
      }
    >
      {!embedded && (
        <CardHeader>
          <CardTitle className="!text-lg !font-bold text-primary-800">
            {loadingPlan && selectedPatientId
              ? "جاري تحميل ملف المريض..."
              : showCasePicker
                ? "اختر حالة العلاج"
                : isFollowUpSession
                  ? `متابعة: ${selectedCase?.treatment_name_ar ?? "حالة"}`
                  : "حالة علاج جديدة"}
          </CardTitle>
          {isFollowUpSession && !loadingPlan && (
            <p className="mt-0.5 text-sm text-slate-600">
              اختر نوع التسجيل ثم المبلغ — بدون سعر كلي للحالة
            </p>
          )}
          {!isFollowUpSession && !showCasePicker && !loadingPlan && (
            <p className="mt-0.5 text-sm text-slate-600">
              نوع الإجراء ← نوع التسجيل (جلسة / دين / مكتمل) ← المبلغ
            </p>
          )}
        </CardHeader>
      )}

      <form
        noValidate
        onSubmit={handleSubmit}
        className={`mc-quick-entry-form grid gap-4 sm:grid-cols-2 ${embedded ? "px-0" : ""}`}
      >

        {isCaseClosed && (
          <div className="sm:col-span-2 space-y-3">
            <Alert variant="success">
              تم إكمال العلاج — الحالة «
              {selectedCase?.treatment_name_ar ?? "المختارة"}» مغلقة. لبدء
              علاج جديد (مثلاً سن آخر) اضغط الزر أدناه.
            </Alert>
            <Button
              type="button"
              variant="outline"
              className="w-full sm:w-auto"
              onClick={() =>
                beginNewTreatmentCase(selectedCase?.treatment_name_ar)
              }
            >
              + حالة علاج جديدة
            </Button>
          </div>
        )}

        {forceNewPlan && !showCasePicker && (
          <div className="sm:col-span-2 rounded-lg border border-primary/25 bg-primary/[0.06] px-3 py-2">
            <p className="text-sm font-bold text-primary-800">حالة علاج جديدة</p>
            <p className="mt-0.5 text-xs text-primary-700">
              جلسة ← المبلغ المدفوع — أو دين ← مبلغ الذمة — أو مكتمل لإغلاق الحالة
            </p>
            {operationName.trim() && (
              <p className="text-xs text-slate-muted mt-1">
                نوع العلاج: {operationName.trim()}
              </p>
            )}
          </div>
        )}

        {loadingPlan && selectedPatientId && (
          <p className="sm:col-span-2 text-sm text-slate-muted">
            جاري جلب بيانات المريض والذمة المتبقية...
          </p>
        )}

        {draftRestored && (
          <div className="sm:col-span-2">
            <Alert variant="info">
              تم استعادة ما كتبته قبل الخروج — أكمل ثم احفظ. صور الأشعة تحتاج
              إعادة اختيار إن وُجدت.
              <button
                type="button"
                className="mr-2 underline"
                onClick={dismissDraftNotice}
              >
                إخفاء
              </button>
            </Alert>
          </div>
        )}

        {message && (
          <div className="sm:col-span-2">
            <Alert variant={message.type === "success" ? "success" : "error"}>
              {message.text}
            </Alert>
          </div>
        )}

        {formSchema.showPatientSearch && (
        <div className="sm:col-span-2">
          <label className="mc-entry-field-label">
            المريض{" "}
            {selectedPatientId && (
              <span className="text-sm font-semibold text-primary">← مريض محدد</span>
            )}
          </label>
          <div className="flex gap-2">
            <PatientSearchField
              portal="accountant"
              value={patientQuery}
              selectedPatientId={selectedPatientId}
              disabled={!!defaultPatientId}
              required
              showIcon={false}
              placeholder={
                isFollowUpSession
                  ? "ابحث عن اسم المريض..."
                  : "اسم المريض — جديد أو موجود"
              }
              className="min-w-0 flex-1"
              onChange={(v) => {
                setPatientQuery(v);
                setSelectedPatientId(null);
                setPatientPhone("");
              }}
              onSelect={(p) => {
                setSelectedPatientId(p.id);
                setPatientQuery(p.full_name_ar);
                setPatientPhone(getPatientDisplayPhone(p) ?? "");
              }}
            />
            {selectedPatientId && !defaultPatientId && (
              <button
                type="button"
                onClick={() => {
                  setSelectedPatientId(null);
                  setPatientQuery("");
                  setPatientPhone("");
                }}
                className="text-xs text-slate-muted hover:text-debt-text px-2"
              >
                ✕
              </button>
            )}
          </div>
        </div>
        )}

        {formSchema.showPatientSearch && !selectedPatientId && (
          <div className="sm:col-span-2">
            <label className="mc-entry-field-label">
              رقم هاتف المراجع <span className="text-debt-text">*</span>
            </label>
            <input
              type="tel"
              dir="ltr"
              required
              className="mc-entry-input"
              value={patientPhone}
              onChange={(e) => setPatientPhone(e.target.value)}
              placeholder="07XX XXX XXXX أو +9647XXXXXXXXX"
            />
            <p className="mt-1 text-xs text-slate-muted">
              يُحفظ بصيغة +964 — يُستخدم لإشعارات الواتساب لاحقاً
            </p>
          </div>
        )}

        {selectedPatientId && (
          <div className="sm:col-span-2">
            <label className="mc-entry-field-label">
              رقم واتساب المراجع{" "}
              <span className="text-debt-text">*</span>
              <span className="text-sm font-medium text-slate-500">
                {" "}
                (لإرسال الفاتورة بعد الجلسة)
              </span>
            </label>
            <input
              type="tel"
              dir="ltr"
              required={phoneInputRequired}
              className="mc-entry-input"
              value={patientPhone}
              onChange={(e) => setPatientPhone(e.target.value)}
              placeholder="07XX XXX XXXX"
            />
            {defaultPatientPhone?.trim() && embedded && (
              <p className="mt-1 text-xs text-slate-muted" dir="ltr">
                الرقم المحفوظ: {defaultPatientPhone}
              </p>
            )}
            {!patientPhone.trim() && !defaultPatientPhone?.trim() && isFollowUpSession && (
              <p className="mt-1 text-xs text-amber-700">
                بدون رقم لن تُرسل رسالة واتساب — اختبار الإرسال يستخدم رقمك أنت
                فقط.
              </p>
            )}
          </div>
        )}

        {formSchema.showAssignedDoctor && assignedDoctor && (
          <div className="sm:col-span-2 rounded-xl border border-slate-border bg-surface/80 px-4 py-3">
            <p className="text-xs text-slate-muted">الطبيب المعالج لهذه الحالة</p>
            <p className="text-base font-semibold text-slate-text">
              {assignedDoctor.full_name_ar}
            </p>
            <p className="mt-0.5 text-[11px] text-slate-muted">
              الجلسة الجديدة لهذه الحالة فقط تُحسب للطبيب أعلاه — حالات أخرى
              للمراجع لها أطباؤها. لتغيير طبيب هذه الحالة استخدم «تحويل طبيب».
            </p>
          </div>
        )}

        {selectedPatientId &&
          activeClinicId &&
          !showCasePicker &&
          treatmentCases.some((c) => isPersistedTreatmentCaseId(c.id)) && (
            <div className="sm:col-span-2">
              <TransferDoctorPanel
                embedded
                patientId={selectedPatientId}
                clinicId={activeClinicId}
                treatmentCases={treatmentCases}
                onTransferred={handleCaseDoctorTransferred}
              />
            </div>
          )}

        {formSchema.showCasePicker ? (
          <TreatmentCasePicker
            cases={treatmentCases}
            onSelect={(c) => {
              const persisted =
                isPersistedTreatmentCaseId(c.id)
                  ? c.id
                  : resolvePersistedCaseId(treatmentCases, c.id);
              if (!persisted) return;
              const row =
                treatmentCases.find((x) => x.id === persisted) ?? c;
              applyTreatmentCaseSelection(row, {
                setSelectedCaseId,
                setFinancialPlan,
                setOperationName,
                setForceNewPlan,
              });
              resetClinical();
              setMessage(null);
            }}
            onNewCase={(prefillTreatmentName) => {
              beginNewTreatmentCase(prefillTreatmentName);
            }}
          />
        ) : (
        <>
        {loadingPlan && selectedPatientId && (
          <p className="sm:col-span-2 text-sm text-slate-muted animate-pulse">
            جاري تحديث بيانات الحالة...
          </p>
        )}
        {isFollowUpSession && selectedCase && !embedded && (
          <div className="sm:col-span-2 flex flex-wrap items-center justify-between gap-2 mc-section-box">
            <div>
              <p className="text-xs text-slate-muted">الحالة المختارة</p>
              <p className="font-semibold text-slate-text">
                {selectedCase.treatment_name_ar}
              </p>
            </div>
            <button
              type="button"
              className="text-sm text-primary hover:underline"
              onClick={() => {
                setSelectedCaseId(null);
                setFinancialPlan(EMPTY_FINANCIAL_PLAN);
                setForceNewPlan(false);
              }}
            >
              تغيير الحالة
            </button>
          </div>
        )}

        {formSchema.showDoctor && (
        <>
        {lockDoctorId ? (
          <div className="sm:col-span-2 mc-section-box">
            <p className="text-xs text-slate-muted">طبيب الموعد / الجلسة</p>
            <p className="text-base font-semibold text-slate-text">
              {selectedDoctor?.full_name_ar ??
                assignedDoctor?.full_name_ar ??
                lockDoctorName ??
                "جاري التحميل..."}
            </p>
          </div>
        ) : (
          <>
            {selectedDoctor && (
              <div className="sm:col-span-2 mc-section-box--warning px-4 py-2 text-sm">
                تأكد من <strong>الطبيب</strong> قبل الحفظ — الرصيد يُحسب لهذا الطبيب فقط
              </div>
            )}
            <Select
              label="الطبيب *"
              name="doctor_id"
              value={doctorId}
              onChange={(e) => setDoctorId(e.target.value)}
              options={doctors.map((d) => ({ value: d.id, label: d.full_name_ar }))}
              placeholder="اختر الطبيب"
              required
              className="!h-10 !rounded-lg !border-2 !text-sm !font-semibold"
            />
          </>
        )}
        </>
        )}

        {(formSchema.showPlanSummary || plan.total_paid > 0) && !showCasePicker && (
          <div className="sm:col-span-2 rounded-lg border border-primary/20 bg-primary/[0.05] px-3 py-2.5 space-y-1 text-sm">
            <p className="text-sm font-bold text-primary-800">ملخص الحالة</p>
            <p className="text-xs tabular-nums text-slate-muted">
              مجموع المدفوع:{" "}
              <span className="font-semibold text-primary">
                {formatCurrency(plan.total_paid)}
              </span>
            </p>
            {plan.final_price > FINANCIAL_EPSILON && (
              <p className="text-xs tabular-nums text-slate-muted">
                دين مسجّل / متبقٍ:{" "}
                <span className="font-semibold text-debt-text">
                  {formatCurrency(plan.remaining_balance)}
                </span>
              </p>
            )}
            {(paid > 0 || billingMode === "debt") && (
              <p className="text-xs tabular-nums mt-2 text-primary font-medium">
                بعد هذا الإدخال — مجموع المدفوع:{" "}
                {formatCurrency(billingPreview.totalPaidAfter)}
                {remaining > FINANCIAL_EPSILON && (
                  <>
                    {" · "}الدين:{" "}
                    <span className="text-debt-text font-bold">
                      {formatCurrency(remaining)}
                    </span>
                  </>
                )}
              </p>
            )}
          </div>
        )}

        {formSchema.showOperation && billingMode !== "examination" && (
        <div className={isFollowUpSession ? "sm:col-span-2" : ""}>
          <label className="mc-entry-field-label">
            نوع الإجراء *
          </label>
          <input
            list={listId}
            type="text"
            className="mc-entry-input"
            value={operationName}
            onChange={(e) => setOperationName(e.target.value)}
            placeholder="حشوة ضوئية / تاج زيركون / ..."
            required
          />
          <datalist id={listId}>
            {DENTAL_SUGGESTIONS.map((s) => (
              <option key={s} value={s} />
            ))}
          </datalist>
        </div>
        )}

        {(formSchema.showBillingMode ||
          formSchema.showPaidAmount ||
          formSchema.showAdditionalDiscount) && (
          <div className="sm:col-span-2 mc-entry-finance space-y-3">
            <div>
              <h4 className="mc-entry-finance__title">التسجيل المالي</h4>
              <p className="mc-entry-finance__subtitle">
                {SESSION_BILLING_MODE_OPTIONS.find((o) => o.value === billingMode)
                  ?.hint ?? "اختر نوع التسجيل ثم المبلغ"}
              </p>
            </div>

            {formSchema.showBillingMode && (
              <Select
                label="نوع التسجيل *"
                name="billing_mode"
                value={billingMode}
                onChange={(e) => {
                  const mode = e.target.value as SessionBillingMode;
                  setBillingMode(mode);
                  if (mode === "examination") {
                    setApplyExaminationFee(
                      reviewFeeEnabled && clinicReviewFeeAmount > 0
                    );
                    setPaidAmount("");
                    if (!operationName.trim()) setOperationName("كشف");
                  }
                }}
                options={SESSION_BILLING_MODE_OPTIONS.map((o) => ({
                  value: o.value,
                  label: o.label,
                }))}
                required
                className="!h-10 !rounded-lg !border-2 !text-sm !font-semibold"
              />
            )}

            {billingMode === "examination" && (
              <div className="space-y-3 rounded-lg border border-sky-200 bg-sky-50/70 p-3">
                <div>
                  <label className="mc-entry-field-label">
                    نوع الكشف (اختياري)
                  </label>
                  <input
                    type="text"
                    className="mc-entry-input"
                    value={operationName}
                    onChange={(e) => setOperationName(e.target.value)}
                    placeholder="كشف"
                  />
                </div>
                <label className="flex items-center gap-2 text-sm text-slate-text">
                  <input
                    type="checkbox"
                    checked={applyExaminationFee}
                    onChange={(e) => setApplyExaminationFee(e.target.checked)}
                    className="h-4 w-4 rounded border-slate-border text-primary"
                  />
                  كشفية مراجع
                  {reviewFeeEnabled && clinicReviewFeeAmount > 0 && (
                    <span className="font-semibold text-primary tabular-nums">
                      {formatCurrency(clinicReviewFeeAmount)}
                    </span>
                  )}
                </label>
                {applyExaminationFee && reviewFeeEnabled && clinicReviewFeeAmount > 0 && (
                  <p className="text-xs text-slate-muted tabular-nums">
                    تُسجَّل كدفعة للعيادة بالكامل — لا تدخل محفظة الطبيب
                  </p>
                )}
                {applyExaminationFee && !reviewFeeEnabled && (
                  <p className="text-xs text-amber-800">
                    فعّل الكشفية من{" "}
                    <a href="/dashboard/settings" className="underline font-medium">
                      إعدادات العيادة
                    </a>
                  </p>
                )}
                {!applyExaminationFee && (
                  <p className="text-xs text-slate-muted">
                    كشف بدون رسوم — تسجيل زيارة فقط
                  </p>
                )}
              </div>
            )}

            {formSchema.showPaidAmount && billingMode !== "examination" && (
              <div className="space-y-1.5">
                <CurrencyInput
                  label={amountFieldLabel(billingMode)}
                  value={paidAmount}
                  onChange={setPaidAmount}
                  placeholder={
                    billingMode === "debt" ? "150,000" : "50,000"
                  }
                  required={
                    billingMode === "session" ||
                    billingMode === "debt"
                  }
                  size="large"
                  tone={billingMode === "debt" ? "total" : "paid"}
                />
                {billingMode === "session" &&
                  remaining > FINANCIAL_EPSILON &&
                  !isCaseClosed &&
                  isFollowUpSession && (
                  <button
                    type="button"
                    className="w-full rounded-lg border border-primary bg-primary px-3 py-2 text-sm font-semibold text-white hover:bg-primary-700"
                    onClick={() =>
                      setPaidAmount(String(Math.round(remaining)))
                    }
                  >
                    دفع الدين كاملاً ({formatCurrency(remaining)})
                  </button>
                )}
              </div>
            )}

            {formSchema.showAdditionalDiscount && (
              <div className="space-y-1">
                <CurrencyInput
                  label="خصم إضافي (اختياري)"
                  value={additionalDiscountAmount}
                  onChange={setAdditionalDiscountAmount}
                  placeholder="0"
                />
                {additionalDiscountNum > 0 && (
                  <p className="text-xs font-semibold text-amber-800 tabular-nums">
                    يُخصم {formatCurrency(additionalDiscountNum)} — المتبقي:{" "}
                    {formatCurrency(remaining)}
                  </p>
                )}
              </div>
            )}

            {billingMode === "session" && paid > 0 && (
              <div className="rounded-lg border border-success-border bg-success px-3 py-2.5">
                <p className="text-xs font-bold text-success-text">
                  بعد هذه الجلسة — مجموع المدفوع
                </p>
                <p className="mt-0.5 text-xl font-bold tabular-nums text-success-text">
                  {formatCurrency(billingPreview.totalPaidAfter)}
                </p>
              </div>
            )}

            {billingMode === "debt" && paid > 0 && (
              <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2.5">
                <p className="text-xs font-bold text-amber-900">
                  دين مسجّل على المراجع
                </p>
                <p className="mt-0.5 text-xl font-bold tabular-nums text-debt-text">
                  {formatCurrency(paid)}
                </p>
              </div>
            )}
          </div>
        )}

        {formSchema.showMaterials && (
          <div className="sm:col-span-2 space-y-2 rounded-lg border border-amber-200/80 bg-amber-50/40 p-3">
            <p className="text-sm font-bold text-amber-900">المختبر (اختياري)</p>
            <CurrencyInput
              label="تكلفة عمل المختبر"
              value={materialsCost}
              onChange={setMaterialsCost}
              placeholder="0"
            />
            <div>
              <label className="mc-entry-field-label">
                ملاحظات المختبر
              </label>
              <textarea
                className="mc-entry-input min-h-[4rem] resize-none"
                rows={3}
                value={labNotes}
                onChange={(e) => setLabNotes(e.target.value)}
                placeholder="تعليمات تفصيلية لعمل المختبر..."
              />
            </div>
          </div>
        )}

        {treatmentCases.length > 0 && !showCasePicker && (
          <div className="sm:col-span-2">
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => {
                setSelectedCaseId(null);
                setForceNewPlan(false);
                setFinancialPlan(EMPTY_FINANCIAL_PLAN);
              }}
            >
              ← العودة لاختيار حالة أخرى
            </Button>
          </div>
        )}

        {formSchema.showReviewCheckbox && billingMode !== "examination" && (
        <div className="sm:col-span-2 space-y-1">
          <label className="flex items-center gap-2 text-sm text-slate-text">
            <input
              type="checkbox"
              checked={isReviewStatement}
              onChange={(e) => setIsReviewStatement(e.target.checked)}
              disabled={!reviewFeeEnabled}
              className="h-4 w-4 rounded border-slate-border text-primary"
            />
            كشفية مراجع
            {reviewFeeEnabled && clinicReviewFeeAmount > 0 && (
              <span className="font-semibold text-primary tabular-nums">
                +{formatCurrency(clinicReviewFeeAmount)}
              </span>
            )}
          </label>
          {!reviewFeeEnabled && (
            <p className="text-xs text-amber-800">
              فعّل الكشفية من{" "}
              <a href="/dashboard/settings" className="underline font-medium">
                إعدادات العيادة
              </a>
            </p>
          )}
          {isReviewStatement && reviewFeeLive > 0 && (
            <p className="text-xs text-slate-muted tabular-nums">
              الكشفية تُضاف للذمة وتذهب <strong>كاملة للعيادة</strong> — لا تدخل محفظة
              الطبيب. الإجمالي: {formatCurrency(finalPriceLive)}
            </p>
          )}
        </div>
        )}

        {visitQueueEntryId && (selectedPatientId || defaultPatientId) && (
          <div className="sm:col-span-2 space-y-3">
            {!showVisualRecordReview ? (
              <div className="rounded-lg border border-slate-border bg-surface/80 p-4">
                <p className="text-sm font-semibold text-slate-text">
                  مراجعة السجل البصري
                </p>
                <p className="mt-1 text-xs text-slate-muted">
                  ما سجّله الطبيب أثناء الكشف — اضغط الزر للعرض دون إطالة صفحة
                  إدخال الجلسة
                </p>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="mt-3"
                  onClick={() => setShowVisualRecordReview(true)}
                >
                  <Scan className="h-4 w-4" />
                  مراجعة السجل البصري
                </Button>
              </div>
            ) : (
              <>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => setShowVisualRecordReview(false)}
                >
                  <X className="h-4 w-4" />
                  إغلاق السجل البصري — العودة لإدخال الجلسة
                </Button>
                <VisitSessionClinicalPanel
                  patientId={selectedPatientId ?? defaultPatientId ?? null}
                  queueEntryId={visitQueueEntryId}
                  portal="accountant"
                  entryReviewMode
                  hideHeader
                />
              </>
            )}
          </div>
        )}

        {formSchema.showClinicalRecord && !visitQueueEntryId && (
        <VisualMedicalRecord
          draft={clinical}
          onDraftChange={setClinical}
          disabled={loading}
          chartResetKey={clinicalResetKey}
          portal="accountant"
          collapsible
          defaultOpen={false}
          className="sm:col-span-2"
        />
        )}

        {formSchema.showNotes && (
        <div className="sm:col-span-2">
          <label className="mc-entry-field-label">
            ملاحظات
          </label>
          <textarea
            className="mc-entry-input min-h-[4.5rem] resize-none"
            rows={3}
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            placeholder="ملاحظات الجلسة..."
          />
        </div>
        )}

        {formSchema.showFinancialPreview && billingMode !== "debt" && (
        <FinancialPreview
          className="sm:col-span-2"
          paymentSplitOnly
          totalAmount={0}
          materialsCost={materials}
          doctor={selectedDoctor}
          isPaymentSession
          paidAmount={entryAmountLive}
          paidSplitOverride={paymentPreviewSplit}
        />
        )}

        {(billingMode === "debt" ||
          remaining > FINANCIAL_EPSILON ||
          (plan.final_price > FINANCIAL_EPSILON &&
            (isFollowUpSession || billingMode === "complete"))) && (
        <div className="sm:col-span-2 mc-entry-remaining">
          <p className="text-sm font-bold text-slate-text">
            {isFollowUpSession || billingMode === "debt"
              ? "الذمة المتبقية"
              : "المتبقي (ذمة)"}
          </p>
          {isFollowUpSession && plan.final_price > FINANCIAL_EPSILON && (
            <p className="mt-0.5 text-xs text-slate-muted tabular-nums">
              السعر النهائي: {formatCurrency(finalPriceLive)}
            </p>
          )}
          <p
            className={`mt-1 text-2xl font-bold tabular-nums ${
              remaining > 0 ? "text-debt-text" : "text-success-text"
            }`}
          >
            {formatCurrency(remaining)}
          </p>
          {isCaseFullySettled(plan, {
            additionalDiscount: additionalDiscountNum,
            newPayment: paid,
          }) &&
            finalPriceLive > 0 && (
            <p className="text-xs font-semibold text-success-text mt-1">
              ✓ بعد الحفظ: تم إكمال العلاج — لا ذمة متبقية على هذه الحالة
            </p>
          )}
        </div>
        )}

        <div className="sm:col-span-2">
          <Button
            type="submit"
            className="w-full sm:w-auto"
            disabled={
              loading || isCaseClosed || (loadingPlan && !selectedCaseId)
            }
          >
            {loading
              ? "جاري الحفظ..."
              : isFollowUpSession
                ? isCaseFullySettled(plan, {
                    additionalDiscount: additionalDiscountNum,
                    newPayment: paid,
                  })
                  ? "تسجيل الدفعة — إكمال العلاج"
                  : "تسجيل الدفعة"
                : "حفظ أول جلسة"}
          </Button>
        </div>

        </>
        )}
      </form>

      {invoiceData && (
        <SessionInvoiceModal
          data={invoiceData}
          queueEntryId={visitQueueEntryId}
          prescriptionId={pendingPrescriptionId}
          onFinalized={() => {
            if (pendingSuccessOp) {
              onSuccess?.(pendingSuccessOp);
              setPendingSuccessOp(null);
            }
            setPendingPrescriptionId(null);
          }}
          onClose={() => {
            setInvoiceData(null);
            setPendingPrescriptionId(null);
            if (pendingSuccessOp) {
              onSuccess?.(pendingSuccessOp);
              setPendingSuccessOp(null);
            }
          }}
        />
      )}

      {prescriptionModalId && !invoiceData && (
        <PrescriptionPrintModal
          prescriptionId={prescriptionModalId}
          portal="accountant"
          queueEntryId={visitQueueEntryId}
          afterSessionSave
          onClose={() => {
            setPrescriptionModalId(null);
            setPendingPrescriptionId(null);
          }}
        />
      )}
    </Card>
  );
}
