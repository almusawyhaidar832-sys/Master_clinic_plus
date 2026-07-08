"use client";

import { useEffect, useMemo, useState } from "react";
import { X, Upload, RefreshCw, Wallet } from "lucide-react";
import { cn, formatCurrency, todayISO } from "@/lib/utils";
import { calculateDoctorShareForDoctor } from "@/lib/finance";
import { authPortalHeaders } from "@/lib/auth/api-portal";
import { createClient } from "@/lib/supabase/client";
import type {
  Appointment,
  DoctorPaymentType,
  DoctorPercentage,
  MaterialsCostShare,
  OperationType,
  PatientOperation,
} from "@/types";
import { useClinicProfile } from "@/contexts/ClinicProfileContext";
import { SessionInvoiceModal } from "@/components/invoices/SessionInvoiceModal";
import {
  buildSessionInvoiceData,
  type SessionInvoiceData,
} from "@/lib/invoices/session-invoice";
import { FINANCIAL_EPSILON } from "@/lib/services/patient-financial-plan";
import { notifySessionMutation } from "@/lib/sync/mutation-notify";
import { notifyClinicProfitRefresh } from "@/lib/services/clinic-profit";

export interface DashboardAppointment extends Appointment {
  doctor?: {
    full_name_ar: string;
    percentage: DoctorPercentage;
    materials_share: MaterialsCostShare;
    payment_type?: DoctorPaymentType;
  } | null;
}

interface PaymentInvoiceModalProps {
  appointment: DashboardAppointment;
  onClose: () => void;
  onSaved: () => void;
}

