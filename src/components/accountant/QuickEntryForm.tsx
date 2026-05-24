"use client";

import { useState, useEffect } from "react";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { Select } from "@/components/ui/Select";
import { Card, CardHeader, CardTitle } from "@/components/ui/Card";
import { Alert } from "@/components/ui/Alert";
import { calculateRemainingDebt, formatCurrency } from "@/lib/utils";
import { createClient } from "@/lib/supabase/client";
import type { Doctor, PatientOperation } from "@/types";

interface QuickEntryFormProps {
  onSuccess?: (operation: PatientOperation) => void;
}

export function QuickEntryForm({ onSuccess }: QuickEntryFormProps) {
  const [patientName, setPatientName] = useState("");
  const [doctorId, setDoctorId] = useState("");
  const [operationTypeId, setOperationTypeId] = useState("");
  const [operationName, setOperationName] = useState("");
  const [totalAmount, setTotalAmount] = useState("");
  const [paidAmount, setPaidAmount] = useState("");
  const [doctors, setDoctors] = useState<Doctor[]>([]);
  const [operationTypes, setOperationTypes] = useState<{ value: string; label: string }[]>([]);
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState<{ type: "success" | "error"; text: string } | null>(null);

  const total = parseFloat(totalAmount) || 0;
  const paid = parseFloat(paidAmount) || 0;
  const remaining = calculateRemainingDebt(total, paid);

  useEffect(() => {
    async function load() {
      const supabase = createClient();
      const [docRes, opRes] = await Promise.all([
        supabase.from("doctors").select("*").eq("is_active", true),
        supabase.from("operation_types").select("id, name_ar").eq("is_active", true).order("sort_order"),
      ]);
      if (docRes.data) setDoctors(docRes.data as Doctor[]);
      if (opRes.data) {
        setOperationTypes(
          opRes.data.map((o: { id: string; name_ar: string }) => ({
            value: o.id,
            label: o.name_ar,
          }))
        );
      }
    }
    load();
  }, []);

  useEffect(() => {
    const selected = operationTypes.find((o) => o.value === operationTypeId);
    if (selected) setOperationName(selected.label);
  }, [operationTypeId, operationTypes]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setMessage(null);
    setLoading(true);

    const supabase = createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) {
      setMessage({ type: "error", text: "يجب تسجيل الدخول أولاً" });
      setLoading(false);
      return;
    }

    const { data: profile } = await supabase
      .from("profiles")
      .select("clinic_id")
      .eq("id", user.id)
      .single();

    if (!profile?.clinic_id) {
      setMessage({ type: "error", text: "حسابك غير مربوط بعيادة" });
      setLoading(false);
      return;
    }

    const clinicId = profile.clinic_id;

    let patientId: string;
    const { data: existing } = await supabase
      .from("patients")
      .select("id")
      .eq("full_name_ar", patientName.trim())
      .maybeSingle();

    if (existing?.id) {
      patientId = existing.id;
    } else {
      const { data: newPatient, error: pErr } = await supabase
        .from("patients")
        .insert({ full_name_ar: patientName.trim(), clinic_id: clinicId })
        .select("id")
        .single();
      if (pErr || !newPatient) {
        setMessage({ type: "error", text: "تعذر إنشاء سجل المريض" });
        setLoading(false);
        return;
      }
      patientId = newPatient.id;
    }

    const { data: op, error } = await supabase
      .from("patient_operations")
      .insert({
        clinic_id: clinicId,
        patient_id: patientId,
        doctor_id: doctorId,
        operation_type_id: operationTypeId || null,
        operation_name_ar: operationName || "عملية",
        total_amount: total,
        paid_amount: paid,
      })
      .select("*, patient:patients(*), doctor:doctors(*)")
      .single();

    setLoading(false);

    if (error) {
      setMessage({ type: "error", text: "تعذر حفظ العملية. تحقق من الاتصال وقاعدة البيانات." });
      return;
    }

    setMessage({ type: "success", text: "تم حفظ العملية بنجاح" });
    setPatientName("");
    setTotalAmount("");
    setPaidAmount("");
    onSuccess?.(op as PatientOperation);

    if (paid > 0) {
      const { data: patientRow } = await supabase
        .from("patients")
        .select("full_name_ar, phone")
        .eq("id", patientId)
        .single();
      if (patientRow?.phone) {
        const selectedDoctor = doctors.find((d) => d.id === doctorId);
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
        <CardTitle>إدخال سريع — عملية مريض</CardTitle>
      </CardHeader>

      <form onSubmit={handleSubmit} className="grid gap-4 sm:grid-cols-2">
        {message && (
          <div className="sm:col-span-2">
            <Alert variant={message.type === "success" ? "success" : "error"}>
              {message.text}
            </Alert>
          </div>
        )}

        <Input
          label="اسم المريض"
          value={patientName}
          onChange={(e) => setPatientName(e.target.value)}
          placeholder="أدخل الاسم الكامل"
          required
        />

        <Select
          label="الطبيب"
          name="doctor_id"
          value={doctorId}
          onChange={(e) => setDoctorId(e.target.value)}
          options={doctors.map((d) => ({ value: d.id, label: d.full_name_ar }))}
          placeholder="اختر الطبيب"
          required
        />

        <Select
          label="نوع العملية"
          name="operation_type"
          value={operationTypeId}
          onChange={(e) => setOperationTypeId(e.target.value)}
          options={operationTypes}
          placeholder="اختر نوع العملية"
          required
        />

        <Input
          label="المبلغ الإجمالي"
          type="number"
          min="0"
          step="0.01"
          value={totalAmount}
          onChange={(e) => setTotalAmount(e.target.value)}
          required
          dir="ltr"
          className="text-left"
        />

        <Input
          label="المبلغ المدفوع"
          type="number"
          min="0"
          step="0.01"
          value={paidAmount}
          onChange={(e) => setPaidAmount(e.target.value)}
          required
          dir="ltr"
          className="text-left"
        />

        <div className="sm:col-span-2 rounded-lg border border-slate-border bg-surface p-4">
          <p className="text-sm text-slate-muted">المتبقي (يُحسب تلقائياً)</p>
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
            {loading ? "جاري الحفظ..." : "حفظ العملية"}
          </Button>
        </div>
      </form>
    </Card>
  );
}
