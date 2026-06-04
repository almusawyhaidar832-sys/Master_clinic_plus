"use client";

import { useState, useEffect, useRef } from "react";
import { Button } from "@/components/ui/Button";
import { CurrencyInput } from "@/components/ui/CurrencyInput";
import { Select } from "@/components/ui/Select";
import { Card, CardHeader, CardTitle } from "@/components/ui/Card";
import { Alert } from "@/components/ui/Alert";
import { formatCurrency, todayISO } from "@/lib/utils";
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
  createTreatmentCase,
  fetchPatientTreatmentCases,
  syncTreatmentCaseAfterSession,
  type PatientTreatmentCase,
} from "@/lib/services/patient-treatment-cases";
import { fetchPatientPrimaryDoctor } from "@/lib/services/patient-primary-doctor";
import { TreatmentCasePicker } from "@/components/accountant/TreatmentCasePicker";
import type { Doctor, Patient, PatientOperation } from "@/types";
import {
  getPatientDisplayPhone,
  patientPhoneColumns,
  validatePatientPhone,
} from "@/lib/phone";

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

interface QuickEntryFormProps {
  /** Pre-selected patient (used from patient file page) */
  defaultPatientId?: string;
  defaultPatientName?: string;
  /** Lock doctor (doctor portal session entry) */
  lockDoctorId?: string;
  onSuccess?: (operation: PatientOperation) => void;
}