export function PaymentInvoiceModal({
  appointment,
  onClose,
  onSaved,
}: PaymentInvoiceModalProps) {
  const [operationTypes, setOperationTypes] = useState<OperationType[]>([]);
  const [operationTypeId, setOperationTypeId] = useState("");
  const [procedureName, setProcedureName] = useState("");
  const [totalAmount, setTotalAmount] = useState("");
  const [paidAmount, setPaidAmount] = useState("");
  const [materialsCost, setMaterialsCost] = useState("0");
  const [labNotes, setLabNotes] = useState("");
  const [notes, setNotes] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [invoiceData, setInvoiceData] = useState<SessionInvoiceData | null>(null);
  const { profile: clinicProfile } = useClinicProfile();

  useEffect(() => {
    async function loadTypes() {
      const supabase = createClient();
      const { data } = await supabase
        .from("operation_types")
        .select("id, name_ar, default_price, is_active, sort_order")
        .eq("clinic_id", appointment.clinic_id)
        .eq("is_active", true)
        .order("sort_order");

      setOperationTypes((data as OperationType[]) ?? []);
    }
    loadTypes();
  }, [appointment.clinic_id]);

  useEffect(() => {
    if (!operationTypeId) return;
    const selected = operationTypes.find((t) => t.id === operationTypeId);
    if (selected) {
      setProcedureName(selected.name_ar);
      if (selected.default_price != null && !totalAmount) {
        setTotalAmount(String(selected.default_price));
      }
    }
  }, [operationTypeId, operationTypes, totalAmount]);

  const splitPreview = useMemo(() => {
    const total = Number(totalAmount) || 0;
    const materials = Number(materialsCost) || 0;
    const doctor = appointment.doctor;
    if (!doctor || total <= 0) return null;
    return calculateDoctorShareForDoctor(
      total,
      {
        percentage: doctor.percentage,
        materials_share: doctor.materials_share,
        payment_type: doctor.payment_type,
      },
      materials
    );
  }, [totalAmount, materialsCost, appointment.doctor]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError("");

    const total = Number(totalAmount);
    const paid = Number(paidAmount || 0);
    if (!procedureName.trim()) {
      setError("أدخل نوع الحالة / الإجراء");
      return;
    }
    if (!Number.isFinite(total) || total < 0) {
      setError("المبلغ الكلي غير صالح");
      return;
    }

    setSaving(true);
    try {
      const form = new FormData();
      form.append("appointment_id", appointment.id);
      form.append("procedure_name", procedureName.trim());
      if (operationTypeId) form.append("operation_type_id", operationTypeId);
      form.append("total_amount", String(total));
      form.append("paid_amount", String(paid));
      form.append("materials_cost", String(Number(materialsCost) || 0));
      if (labNotes.trim()) form.append("lab_notes", labNotes.trim());
      if (notes.trim()) form.append("notes", notes.trim());
      if (file) form.append("file", file);

      const res = await fetch("/api/operations/appointment-invoice", {
        method: "POST",
        credentials: "include",
        headers: authPortalHeaders("accountant"),
        body: form,
      });

      const json = await res.json();
      if (!res.ok) {
        setError(json.error ?? "تعذر حفظ الفاتورة");
        return;
      }

      onSaved();

      notifySessionMutation({
        clinicId: appointment.clinic_id,
        doctorId: appointment.doctor_id,
        patientId: json.patientId as string | undefined,
      });
      if (paid > 0) {
        notifyClinicProfitRefresh(appointment.clinic_id);
      }

      if (paid > 0 && json.operationId) {
        const stubOp = {
          id: json.operationId as string,
          clinic_id: appointment.clinic_id,
          patient_id: json.patientId as string,
          doctor_id: appointment.doctor_id,
          operation_name_ar: procedureName.trim(),
          operation_date: appointment.appointment_date ?? todayISO(),
          total_amount: total,
          paid_amount: paid,
          remaining_debt: Math.max(0, total - paid),
          notes: notes.trim() || null,
          lab_notes: labNotes.trim() || null,
          materials_cost: Number(materialsCost) || 0,
        } as PatientOperation;

        setInvoiceData({
          ...buildSessionInvoiceData({
            operation: stubOp,
            clinic: clinicProfile ?? null,
            patientName,
            patientPhone: appointment.patient_phone,
            doctorName,
            procedureLabel: procedureName.trim(),
            treatmentName: procedureName.trim(),
            paidThisSession: paid,
            caseTotalAmount: total,
            caseTotalPaid: paid,
            remainingBalance: Math.max(0, total - paid),
            treatmentCompleted:
              total > FINANCIAL_EPSILON &&
              paid >= total - FINANCIAL_EPSILON,
            notes: notes.trim() || null,
            labNotes: labNotes.trim() || null,
            materialsCost: Number(materialsCost) || 0,
          }),
          invoiceId: (json.invoiceId as string) ?? null,
        });
      } else {
        onClose();
      }
    } catch {
      setError("خطأ في الاتصال");
    } finally {
      setSaving(false);
    }
  }

  const patientName = appointment.patient_name_ar || "مراجع";
  const doctorName = appointment.doctor?.full_name_ar || "—";

  if (invoiceData) {
    return (
      <SessionInvoiceModal
        data={invoiceData}
        invoiceId={invoiceData.invoiceId}
        onFinalized={onSaved}
        onClose={() => {
          setInvoiceData(null);
          onClose();
        }}
      />
    );
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 sm:items-center"
      role="dialog"
      aria-modal="true"
    >
      <div className="max-h-[92vh] w-full max-w-lg overflow-y-auto rounded-t-2xl bg-white p-6 shadow-2xl sm:rounded-2xl">
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-lg font-bold text-slate-800">دفع وإصدار فاتورة</h2>
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg p-1 hover:bg-slate-100"
          >
            <X className="h-5 w-5 text-slate-500" />
          </button>
        </div>

        <div className="mb-4 rounded-xl border border-slate-100 bg-slate-50 p-4 text-sm">
          <p className="font-semibold text-slate-800">{patientName}</p>
          {appointment.patient_phone && (
            <p className="text-slate-500" dir="ltr">{appointment.patient_phone}</p>
          )}
          <p className="mt-1 text-slate-600">الطبيب: {doctorName}</p>
          <p className="text-xs text-slate-400">تاريخ اليوم: {todayISO()}</p>
        </div>

        {error && (
          <p className="mb-3 rounded-lg border border-red-100 bg-red-50 px-3 py-2 text-sm text-red-600">
            {error}
          </p>
        )}

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="mb-1 block text-sm font-medium text-slate-600">
              نوع الحالة / الإجراء
            </label>
            {operationTypes.length > 0 && (
              <select
                value={operationTypeId}
                onChange={(e) => setOperationTypeId(e.target.value)}
                className="mb-2 w-full rounded-xl border border-slate-200 bg-slate-50 px-4 py-2.5 text-sm focus:border-primary focus:outline-none"
              >
                <option value="">— اختر من القائمة —</option>
                {operationTypes.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.name_ar}
                    {t.default_price != null ? ` (${t.default_price} د.ع)` : ""}
                  </option>
                ))}
              </select>
            )}
            <input
              value={procedureName}
              onChange={(e) => setProcedureName(e.target.value)}
              required
              placeholder="مثال: حشوة، كشفية، خلع..."
              className="w-full rounded-xl border border-slate-200 bg-slate-50 px-4 py-2.5 text-sm focus:border-primary focus:outline-none"
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="mb-1 block text-sm font-medium text-slate-600">
                المبلغ الكلي (د.ع)
              </label>
              <input
                type="number"
                min={0}
                step="any"
                value={totalAmount}
                onChange={(e) => setTotalAmount(e.target.value)}
                required
                dir="ltr"
                className="w-full rounded-xl border border-slate-200 bg-slate-50 px-4 py-2.5 text-sm focus:border-primary focus:outline-none"
              />
            </div>
            <div>
              <label className="mb-1 block text-sm font-medium text-slate-600">
                المبلغ المدفوع (د.ع)
              </label>
              <input
                type="number"
                min={0}
                step="any"
                value={paidAmount}
                onChange={(e) => setPaidAmount(e.target.value)}
                dir="ltr"
                className="w-full rounded-xl border border-slate-200 bg-slate-50 px-4 py-2.5 text-sm focus:border-primary focus:outline-none"
              />
            </div>
          </div>

          <div className="space-y-3">
            <div>
              <label className="mb-1 block text-sm font-medium text-slate-600">
                تكلفة عمل المختبر (اختياري — للتقسيم الدقيق)
              </label>
              <input
                type="number"
                min={0}
                step="any"
                value={materialsCost}
                onChange={(e) => setMaterialsCost(e.target.value)}
                dir="ltr"
                className="w-full rounded-xl border border-slate-200 bg-slate-50 px-4 py-2.5 text-sm focus:border-primary focus:outline-none"
              />
            </div>
            <div>
              <label className="mb-1 block text-sm font-medium text-slate-600">
                ملاحظات المختبر
              </label>
              <textarea
                rows={3}
                value={labNotes}
                onChange={(e) => setLabNotes(e.target.value)}
                placeholder="تعليمات تفصيلية لعمل المختبر..."
                className="w-full resize-none rounded-xl border border-slate-200 bg-slate-50 px-4 py-2.5 text-sm focus:border-primary focus:outline-none"
              />
            </div>
          </div>

          {splitPreview && (
            <div className="flex items-start gap-2 rounded-xl border border-emerald-100 bg-emerald-50 p-3 text-sm text-emerald-800">
              <Wallet className="mt-0.5 h-4 w-4 flex-shrink-0" />
              <div>
                <p className="font-semibold">التقسيم المالي (حسب اتفاق الطبيب)</p>
                <p className="mt-1">
                  حصة الطبيب: <strong>{formatCurrency(splitPreview.doctorShare)}</strong>
                  {" · "}
                  حصة العيادة: <strong>{formatCurrency(splitPreview.clinicShare)}</strong>
                </p>
                {appointment.doctor && (
                  <p className="mt-0.5 text-xs text-emerald-700">
                    نسبة الطبيب {appointment.doctor.percentage}% · مواد{" "}
                    {appointment.doctor.materials_share}%
                  </p>
                )}
              </div>
            </div>
          )}

          <div>
            <label className="mb-1 block text-sm font-medium text-slate-600">
              صورة الأشعة / تقرير طبي
            </label>
            <label
              className={cn(
                "flex cursor-pointer items-center gap-3 rounded-xl border border-dashed border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-600 hover:bg-white"
              )}
            >
              <Upload className="h-4 w-4 text-slate-400" />
              {file ? file.name : "اختر ملفاً (صورة أو PDF — حتى 10 ميجابايت)"}
              <input
                type="file"
                accept="image/*,application/pdf"
                className="hidden"
                onChange={(e) => setFile(e.target.files?.[0] ?? null)}
              />
            </label>
          </div>

          <div>
            <label className="mb-1 block text-sm font-medium text-slate-600">ملاحظات</label>
            <textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              rows={2}
              className="w-full rounded-xl border border-slate-200 bg-slate-50 px-4 py-2.5 text-sm focus:border-primary focus:outline-none"
            />
          </div>

          <div className="flex gap-3 pt-2">
            <button
              type="submit"
              disabled={saving}
              className="flex flex-1 items-center justify-center gap-2 rounded-xl bg-primary py-3 text-sm font-bold text-white hover:bg-primary/90 disabled:opacity-60"
            >
              {saving && <RefreshCw className="h-4 w-4 animate-spin" />}
              {saving ? "جارٍ الحفظ..." : "حفظ الفاتورة"}
            </button>
            <button
              type="button"
              onClick={onClose}
              className="rounded-xl border border-slate-200 px-4 py-3 text-sm text-slate-600"
            >
              إلغاء
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
