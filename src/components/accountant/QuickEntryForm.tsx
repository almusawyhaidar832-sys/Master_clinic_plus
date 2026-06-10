"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import { Button } from "@/components/ui/Button";
import { CurrencyInput } from "@/components/ui/CurrencyInput";
import { Select } from "@/components/ui/Select";
import { Card, CardHeader, CardTitle } from "@/components/ui/Card";
import { Alert } from "@/components/ui/Alert";
import { formatCurrency, parseFormattedNumber, todayISO } from "@/lib/utils";
import { createClient } from "@/lib/supabase/client";
import { getActiveClinicId } from "@/lib/clinic-context";
import { FinancialPreview } from "@/components/financial/FinancialPreview";
import { SessionClinicalRecord } from "@/components/clinical/SessionClinicalRecord";
import {
  EMPTY_CLINICAL_DRAFT,
  type SessionClinicalDraft,
} from "@/lib/clinical/constants";
import { saveSessionClinicalRecords } from "@/lib/clinical/session-records";
import {
  applyAdditionalDiscountFallback,
  computeFinalPrice,
  fetchPatientFinancialPlan,
  hasTreatmentPlan,
  isCaseFullySettled,
  isTreatmentCaseClosed,
  isTreatmentCaseComplete,
  FINANCIAL_EPSILON,
  previewTreatmentSplitWithReview,
  resolveSessionKind,
  saveFirstSessionPlanFallback,
  type PatientFinancialPlan,
} from "@/lib/services/patient-financial-plan";
import {
  buildSessionEntrySchema,
  previewSessionFinancials,
} from "@/lib/services/session-entry-form";
import {
  caseToFinancialPlan,
  createTreatmentCaseViaApi,
  fetchPatientTreatmentCases,
  isPersistedTreatmentCaseId,
  linkOperationToTreatmentCase,
  linkUnlinkedCaseOperations,
  resolveCaseIdForOp,
  resolvePersistedCaseId,
  syncTreatmentCaseAfterSessionViaApi,
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
import { opDebt } from "@/types";
import {
  ensurePatientPhoneOnRecord,
  getPatientDisplayPhone,
  patientPhoneColumns,
  validatePatientPhone,
} from "@/lib/phone";
import { notifySessionMutation } from "@/lib/sync/mutation-notify";
import { notifyClinicProfitRefresh } from "@/lib/services/clinic-profit";
import { useClinicProfile } from "@/contexts/ClinicProfileContext";
import { SessionInvoiceModal } from "@/components/invoices/SessionInvoiceModal";
import {
  buildSessionInvoiceData,
  type SessionInvoiceData,
} from "@/lib/invoices/session-invoice";

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
  onSuccess,
  onTreatmentCasesChanged,
}: QuickEntryFormProps) {
  const { profile: clinicProfile } = useClinicProfile();
  const [invoiceData, setInvoiceData] = useState<SessionInvoiceData | null>(null);
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
  const [operationName, setOperationName] = useState(() => {
    if (defaultForceNewPlan && defaultNewCaseTreatmentName?.trim()) {
      return defaultNewCaseTreatmentName.trim();
    }
    return initialCase ? initialCase.treatment_name_ar : "";
  });
  const [totalAmount, setTotalAmount] = useState("");
  const [paidAmount, setPaidAmount] = useState("");
  const [discountAmount, setDiscountAmount] = useState("");
  const [additionalDiscountAmount, setAdditionalDiscountAmount] = useState("");
  const [materialsCost, setMaterialsCost] = useState("");
  const [notes, setNotes] = useState("");
  const [isReviewStatement, setIsReviewStatement] = useState(false);
  const [reviewFeeEnabled, setReviewFeeEnabled] = useState(false);
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

  const handleCaseDoctorTransferred = useCallback(
    async (caseId: string, doc: PatientPrimaryDoctor) => {
      const activeCase =
        resolvePersistedCaseId(treatmentCases, selectedCaseId) ?? selectedCaseId;
      if (activeCase === caseId || selectedCaseId === caseId) {
        setAssignedDoctor(doc);
        if (!lockDoctorId) setDoctorId(doc.id);
      }
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
      setPaidAmount("");
      setDiscountAmount("");
      setAdditionalDiscountAmount("");
      setMaterialsCost("");
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
    isReviewStatement && reviewFeeEnabled && clinicReviewFeeAmount > 0
      ? clinicReviewFeeAmount
      : 0;

  const financialPreview = previewSessionFinancials(plan, {
    isFirstSession,
    casePrice: casePriceNum,
    initialDiscount: discountNum,
    additionalDiscount: additionalDiscountNum,
    newPayment: paid,
    reviewFee: reviewFeeLive,
  });
  const finalPriceLive = financialPreview.finalPrice;
  const remaining = financialPreview.remainingBalance;

  const selectedDoctor = doctors.find((d) => d.id === doctorId) ?? null;

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
      ? {
          agreedTotal: plan.final_price,
          doctorShare: plan.doctor_share_total,
          clinicShare: plan.clinic_share_total,
        }
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
    }
  }, [isFollowUpSession, selectedCaseId]);

  useEffect(() => {
    resetClinical();
  }, [selectedPatientId, selectedCaseId, forceNewPlan, resetClinical]);

  useEffect(() => {
    if (lockDoctorId || !selectedPatientId) return;
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
  }, [selectedPatientId, selectedCaseId, lockDoctorId]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setMessage(null);

    if (showCasePicker) {
      setMessage({ type: "error", text: "اختر الحالة من القائمة أولاً" });
      return;
    }

    if (formSchema.showOperation && !operationName.trim()) {
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

    try {
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
    const entryMode =
      forceNewPlan || !selectedCaseId ? "plan" : "payment";

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
      (pickedCase
        ? isTreatmentCaseComplete(caseToFinancialPlan(pickedCase))
        : isTreatmentCaseClosed(activePlan)) &&
      !forceNewPlan
    ) {
      setMessage({
        type: "error",
        text: "تم إكمال العلاج — الحالة مغلقة. فعّل «حالة علاج جديدة» لبدء سعر كلي جديد.",
      });
      setLoading(false);
      return;
    }

    let casePrice = 0;
    if (entryMode === "plan") {
      casePrice = parseAmount(totalAmount);
      if (casePrice <= 0) {
        setMessage({
          type: "error",
          text: "أول جلسة: أدخل السعر الكلي للحالة (مثلاً 150,000)",
        });
        setLoading(false);
        return;
      }
      if (discount < 0 || discount >= casePrice) {
        setMessage({
          type: "error",
          text: "الخصم يجب أن يكون أقل من السعر الكلي",
        });
        setLoading(false);
        return;
      }
    } else {
      if (!hasTreatmentPlan(activePlan)) {
        setMessage({
          type: "error",
          text: "لا توجد خطة علاج — سجّل أول جلسة بالسعر الكلي أولاً",
        });
        setLoading(false);
        return;
      }
      if (discount > 0) {
        setMessage({
          type: "error",
          text: "الخصم الأولي يُسجّل في أول جلسة فقط",
        });
        setLoading(false);
        return;
      }
      if (paid <= 0 && additionalDiscount <= 0) {
        setMessage({
          type: "error",
          text: "أدخل المبلغ المدفوع أو خصماً إضافياً",
        });
        setLoading(false);
        return;
      }
      if (additionalDiscount > 0) {
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
    }

    const operationLabel =
      pickedCase?.treatment_name_ar?.trim() ||
      operationName.trim();

    if (isReviewStatement && !reviewFeeEnabled) {
      setMessage({
        type: "error",
        text: "فعّل كشفية المراجع من الإعدادات وحدد المبلغ أولاً",
      });
      setLoading(false);
      return;
    }
    if (isReviewStatement && reviewFeeEnabled && clinicReviewFeeAmount <= 0) {
      setMessage({
        type: "error",
        text: "حدد مبلغ الكشفية في إعدادات العيادة",
      });
      setLoading(false);
      return;
    }

    const optionalCols: Record<string, unknown> = {};
    if (notes.trim()) optionalCols.notes = notes.trim();
    if (isReviewStatement) {
      optionalCols.is_review_statement = true;
      if (reviewFeeLive > 0) optionalCols.review_fee_amount = reviewFeeLive;
    }
    if (entryMode !== "plan") {
      const persistedCaseId = resolvePersistedCaseId(
        treatmentCases,
        selectedCaseId
      );
      if (persistedCaseId && isPersistedTreatmentCaseId(persistedCaseId)) {
        optionalCols.treatment_case_id = persistedCaseId;
      }
    }

    let sessionDoctorId = doctorId;
    const caseIdForDoctor =
      resolvePersistedCaseId(treatmentCases, selectedCaseId) ??
      (defaultCaseId && isPersistedTreatmentCaseId(defaultCaseId)
        ? defaultCaseId
        : null);
    if (caseIdForDoctor) {
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
        { key: "operation_type", val: opLabel },
        { key: "operation_name_ar", val: opLabel },
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
          err = result.error;
          continue;
        }
        return { op: null, error: result.error };
      }
      return { op, error: err };
    };

    let op: PatientOperation | null = null;
    let error: { message: string } | null = null;

    if (!error && entryMode === "payment" && additionalDiscount > 0) {
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

    let savedCaseIdForWa: string | null = null;

    if (!error && entryMode === "plan") {
      const treatmentFinal = computeFinalPrice(casePrice, discount);
      const split = previewTreatmentSplitWithReview(
        treatmentFinal,
        reviewFeeLive,
        materials,
        selectedDoctor
      );

      let newCaseId: string | undefined;
      const created = await createTreatmentCaseViaApi({
        patientId: patientId!,
        treatmentName: operationLabel,
        casePrice,
        discount,
        paid,
        doctorShare: split?.doctorShare ?? 0,
        clinicShare: split?.clinicShare ?? 0,
        doctorId,
      });
      if (created.case) {
        newCaseId = created.case.id;
        savedCaseIdForWa = created.case.id;
        setSelectedCaseId(created.case.id);
        optionalCols.treatment_case_id = created.case.id;
      } else {
        setMessage({
          type: "error",
          text: `تعذر إنشاء حالة العلاج الجديدة: ${created.error ?? "خطأ غير معروف"}`,
        });
        setLoading(false);
        return;
      }

      const planCols: Record<string, unknown> = {
        total_amount: casePrice,
        discount_amount: discount,
        paid_amount: paid,
        materials_cost: materials,
      };
      if (newCaseId) optionalCols.treatment_case_id = newCaseId;

      const res = await insertSession("plan", planCols);
      op = res.op;
      error = res.error;

      if (error) {
        const fb = await saveFirstSessionPlanFallback(
          supabase,
          patientId!,
          activeClinic.clinicId,
          casePrice,
          discount,
          paid,
          split?.doctorShare ?? 0,
          split?.clinicShare ?? 0
        );
        if (fb.ok) {
          error = null;
          if (paid > 0) {
            const payRes = await insertSession("payment", {
              total_amount: 0,
              paid_amount: paid,
            });
            op = payRes.op;
            error = payRes.error;
          }
        }
      }
    } else if (!error && entryMode === "payment" && paid > 0) {
      const res = await insertSession("payment", {
        total_amount: 0,
        paid_amount: paid,
      });
      op = res.op;
      error = res.error;
    }

    if (!error && !op?.id) {
      error = {
        message:
          "تعذر حفظ الجلسة في قاعدة البيانات — تحقق من صلاحيات الحساب أو أعد تشغيل الصفحة",
      };
    }

    const persistedCaseIdForLink =
      entryMode !== "plan"
        ? resolvePersistedCaseId(treatmentCases, selectedCaseId)
        : null;
    let linkedCaseId = savedCaseIdForWa ?? persistedCaseIdForLink;
    if (!error && op?.id) {
      if (!linkedCaseId) {
        const resolved = await resolveCaseIdForOp(supabase, op);
        linkedCaseId = resolved.caseId;
      }
      if (linkedCaseId && isPersistedTreatmentCaseId(linkedCaseId)) {
        await linkOperationToTreatmentCase(supabase, op.id, linkedCaseId);
        const isNewPlanCase =
          entryMode === "plan" && Boolean(savedCaseIdForWa);
        if (!isNewPlanCase) {
          await linkUnlinkedCaseOperations(
            supabase,
            linkedCaseId,
            patientId!,
            pickedCase?.treatment_name_ar ?? operationLabel
          );
        }
      }
    }

    let syncWarning = "";
    if (
      !error &&
      entryMode === "payment" &&
      hasTreatmentPlan(activePlan) &&
      (paid > 0 || additionalDiscount > 0)
    ) {
      const sync = await syncTreatmentCaseAfterSessionViaApi({
        patientId: patientId!,
        treatmentName: pickedCase?.treatment_name_ar ?? operationLabel,
        plan: activePlan,
        paidDelta: paid,
        additionalDiscount,
        caseId:
          (linkedCaseId && isPersistedTreatmentCaseId(linkedCaseId)
            ? linkedCaseId
            : null) ??
          (activeCaseId && isPersistedTreatmentCaseId(activeCaseId)
            ? activeCaseId
            : null),
      });
      if (!sync.ok) {
        syncWarning = ` — تحذير: ${sync.error ?? "تعذر تحديث ذمة الحالة"}`;
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

    await assignPrimaryDoctorForSession(supabase, {
      patientId: patientId!,
      doctorId: sessionDoctorId,
      caseId:
        linkedCaseId && isPersistedTreatmentCaseId(linkedCaseId)
          ? linkedCaseId
          : savedCaseIdForWa && isPersistedTreatmentCaseId(savedCaseIdForWa)
            ? savedCaseIdForWa
            : null,
    });

    setSelectedPatientId(patientId!);

    const refreshedCases = await fetchPatientTreatmentCases(
      supabase,
      patientId!,
      activeClinic.clinicId
    );
    setTreatmentCases(refreshedCases);
    onTreatmentCasesChanged?.(refreshedCases);
    const waCaseId =
      savedCaseIdForWa && isPersistedTreatmentCaseId(savedCaseIdForWa)
        ? savedCaseIdForWa
        : linkedCaseId && isPersistedTreatmentCaseId(linkedCaseId)
          ? linkedCaseId
          : activeCaseId && isPersistedTreatmentCaseId(activeCaseId)
            ? activeCaseId
            : selectedCaseId;
    const updatedCase = waCaseId
      ? refreshedCases.find((c) => c.id === waCaseId) ?? null
      : null;
    if (updatedCase) {
      setFinancialPlan(caseToFinancialPlan(updatedCase));
      setSelectedCaseId(updatedCase.id);
    } else {
      const updatedPlan = await fetchPatientFinancialPlan(supabase, patientId!);
      setFinancialPlan(updatedPlan);
    }
    const planFinalForWa =
      entryMode === "plan" && casePrice > 0
        ? computeFinalPrice(casePrice, discount)
        : 0;
    const snap = updatedCase
      ? caseToFinancialPlan(updatedCase)
      : planFinalForWa > 0
        ? {
            ...EMPTY_FINANCIAL_PLAN,
            final_price: planFinalForWa,
            total_paid: paid,
            remaining_balance: Math.max(0, planFinalForWa - paid),
          }
        : financialPlan ?? EMPTY_FINANCIAL_PLAN;

    const justCompleted =
      planFinalForWa > 0
        ? paid >= planFinalForWa - FINANCIAL_EPSILON
        : hasTreatmentPlan(snap) &&
          snap.final_price > FINANCIAL_EPSILON &&
          snap.total_paid > FINANCIAL_EPSILON &&
          Math.max(0, snap.final_price - snap.total_paid) <= FINANCIAL_EPSILON;

    setForceNewPlan(false);

    const treatmentCaseIdForWa =
      savedCaseIdForWa && isPersistedTreatmentCaseId(savedCaseIdForWa)
        ? savedCaseIdForWa
        : resolvePersistedCaseId(refreshedCases, linkedCaseId) ??
          resolvePersistedCaseId(refreshedCases, activeCaseId) ??
          resolvePersistedCaseId(refreshedCases, updatedCase?.id) ??
          resolvePersistedCaseId(refreshedCases, selectedCaseId) ??
          (linkedCaseId && isPersistedTreatmentCaseId(linkedCaseId)
            ? linkedCaseId
            : null);

    let messageSnapshot:
      | {
          remainingBalance: number;
          sessionNumber: number;
          totalSessionsInCase: number;
          procedureLabel: string;
          paidThisSession: number;
          caseFinalPrice: number;
          caseTotalPaid: number;
        }
      | undefined;

    const waProcedureLabel =
      updatedCase?.treatment_name_ar ??
      pickedCase?.treatment_name_ar ??
      operationLabel;
    const waFinancial = updatedCase
      ? caseToFinancialPlan(updatedCase)
      : hasTreatmentPlan(snap)
        ? snap
        : null;

    if (waProcedureLabel.trim()) {
      const useFormTotals = planFinalForWa > 0 || entryMode === "plan";
      const finalP = useFormTotals
        ? planFinalForWa > 0
          ? planFinalForWa
          : computeFinalPrice(casePrice, discount)
        : waFinancial?.final_price ?? 0;
      const totalPaidCase = useFormTotals
        ? paid
        : waFinancial?.total_paid ?? paid;
      const remaining =
        finalP > 0
          ? Math.max(0, finalP - totalPaidCase)
          : waFinancial?.remaining_balance ?? 0;
      if (finalP > 0 || remaining > 0 || paid > 0) {
        messageSnapshot = {
          remainingBalance: remaining,
          sessionNumber: entryMode === "plan" ? 1 : 0,
          totalSessionsInCase: entryMode === "plan" ? 1 : 0,
          procedureLabel: waProcedureLabel.trim(),
          paidThisSession: paid,
          caseFinalPrice: finalP,
          caseTotalPaid: totalPaidCase,
        };
      }
    }

    let whatsappNote = "";
    let clinicalWarning = "";
    if (operationIdForNotify) {
      const hasClinical =
        clinical.xrayFiles.length > 0 ||
        Object.keys(clinical.teeth).length > 0;
      if (hasClinical) {
        const clinicalRes = await saveSessionClinicalRecords(
          operationIdForNotify,
          clinical
        );
        if (!clinicalRes.ok) {
          clinicalWarning = ` — تحذير (مخطط/أشعة): ${clinicalRes.error ?? "تعذر الحفظ"}`;
        }
      }

      // تأكد من حفظ الملاحظات قبل إرسال واتساب
      if (notes.trim()) {
        await supabase
          .from("patient_operations")
          .update({ notes: notes.trim() })
          .eq("id", operationIdForNotify);
      }

      try {
        const waRes = await fetch("/api/automation/dispatch", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            event: "session_saved",
            operationId: operationIdForNotify,
            treatmentCompleted: justCompleted,
            treatmentCaseId:
              treatmentCaseIdForWa ??
              (linkedCaseId && isPersistedTreatmentCaseId(linkedCaseId)
                ? linkedCaseId
                : null),
            messageSnapshot,
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
        } else if (wa?.sent) {
          whatsappNote = justCompleted
            ? " — تم إرسال واتساب: *اكتمال العلاج* ✓"
            : " — تم إرسال واتساب للمراجع (هذه الجلسة) ✓";
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
    }

    let successText: string;
    if (justCompleted) {
      successText = `✓ تم إكمال العلاج — «${operationLabel}» — تسوية كاملة ولا ذمة متبقية.`;
    } else if (entryMode === "plan") {
      successText = `✓ حالة جديدة «${operationLabel}»: السعر الكلي ${formatCurrency(snap.case_price)}`;
      if (snap.discount_total > 0) {
        successText += ` — خصم ${formatCurrency(snap.discount_total)}`;
      }
      successText += ` — المتبقي ${formatCurrency(snap.remaining_balance)}`;
    } else {
      const parts: string[] = [`«${operationLabel}»`];
      if (additionalDiscount > 0) {
        parts.push(`خصم إضافي ${formatCurrency(additionalDiscount)}`);
      }
      if (paid > 0) parts.push(`دفعة ${formatCurrency(paid)}`);
      successText = `✓ ${parts.join(" — ")} — الذمة ${formatCurrency(snap.remaining_balance)}`;
    }
    setMessage({
      type: "success",
      text: successText + whatsappNote + syncWarning + clinicalWarning,
    });

    setOperationName("");
    setTotalAmount("");
    setPaidAmount("");
    setDiscountAmount("");
    setAdditionalDiscountAmount("");
    setMaterialsCost("");
    setNotes("");
    resetClinical();
    notifySessionMutation({
      clinicId: activeClinic.clinicId,
      doctorId,
      patientId: patientId ?? undefined,
    });
    if (paid > 0) {
      notifyClinicProfitRefresh(activeClinic.clinicId);
    }

    if (paid > 0 && op) {
      setPendingSuccessOp(op);
      const finalP =
        snap.final_price > 0
          ? snap.final_price
          : planFinalForWa > 0
            ? planFinalForWa
            : Number(op.total_amount) || paid;
      const totalPaidCase =
        snap.total_paid > FINANCIAL_EPSILON
          ? snap.total_paid
          : messageSnapshot?.caseTotalPaid ?? paid;
      const remainingBal =
        messageSnapshot?.remainingBalance ??
        (finalP > 0 ? Math.max(0, finalP - totalPaidCase) : opDebt(op));

      setInvoiceData(
        buildSessionInvoiceData({
          operation: op,
          clinic: clinicProfile ?? null,
          patientName:
            patientQuery.trim() || defaultPatientName?.trim() || "مراجع",
          patientPhone:
            patientPhone.trim() || defaultPatientPhone?.trim() || null,
          doctorName:
            selectedDoctor?.full_name_ar?.trim() ||
            lockDoctorName?.trim() ||
            "—",
          procedureLabel: waProcedureLabel.trim() || operationLabel,
          treatmentName:
            updatedCase?.treatment_name_ar ??
            pickedCase?.treatment_name_ar ??
            operationLabel,
          paidThisSession: paid,
          caseTotalAmount: finalP,
          caseTotalPaid: totalPaidCase,
          remainingBalance: remainingBal,
          treatmentCompleted: justCompleted,
          sessionNumber: messageSnapshot?.sessionNumber,
          totalSessionsInCase: messageSnapshot?.totalSessionsInCase,
          notes: notes.trim() || null,
        })
      );
    } else {
      onSuccess?.(op!);
    }

    } catch (err) {
      console.error("[QuickEntryForm] handleSubmit", err);
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
          <CardTitle>
            {loadingPlan && selectedPatientId
              ? "جاري تحميل ملف المريض..."
              : showCasePicker
                ? "اختر حالة العلاج"
                : isFollowUpSession
                  ? `متابعة: ${selectedCase?.treatment_name_ar ?? "حالة"}`
                  : "حالة علاج جديدة"}
          </CardTitle>
          {isFollowUpSession && !loadingPlan && (
            <p className="text-sm text-slate-muted mt-1">
              السعر والخصم من قاعدة البيانات — أدخل المبلغ المدفوع والملاحظات
            </p>
          )}
        </CardHeader>
      )}

      <form
        noValidate
        onSubmit={handleSubmit}
        className={`grid gap-4 sm:grid-cols-2 ${embedded ? "px-0" : ""}`}
      >

        {isCaseClosed && (
          <div className="sm:col-span-2 space-y-3">
            <Alert variant="success">
              تم إكمال العلاج — الحالة «
              {selectedCase?.treatment_name_ar ?? "المختارة"}» مغلقة (لا دين). لبدء
              نفس نوع العلاج بسعر جديد اضغط الزر أدناه.
            </Alert>
            <Button
              type="button"
              variant="outline"
              className="w-full sm:w-auto"
              onClick={() =>
                beginNewTreatmentCase(selectedCase?.treatment_name_ar)
              }
            >
              + إجمالي كلي جديد — حالة علاج جديدة
            </Button>
          </div>
        )}

        {forceNewPlan && !showCasePicker && (
          <div className="sm:col-span-2 rounded-lg border border-primary/30 bg-primary/5 px-4 py-3">
            <p className="text-sm font-semibold text-primary">
              حالة علاج جديدة — أدخل السعر الكلي والمبلغ المدفوع في هذه الجلسة
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

        {message && (
          <div className="sm:col-span-2">
            <Alert variant={message.type === "success" ? "success" : "error"}>
              {message.text}
            </Alert>
          </div>
        )}

        {formSchema.showPatientSearch && (
        <div className="sm:col-span-2">
          <label className="mb-1 block text-sm font-medium text-slate-text">
            المريض{" "}
            {selectedPatientId && (
              <span className="text-xs text-primary">← مريض موجود محدد</span>
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
            <label className="mb-1 block text-sm font-medium text-slate-text">
              رقم هاتف المراجع <span className="text-debt-text">*</span>
            </label>
            <input
              type="tel"
              dir="ltr"
              required
              className="w-full rounded-lg border border-slate-border bg-surface px-3 py-2 text-sm text-slate-text outline-none focus:border-primary focus:ring-1 focus:ring-primary"
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
            <label className="mb-1 block text-sm font-medium text-slate-text">
              رقم واتساب المراجع{" "}
              <span className="text-debt-text">*</span>
              <span className="font-normal text-slate-muted">
                {" "}
                (للإشعار التلقائي بعد الجلسة)
              </span>
            </label>
            <input
              type="tel"
              dir="ltr"
              required={phoneInputRequired}
              className="w-full rounded-lg border border-slate-border bg-surface px-3 py-2 text-sm text-slate-text outline-none focus:border-primary focus:ring-1 focus:ring-primary"
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
          <div className="sm:col-span-2 flex flex-wrap items-center justify-between gap-2 rounded-lg border border-primary/30 bg-primary/5 px-4 py-3">
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
          <div className="sm:col-span-2 rounded-xl border border-primary/30 bg-primary/5 px-4 py-3">
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
              <div className="sm:col-span-2 rounded-xl border border-amber-200 bg-amber-50 px-4 py-2 text-sm text-amber-900">
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
            />
          </>
        )}
        </>
        )}

        {formSchema.showPlanSummary && plan.final_price > 0 && (
          <div className="sm:col-span-2 rounded-xl border border-primary/20 bg-primary/5 p-4 text-sm space-y-1">
            <p className="font-semibold text-slate-text">
              من أول جلسة (محفوظ): السعر الكلي {formatCurrency(plan.case_price)}
            </p>
            {plan.discount_total > 0 && (
              <p className="text-slate-muted">
                خصم مسجّل: {formatCurrency(plan.discount_total)}
              </p>
            )}
            <p className="font-medium text-primary">
              السعر النهائي: {formatCurrency(plan.final_price)}
            </p>
            <p className="text-xs tabular-nums text-slate-muted">
              مدفوع: {formatCurrency(plan.total_paid)}
            </p>
            {(additionalDiscountNum > 0 || paid > 0) && (
              <p className="text-xs tabular-nums mt-2 text-primary font-medium">
                بعد هذا الإدخال — السعر النهائي: {formatCurrency(finalPriceLive)}
                {" · "}الذمة:{" "}
                <span className="text-debt-text font-bold">
                  {formatCurrency(remaining)}
                </span>
              </p>
            )}
            {additionalDiscountNum <= 0 && paid <= 0 && (
              <p className="text-xs tabular-nums mt-1 text-slate-muted">
                الذمة الحالية:{" "}
                <span className="font-semibold text-debt-text">
                  {formatCurrency(plan.remaining_balance)}
                </span>
              </p>
            )}
          </div>
        )}

        {formSchema.showOperation && (
        <div className={isFollowUpSession ? "sm:col-span-2" : ""}>
          <label className="mb-1 block text-sm font-medium text-slate-text">
            نوع الإجراء *
          </label>
          <input
            list={listId}
            type="text"
            className="w-full rounded-lg border border-slate-border bg-surface px-3 py-2 text-sm text-slate-text outline-none focus:border-primary focus:ring-1 focus:ring-primary"
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

        {formSchema.showCasePrice && (
          <>
            <CurrencyInput
              label="السعر الكلي للحالة *"
              value={totalAmount}
              onChange={setTotalAmount}
              placeholder="150,000"
              required
            />
            {formSchema.showInitialDiscount && (
              <CurrencyInput
                label="الخصم (اختياري)"
                value={discountAmount}
                onChange={setDiscountAmount}
                placeholder="0"
              />
            )}
            <div className="sm:col-span-2 rounded-lg border border-emerald-200 bg-emerald-50/80 px-4 py-3">
              <p className="text-sm text-emerald-900">
                السعر النهائي بعد الخصم:{" "}
                <span className="text-lg font-bold tabular-nums">
                  {formatCurrency(finalPriceLive)}
                </span>
              </p>
              {discountNum > 0 && (
                <p className="text-xs text-emerald-800 mt-1 tabular-nums">
                  {formatCurrency(casePriceNum)} − {formatCurrency(discountNum)} ={" "}
                  {formatCurrency(finalPriceLive)}
                </p>
              )}
            </div>
          </>
        )}

        {formSchema.showMaterials && (
            <CurrencyInput
              label="تكلفة المواد / المعمل"
              value={materialsCost}
              onChange={setMaterialsCost}
              placeholder="0"
            />
        )}

        {formSchema.showPaidAmount && (
        <div className={isFollowUpSession ? "sm:col-span-2 space-y-2" : undefined}>
          <CurrencyInput
            label={isFollowUpSession ? "المبلغ المدفوع *" : "المبلغ المدفوع"}
            value={paidAmount}
            onChange={setPaidAmount}
            placeholder="50,000"
            required={isFollowUpSession && additionalDiscountNum <= 0}
          />
          {isFollowUpSession && remaining > 0 && !isCaseClosed && (
            <button
              type="button"
              className="w-full rounded-lg border-2 border-primary bg-primary/10 px-3 py-2 text-sm font-semibold text-primary hover:bg-primary/15"
              onClick={() =>
                setPaidAmount(String(Math.round(remaining)))
              }
            >
              دفع الذمة كاملة ({formatCurrency(remaining)})
            </button>
          )}
        </div>
        )}

        {formSchema.showAdditionalDiscount && (
          <div className="sm:col-span-2 space-y-1">
            <CurrencyInput
              label="خصم إضافي (اختياري)"
              value={additionalDiscountAmount}
              onChange={setAdditionalDiscountAmount}
              placeholder="0"
            />
            {additionalDiscountNum > 0 && (
              <p className="text-xs text-amber-800 tabular-nums">
                يُخصم {formatCurrency(additionalDiscountNum)} من الذمة — السعر النهائي:{" "}
                {formatCurrency(finalPriceLive)} — المتبقي: {formatCurrency(remaining)}
              </p>
            )}
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

        {formSchema.showReviewCheckbox && (
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

        {formSchema.showClinicalRecord && (
        <SessionClinicalRecord
          value={clinical}
          onChange={setClinical}
          disabled={loading}
          chartResetKey={clinicalResetKey}
        />
        )}

        {formSchema.showNotes && (
        <div className="sm:col-span-2">
          <label className="mb-1 block text-sm font-medium text-slate-text">
            ملاحظات
          </label>
          <textarea
            className="w-full rounded-lg border border-slate-border bg-surface px-3 py-2 text-sm text-slate-text outline-none focus:border-primary focus:ring-1 focus:ring-primary resize-none"
            rows={3}
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            placeholder="ملاحظات الجلسة..."
          />
        </div>
        )}

        {formSchema.showFinancialPreview && (
        <FinancialPreview
          className="sm:col-span-2"
          totalAmount={Math.max(0, finalPriceLive - reviewFeeLive)}
          materialsCost={materials}
          doctor={selectedDoctor}
          reviewFee={reviewFeeLive}
          lockedSplit={lockedSplit}
          isPaymentSession={false}
        />
        )}

        <div className="sm:col-span-2 rounded-lg border border-slate-border bg-surface p-4">
          <p className="text-sm text-slate-muted">
            {isFollowUpSession
              ? "الذمة المالية (بعد الخصم الإضافي والدفعة)"
              : "المتبقي على المريض (ذمة)"}
          </p>
          {isFollowUpSession && (
            <p className="text-[11px] text-slate-muted mt-0.5 tabular-nums">
              السعر النهائي: {formatCurrency(finalPriceLive)} = السعر الكلي − الخصومات
            </p>
          )}
          <p
            className={`text-2xl font-bold tabular-nums ${
              remaining > 0 ? "text-debt-text" : "text-primary"
            }`}
          >
            {formatCurrency(remaining)}
          </p>
          {isCaseFullySettled(plan, {
            additionalDiscount: additionalDiscountNum,
            newPayment: paid,
          }) &&
            finalPriceLive > 0 && (
            <p className="text-xs font-semibold text-emerald-700 mt-1">
              ✓ بعد الحفظ: تم إكمال العلاج — لا ذمة متبقية على هذه الحالة
            </p>
          )}
        </div>

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
          onClose={() => {
            setInvoiceData(null);
            if (pendingSuccessOp) {
              onSuccess?.(pendingSuccessOp);
              setPendingSuccessOp(null);
            }
          }}
        />
      )}
    </Card>
  );
}