export function QuickEntryForm({
  defaultPatientId,
  defaultPatientName,
  lockDoctorId,
  onSuccess,
}: QuickEntryFormProps) {
  const listId = "dental-suggestions";

  // Patient search state
  const [patientQuery, setPatientQuery] = useState(defaultPatientName ?? "");
  const [patientPhone, setPatientPhone] = useState("");
  const [patientSuggestions, setPatientSuggestions] = useState<Patient[]>([]);
  const [selectedPatientId, setSelectedPatientId] = useState<string | null>(
    defaultPatientId ?? null
  );
  const [showSuggestions, setShowSuggestions] = useState(false);
  const suggestionsRef = useRef<HTMLDivElement>(null);

  // Form fields
  const [doctorId, setDoctorId] = useState(lockDoctorId ?? "");
  const [clinical, setClinical] = useState<SessionClinicalDraft>(EMPTY_CLINICAL_DRAFT);
  const [operationName, setOperationName] = useState("");
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
    useState<PatientFinancialPlan | null>(null);
  const [loadingPlan, setLoadingPlan] = useState(!!defaultPatientId);
  const [forceNewPlan, setForceNewPlan] = useState(false);
  const [treatmentCases, setTreatmentCases] = useState<PatientTreatmentCase[]>([]);
  const [selectedCaseId, setSelectedCaseId] = useState<string | null>(null);
  const [assignedDoctor, setAssignedDoctor] = useState<{
    id: string;
    full_name_ar: string;
  } | null>(null);

  const emptyPlan: PatientFinancialPlan = {
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

  const plan = financialPlan ?? emptyPlan;
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
    isFollowUpSession &&
    (selectedCase
      ? isTreatmentCaseComplete(caseToFinancialPlan(selectedCase))
      : isTreatmentCaseClosed(plan));

  const casePriceNum = parseFloat(totalAmount) || 0;
  const discountNum = parseFloat(discountAmount) || 0;
  const additionalDiscountNum = parseFloat(additionalDiscountAmount) || 0;
  const paid = parseFloat(paidAmount) || 0;
  const materials = parseFloat(materialsCost) || 0;

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
      const [docRes, clinicRes] = await Promise.all([
        supabase
          .from("doctors")
          .select("*")
          .eq("is_active", true)
          .order("full_name_ar"),
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
      if (lockDoctorId) setDoctorId(lockDoctorId);
    }
    load();
  }, [lockDoctorId]);

  // Patient search autocomplete
  useEffect(() => {
    if (selectedPatientId) return; // already selected
    const q = patientQuery.trim();
    if (q.length < 2) {
      setPatientSuggestions([]);
      return;
    }
    const timeout = setTimeout(async () => {
      const supabase = createClient();
      const { data } = await supabase
        .from("patients")
        .select("id, full_name_ar, phone, phone_number")
        .ilike("full_name_ar", `%${q}%`)
        .limit(8);
      const rows = (data as Patient[]) || [];
      setPatientSuggestions(rows);
      if (rows.length === 1 && rows[0].full_name_ar === q) {
        setSelectedPatientId(rows[0].id);
        setShowSuggestions(false);
      } else {
        setShowSuggestions(true);
      }
    }, 300);
    return () => clearTimeout(timeout);
  }, [patientQuery, selectedPatientId]);

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
        return;
      }
      setLoadingPlan(true);
      const supabase = createClient();
      if (!lockDoctorId) {
        const primaryDoc = await fetchPatientPrimaryDoctor(
          supabase,
          selectedPatientId
        );
        if (cancelled) return;
        setAssignedDoctor(primaryDoc);
        if (primaryDoc) setDoctorId(primaryDoc.id);
      }
      const clinic = await getActiveClinicId(supabase);
      const cases = await fetchPatientTreatmentCases(
        supabase,
        selectedPatientId,
        clinic?.clinicId
      );
      if (cancelled) return;

      setTreatmentCases(cases);

      if (forceNewPlan) {
        setFinancialPlan(emptyPlan);
        setSelectedCaseId(null);
        setLoadingPlan(false);
        return;
      }

      if (cases.length > 0) {
        setSelectedCaseId(null);
        setFinancialPlan(emptyPlan);
      } else {
        setSelectedCaseId(null);
        const legacy = await fetchPatientFinancialPlan(supabase, selectedPatientId);
        setFinancialPlan(legacy);
      }
      setLoadingPlan(false);
    }
    loadCases();
    return () => {
      cancelled = true;
    };
  }, [selectedPatientId, forceNewPlan]);

  useEffect(() => {
    if (isFollowUpSession) {
      setTotalAmount("");
      setDiscountAmount("");
      setAdditionalDiscountAmount("");
      setMaterialsCost("");
    }
  }, [isFollowUpSession, selectedCaseId]);

  useEffect(() => {
    setClinical(EMPTY_CLINICAL_DRAFT);
  }, [selectedPatientId, selectedCaseId, forceNewPlan]);

  // Close suggestions on outside click
  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (
        suggestionsRef.current &&
        !suggestionsRef.current.contains(e.target as Node)
      ) {
        setShowSuggestions(false);
      }
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, []);

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
    const supabase = createClient();
    const activeClinic = await getActiveClinicId(supabase);
    if (!activeClinic) {
      setMessage({ type: "error", text: "لا توجد عيادة في قاعدة البيانات." });
      setLoading(false);
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

    const pickedCase = treatmentCases.find((c) => c.id === selectedCaseId);
    let activePlan = pickedCase
      ? caseToFinancialPlan(pickedCase)
      : await fetchPatientFinancialPlan(supabase, patientId);
    const discount = parseFloat(discountAmount) || 0;
    const additionalDiscount = parseFloat(additionalDiscountAmount) || 0;
    const entryMode =
      forceNewPlan || !selectedCaseId ? "plan" : "payment";

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
      casePrice = parseFloat(totalAmount) || 0;
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
    if (selectedCaseId && !selectedCaseId.startsWith("inferred-")) {
      optionalCols.treatment_case_id = selectedCaseId;
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
        doctor_id: doctorId,
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

        if (!result.error) {
          return { op: result.data as PatientOperation, error: null };
        }

        const msg = result.error.message;
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
          if (!retry.error) {
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

    if (!error && entryMode === "plan") {
      const treatmentFinal = computeFinalPrice(casePrice, discount);
      const split = previewTreatmentSplitWithReview(
        treatmentFinal,
        reviewFeeLive,
        materials,
        selectedDoctor
      );

      let newCaseId: string | undefined;
      const created = await createTreatmentCase(supabase, {
        patientId: patientId!,
        clinicId: activeClinic.clinicId,
        treatmentName: operationLabel,
        casePrice,
        discount,
        paid,
        doctorShare: split?.doctorShare ?? 0,
        clinicShare: split?.clinicShare ?? 0,
      });
      if (created.case) {
        newCaseId = created.case.id;
        setSelectedCaseId(created.case.id);
      } else if (created.error && !created.error.includes("patient_treatment_cases")) {
        console.warn("[QuickEntryForm] createTreatmentCase:", created.error);
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

    if (
      !error &&
      entryMode === "payment" &&
      hasTreatmentPlan(activePlan) &&
      (paid > 0 || additionalDiscount > 0)
    ) {
      await syncTreatmentCaseAfterSession(supabase, {
        patientId: patientId!,
        clinicId: activeClinic.clinicId,
        treatmentName: operationLabel,
        plan: activePlan,
        paidDelta: paid,
        additionalDiscount,
      });
    }

    setLoading(false);

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

    if (op?.id) {
      const hasClinical =
        clinical.xrayFiles.length > 0 ||
        Object.keys(clinical.teeth).length > 0;
      if (hasClinical) {
        const clinicalRes = await saveSessionClinicalRecords(op.id, clinical);
        if (!clinicalRes.ok) {
          setMessage({
            type: "error",
            text: `تم حفظ الجلسة لكن: ${clinicalRes.error}`,
          });
          return;
        }
      }

    }

    setSelectedPatientId(patientId!);

    const refreshedCases = await fetchPatientTreatmentCases(
      supabase,
      patientId!,
      activeClinic.clinicId
    );
    setTreatmentCases(refreshedCases);
    const updatedCase = selectedCaseId
      ? refreshedCases.find((c) => c.id === selectedCaseId)
      : refreshedCases.find((c) => c.treatment_name_ar === operationLabel);
    if (updatedCase) {
      setFinancialPlan(caseToFinancialPlan(updatedCase));
      setSelectedCaseId(updatedCase.id);
    } else {
      const updatedPlan = await fetchPatientFinancialPlan(supabase, patientId!);
      setFinancialPlan(updatedPlan);
    }
    setForceNewPlan(false);

    const snap = updatedCase
      ? caseToFinancialPlan(updatedCase)
      : financialPlan ?? emptyPlan;

    const justCompleted = isTreatmentCaseComplete(snap);

    if (op?.id) {
      await fetch("/api/automation/dispatch", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          event: "session_saved",
          operationId: op.id,
          treatmentCompleted: justCompleted,
        }),
      });
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
    setMessage({ type: "success", text: successText });

    setOperationName("");
    setTotalAmount("");
    setPaidAmount("");
    setDiscountAmount("");
    setAdditionalDiscountAmount("");
    setMaterialsCost("");
    setNotes("");
    setClinical(EMPTY_CLINICAL_DRAFT);
    onSuccess?.(op as PatientOperation);

  }

  return (
    <Card>
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
            السعر والخصم من قاعدة البيانات — أدخل الإجراء والمبلغ المدفوع والملاحظات
          </p>
        )}
      </CardHeader>

      <form onSubmit={handleSubmit} className="grid gap-4 sm:grid-cols-2">

        {isCaseClosed && (
          <div className="sm:col-span-2">
            <Alert variant="success">
              تم إكمال العلاج — الحالة مغلقة (لا دين). لبدء حالة جديدة فعّل «إجمالي
              كلي جديد» أدناه.
            </Alert>
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
        <div className="sm:col-span-2 relative" ref={suggestionsRef}>
          <label className="mb-1 block text-sm font-medium text-slate-text">
            المريض{" "}
            {selectedPatientId && (
              <span className="text-xs text-primary">← مريض موجود محدد</span>
            )}
          </label>
          <div className="flex gap-2">
            <input
              type="text"
              className="w-full rounded-lg border border-slate-border bg-surface px-3 py-2 text-sm text-slate-text outline-none focus:border-primary focus:ring-1 focus:ring-primary"
              value={patientQuery}
              onChange={(e) => {
                setPatientQuery(e.target.value);
                setSelectedPatientId(null);
                setPatientPhone("");
              }}
              onFocus={() => patientSuggestions.length > 0 && setShowSuggestions(true)}
              placeholder={
                isFollowUpSession
                  ? "ابحث عن اسم المريض..."
                  : "اسم المريض — جديد أو موجود"
              }
              required
              disabled={!!defaultPatientId}
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

          {showSuggestions && patientSuggestions.length > 0 && !defaultPatientId && (
            <div className="absolute z-50 mt-1 w-full rounded-lg border border-slate-border bg-white shadow-premium">
              {patientSuggestions.map((p) => (
                <button
                  key={p.id}
                  type="button"
                  className="flex w-full items-center gap-2 px-4 py-2 text-sm hover:bg-primary/5 text-right"
                  onClick={() => {
                    setSelectedPatientId(p.id);
                    setPatientQuery(p.full_name_ar);
                    setPatientPhone(getPatientDisplayPhone(p) ?? "");
                    setShowSuggestions(false);
                  }}
                >
                  <span className="font-medium">{p.full_name_ar}</span>
                  {getPatientDisplayPhone(p) && (
                    <span className="text-xs text-slate-muted" dir="ltr">
                      {getPatientDisplayPhone(p)}
                    </span>
                  )}
                  <span className="mr-auto text-[10px] rounded-full bg-primary/10 text-primary px-2">
                    مريض سابق
                  </span>
                </button>
              ))}
            </div>
          )}
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

        {formSchema.showPatientSearch && selectedPatientId && patientPhone && (
          <div className="sm:col-span-2 text-sm text-slate-muted" dir="ltr">
            هاتف المراجع: {patientPhone}
          </div>
        )}

        {formSchema.showAssignedDoctor && assignedDoctor && (
          <div className="sm:col-span-2 rounded-xl border border-slate-border bg-surface/80 px-4 py-3">
            <p className="text-xs text-slate-muted">الطبيب المعالج لهذا المراجع</p>
            <p className="text-base font-semibold text-slate-text">
              {assignedDoctor.full_name_ar}
            </p>
            <p className="mt-0.5 text-[11px] text-slate-muted">
              يُتابع تلقائياً على المتابعة والحالات الجديدة — نفس الطبيب من أول جلسة
            </p>
          </div>
        )}

        {formSchema.showCasePicker ? (
          <TreatmentCasePicker
            cases={treatmentCases}
            onSelect={(id) => {
              const c = treatmentCases.find((x) => x.id === id);
              if (!c) return;
              setSelectedCaseId(id);
              setFinancialPlan(caseToFinancialPlan(c));
              setOperationName(c.treatment_name_ar);
              setForceNewPlan(false);
              setClinical(EMPTY_CLINICAL_DRAFT);
            }}
            onNewCase={() => {
              setForceNewPlan(true);
              setSelectedCaseId(null);
              setFinancialPlan(emptyPlan);
              setOperationName("");
              setTotalAmount("");
              setPaidAmount("");
              setDiscountAmount("");
              setAdditionalDiscountAmount("");
              setClinical(EMPTY_CLINICAL_DRAFT);
            }}
          />
        ) : !planUiReady && selectedPatientId ? null : (
        <>
        {isFollowUpSession && selectedCase && (
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
                setFinancialPlan(emptyPlan);
                setForceNewPlan(false);
              }}
            >
              تغيير الحالة
            </button>
          </div>
        )}

        {formSchema.showDoctor && (
        <Select
          label="الطبيب *"
          name="doctor_id"
          value={doctorId}
          onChange={(e) => setDoctorId(e.target.value)}
          options={doctors.map((d) => ({ value: d.id, label: d.full_name_ar }))}
          placeholder="اختر الطبيب"
          required
          disabled={!!lockDoctorId}
        />
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
                setFinancialPlan(emptyPlan);
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
            disabled={loading || isCaseClosed || loadingPlan}
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
    </Card>
  );
}
