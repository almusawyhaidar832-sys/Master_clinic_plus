"use client";

import { useState, useEffect, useRef } from "react";
import { Button } from "@/components/ui/Button";
import { CurrencyInput } from "@/components/ui/CurrencyInput";
import { Select } from "@/components/ui/Select";
import { Card, CardHeader, CardTitle } from "@/components/ui/Card";
import { Alert } from "@/components/ui/Alert";
import { calculateRemainingDebt, formatCurrency } from "@/lib/utils";
import { createClient } from "@/lib/supabase/client";
import { getActiveClinicId } from "@/lib/clinic-context";
import { FinancialPreview } from "@/components/financial/FinancialPreview";
import type { Doctor, Patient, PatientOperation } from "@/types";

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
  onSuccess?: (operation: PatientOperation) => void;
}

export function QuickEntryForm({
  defaultPatientId,
  defaultPatientName,
  onSuccess,
}: QuickEntryFormProps) {
  const listId = "dental-suggestions";

  // Patient search state
  const [patientQuery, setPatientQuery] = useState(defaultPatientName ?? "");
  const [patientSuggestions, setPatientSuggestions] = useState<Patient[]>([]);
  const [selectedPatientId, setSelectedPatientId] = useState<string | null>(
    defaultPatientId ?? null
  );
  const [showSuggestions, setShowSuggestions] = useState(false);
  const suggestionsRef = useRef<HTMLDivElement>(null);

  // Form fields
  const [doctorId, setDoctorId] = useState("");
  const [operationName, setOperationName] = useState("");
  const [totalAmount, setTotalAmount] = useState("");
  const [paidAmount, setPaidAmount] = useState("");
  const [materialsCost, setMaterialsCost] = useState("");
  const [notes, setNotes] = useState("");
  const [isReviewStatement, setIsReviewStatement] = useState(false);
  const [doctors, setDoctors] = useState<Doctor[]>([]);
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState<{
    type: "success" | "error";
    text: string;
  } | null>(null);

  const total = parseFloat(totalAmount) || 0;
  const paid = parseFloat(paidAmount) || 0;
  const materials = parseFloat(materialsCost) || 0;
  const remaining = calculateRemainingDebt(total, paid);
  const selectedDoctor = doctors.find((d) => d.id === doctorId) ?? null;

  useEffect(() => {
    async function load() {
      const supabase = createClient();
      const { data } = await supabase
        .from("doctors")
        .select("*")
        .eq("is_active", true)
        .order("full_name_ar");
      if (data) setDoctors(data as Doctor[]);
    }
    load();
  }, []);

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
        .select("id, full_name_ar, phone")
        .ilike("full_name_ar", `%${q}%`)
        .limit(8);
      setPatientSuggestions((data as Patient[]) || []);
      setShowSuggestions(true);
    }, 300);
    return () => clearTimeout(timeout);
  }, [patientQuery, selectedPatientId]);

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

    if (!operationName.trim()) {
      setMessage({ type: "error", text: "أدخل نوع العملية" });
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
      // Check exact match first
      const { data: existing } = await supabase
        .from("patients")
        .select("id")
        .eq("full_name_ar", name)
        .eq("clinic_id", activeClinic.clinicId)
        .maybeSingle();

      if (existing?.id) {
        patientId = existing.id;
      } else {
        const { data: newP, error: pErr } = await supabase
          .from("patients")
          .insert({ full_name_ar: name, clinic_id: activeClinic.clinicId })
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

    // Build the minimal safe payload — only columns confirmed to exist
    const safePayload: Record<string, unknown> = {
      clinic_id: activeClinic.clinicId,
      patient_id: patientId,
      doctor_id: doctorId,
      total_amount: total,
      paid_amount: paid,
    };

    // Try 'operation_type' first (user's DB), then 'operation_name_ar' (migration schema)
    const opColCandidates = [
      { key: "operation_type", val: operationName.trim() },
      { key: "operation_name_ar", val: operationName.trim() },
    ];

    // Optional columns — added only if confirmed to exist (no crash if absent)
    const optionalCols: Record<string, unknown> = {};
    if (notes.trim()) optionalCols.notes = notes.trim();
    if (isReviewStatement) optionalCols.is_review_statement = true;

    let op: PatientOperation | null = null;
    let error: { message: string } | null = null;

    for (const { key, val } of opColCandidates) {
      const payload = { ...safePayload, [key]: val, ...optionalCols };

      const result = await supabase
        .from("patient_operations")
        .insert(payload)
        .select("*")
        .single();

      if (!result.error) {
        op = result.data as PatientOperation;
        error = null;
        break;
      }

      const msg = result.error.message;
      // If this specific column doesn't exist, try next candidate
      if (
        msg.includes(key) ||
        msg.includes("schema cache") ||
        msg.includes("Could not find")
      ) {
        // Remove optional cols that caused issues and retry without them
        if (msg.includes("notes") || msg.includes("is_review_statement")) {
          delete optionalCols.notes;
          delete optionalCols.is_review_statement;
          const retryPayload = { ...safePayload, [key]: val };
          const retry = await supabase
            .from("patient_operations")
            .insert(retryPayload)
            .select("*")
            .single();
          if (!retry.error) {
            op = retry.data as PatientOperation;
            error = null;
            break;
          }
        }
        error = result.error;
        continue;
      }

      // Other error — stop retrying
      error = result.error;
      break;
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

    setMessage({ type: "success", text: "✓ تم حفظ الجلسة بنجاح" });

    if (op?.id) {
      await fetch("/api/notifications/dispatch", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ event: "new_operation", id: op.id }),
      });
    }

    // Reset non-patient fields (keep patient selected for next session)
    setOperationName("");
    setTotalAmount("");
    setPaidAmount("");
    setMaterialsCost("");
    setNotes("");
    onSuccess?.(op as PatientOperation);

    // Optional WhatsApp receipt
    if (paid > 0) {
      const { data: patientRow } = await supabase
        .from("patients")
        .select("full_name_ar, phone")
        .eq("id", patientId!)
        .single();
      if (patientRow?.phone) {
        await fetch("/api/whatsapp/send", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            type: "payment_receipt",
            phone: patientRow.phone,
            payload: {
              patientName: patientRow.full_name_ar,
              paidAmount: `${paid} ج.م`,
              doctorName: selectedDoctor?.full_name_ar ?? "",
            },
          }),
        });
      }
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>تسجيل جلسة جديدة</CardTitle>
      </CardHeader>

      <form onSubmit={handleSubmit} className="grid gap-4 sm:grid-cols-2">
        {message && (
          <div className="sm:col-span-2">
            <Alert variant={message.type === "success" ? "success" : "error"}>
              {message.text}
            </Alert>
          </div>
        )}

        {/* Patient search with autocomplete */}
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
              }}
              onFocus={() => patientSuggestions.length > 0 && setShowSuggestions(true)}
              placeholder="اسم المريض — سيُقترح المرضى السابقون"
              required
              disabled={!!defaultPatientId}
            />
            {selectedPatientId && !defaultPatientId && (
              <button
                type="button"
                onClick={() => {
                  setSelectedPatientId(null);
                  setPatientQuery("");
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
                    setShowSuggestions(false);
                  }}
                >
                  <span className="font-medium">{p.full_name_ar}</span>
                  {p.phone && (
                    <span className="text-xs text-slate-muted" dir="ltr">
                      {p.phone}
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

        {/* Doctor */}
        <Select
          label="الطبيب *"
          name="doctor_id"
          value={doctorId}
          onChange={(e) => setDoctorId(e.target.value)}
          options={doctors.map((d) => ({ value: d.id, label: d.full_name_ar }))}
          placeholder="اختر الطبيب"
          required
        />

        {/* Smart operation type — free text + datalist suggestions */}
        <div>
          <label className="mb-1 block text-sm font-medium text-slate-text">
            نوع العملية / الإجراء *
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
          <p className="mt-0.5 text-[10px] text-slate-muted">
            يمكن الكتابة بحرية أو اختيار من الاقتراحات
          </p>
        </div>

        {/* Amounts */}
        <CurrencyInput
          label="المبلغ الإجمالي *"
          value={totalAmount}
          onChange={setTotalAmount}
          placeholder="500,000"
          required
        />

        <CurrencyInput
          label="المبلغ المدفوع *"
          value={paidAmount}
          onChange={setPaidAmount}
          placeholder="0"
          required
        />

        <CurrencyInput
          label="تكلفة المواد / المعمل"
          value={materialsCost}
          onChange={setMaterialsCost}
          placeholder="0"
        />

        <label className="flex items-center gap-2 text-sm text-slate-text">
          <input
            type="checkbox"
            checked={isReviewStatement}
            onChange={(e) => setIsReviewStatement(e.target.checked)}
            className="h-4 w-4 rounded border-slate-border text-primary"
          />
          كشفية مراجع
        </label>

        {/* Medical notes textarea */}
        <div className="sm:col-span-2">
          <label className="mb-1 block text-sm font-medium text-slate-text">
            ملاحظات طبية / تفاصيل الجلسة
          </label>
          <textarea
            className="w-full rounded-lg border border-slate-border bg-surface px-3 py-2 text-sm text-slate-text outline-none focus:border-primary focus:ring-1 focus:ring-primary resize-none"
            rows={3}
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            placeholder="خطة العلاج، ملاحظات الطبيب، تفاصيل الإجراء..."
          />
        </div>

        {/* Financial preview */}
        <FinancialPreview
          className="sm:col-span-2"
          totalAmount={total}
          materialsCost={materials}
          doctor={selectedDoctor}
        />

        {/* Remaining */}
        <div className="sm:col-span-2 rounded-lg border border-slate-border bg-surface p-4">
          <p className="text-sm text-slate-muted">المتبقي (ذمة)</p>
          <p
            className={`text-2xl font-bold ${
              remaining > 0 ? "text-debt-text" : "text-primary"
            }`}
          >
            {formatCurrency(remaining)}
          </p>
        </div>

        <div className="sm:col-span-2">
          <Button type="submit" className="w-full sm:w-auto" disabled={loading}>
            {loading ? "جاري الحفظ..." : "حفظ الجلسة"}
          </Button>
        </div>
      </form>
    </Card>
  );
}
