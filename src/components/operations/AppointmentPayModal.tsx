"use client";

import { useEffect, useState } from "react";
import { X, Upload, RefreshCw } from "lucide-react";
import { cn } from "@/lib/utils";
import { authPortalHeaders } from "@/lib/auth/api-portal";
import { createClient } from "@/lib/supabase/client";
import type { DashboardAppointment } from "@/components/operations/PaymentInvoiceModal";
import type { OperationType } from "@/types";

interface AppointmentPayModalProps {
  appointment: DashboardAppointment;
  onClose: () => void;
  onSaved: () => void;
}

/** نافذة دفع مبسطة: نوع الحالة + المبلغ + صورة الأشعة → invoices */
export function AppointmentPayModal({
  appointment,
  onClose,
  onSaved,
}: AppointmentPayModalProps) {
  const [operationTypes, setOperationTypes] = useState<OperationType[]>([]);
  const [procedureName, setProcedureName] = useState("");
  const [amount, setAmount] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    async function loadTypes() {
      const supabase = createClient();
      const { data } = await supabase
        .from("operation_types")
        .select("id, name_ar, default_price, is_active, sort_order, clinic_id")
        .eq("clinic_id", appointment.clinic_id)
        .eq("is_active", true)
        .order("sort_order");
      setOperationTypes((data as OperationType[]) ?? []);
    }
    loadTypes();
  }, [appointment.clinic_id]);

  function pickType(id: string) {
    const t = operationTypes.find((x) => x.id === id);
    if (t) {
      setProcedureName(t.name_ar);
      if (t.default_price != null) setAmount(String(t.default_price));
    }
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError("");

    const total = Number(amount);
    if (!procedureName.trim()) {
      setError("أدخل نوع الحالة / الإجراء");
      return;
    }
    if (!Number.isFinite(total) || total < 0) {
      setError("المبلغ غير صالح");
      return;
    }

    setSaving(true);
    try {
      const form = new FormData();
      form.append("appointment_id", appointment.id);
      form.append("procedure_name", procedureName.trim());
      form.append("total_amount", String(total));
      form.append("paid_amount", String(total));
      form.append("materials_cost", "0");
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
      onClose();
    } catch {
      setError("خطأ في الاتصال");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 sm:items-center">
      <div className="w-full max-w-md rounded-t-2xl bg-white p-6 shadow-2xl sm:rounded-2xl">
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-lg font-bold text-slate-800">دفع وإصدار فاتورة</h2>
          <button type="button" onClick={onClose} className="rounded-lg p-1 hover:bg-slate-100">
            <X className="h-5 w-5 text-slate-500" />
          </button>
        </div>

        <div className="mb-4 rounded-xl bg-slate-50 p-3 text-sm">
          <p className="font-semibold">{appointment.patient_name_ar || "مراجع"}</p>
          <p className="text-slate-500">{appointment.doctor?.full_name_ar ?? "طبيب"}</p>
        </div>

        {error && (
          <p className="mb-3 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-600">{error}</p>
        )}

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="mb-1 block text-sm font-medium text-slate-600">
              نوع الحالة / الإجراء
            </label>
            {operationTypes.length > 0 && (
              <select
                onChange={(e) => pickType(e.target.value)}
                className="mb-2 w-full rounded-xl border border-slate-200 bg-slate-50 px-4 py-2.5 text-sm"
                defaultValue=""
              >
                <option value="" disabled>اختر من القائمة</option>
                {operationTypes.map((t) => (
                  <option key={t.id} value={t.id}>{t.name_ar}</option>
                ))}
              </select>
            )}
            <input
              value={procedureName}
              onChange={(e) => setProcedureName(e.target.value)}
              required
              placeholder="كشفية، حشوة..."
              className="w-full rounded-xl border border-slate-200 bg-slate-50 px-4 py-2.5 text-sm focus:border-primary focus:outline-none"
            />
          </div>

          <div>
            <label className="mb-1 block text-sm font-medium text-slate-600">
              المبلغ (د.ع)
            </label>
            <input
              type="number"
              min={0}
              step="any"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              required
              dir="ltr"
              className="w-full rounded-xl border border-slate-200 bg-slate-50 px-4 py-2.5 text-sm focus:border-primary focus:outline-none"
            />
          </div>

          <div>
            <label className="mb-1 block text-sm font-medium text-slate-600">
              صورة الأشعة / تقرير
            </label>
            <label className="flex cursor-pointer items-center gap-2 rounded-xl border border-dashed border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-600">
              <Upload className="h-4 w-4" />
              {file ? file.name : "اختر ملفاً (اختياري)"}
              <input
                type="file"
                accept="image/*,application/pdf"
                className="hidden"
                onChange={(e) => setFile(e.target.files?.[0] ?? null)}
              />
            </label>
          </div>

          <div className="flex gap-2 pt-2">
            <button
              type="submit"
              disabled={saving}
              className={cn(
                "flex flex-1 items-center justify-center gap-2 rounded-xl bg-primary py-3 text-sm font-bold text-white",
                saving && "opacity-60"
              )}
            >
              {saving && <RefreshCw className="h-4 w-4 animate-spin" />}
              حفظ في الفواتير
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
