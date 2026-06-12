"use client";

import { useMemo, useState } from "react";
import { X, RefreshCw } from "lucide-react";
import { authPortalHeaders } from "@/lib/auth/api-portal";
import { breakdownAssistantSalary } from "@/lib/services/assistant-payroll";
import { formatCurrency } from "@/lib/utils";

interface EditAssistantSalaryModalProps {
  assistant: {
    id: string;
    full_name_ar: string;
    total_salary?: number | null;
    doctor_share_percentage?: number | null;
  };
  onClose: () => void;
  onSaved: () => void;
}

export function EditAssistantSalaryModal({
  assistant,
  onClose,
  onSaved,
}: EditAssistantSalaryModalProps) {
  const [totalSalary, setTotalSalary] = useState(
    String(assistant.total_salary ?? 0)
  );
  const [doctorSharePct, setDoctorSharePct] = useState(
    String(assistant.doctor_share_percentage ?? 0)
  );
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  const preview = useMemo(() => {
    return breakdownAssistantSalary({
      total_salary: Number(totalSalary) || 0,
      doctor_share_percentage: Number(doctorSharePct) || 0,
    });
  }, [totalSalary, doctorSharePct]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError("");

    const salary = Number(totalSalary);
    const sharePct = Number(doctorSharePct);
    if (!Number.isFinite(salary) || salary < 0) {
      setError("أدخل الراتب الكلي بشكل صحيح");
      return;
    }
    if (!Number.isFinite(sharePct) || sharePct < 0 || sharePct > 100) {
      setError("نسبة تحمّل الطبيب يجب أن تكون بين 0 و 100");
      return;
    }

    setSaving(true);
    const res = await fetch("/api/payroll/update-compensation", {
      method: "PATCH",
      credentials: "include",
      headers: {
        "Content-Type": "application/json",
        ...authPortalHeaders("accountant"),
      },
      body: JSON.stringify({
        category: "assistant",
        id: assistant.id,
        base_salary: salary,
        doctor_share_percentage: sharePct,
      }),
    });
    const json = await res.json();
    setSaving(false);

    if (!res.ok) {
      setError(json.error ?? "تعذر الحفظ");
      return;
    }

    onSaved();
    onClose();
  }

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 sm:items-center">
      <div className="w-full max-w-md rounded-t-2xl bg-white p-6 shadow-xl sm:rounded-2xl">
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-lg font-bold text-slate-800">
            تعديل راتب — {assistant.full_name_ar}
          </h2>
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg p-1 hover:bg-slate-100"
          >
            <X className="h-5 w-5 text-slate-400" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="mb-1 block text-sm font-medium text-slate-600">
              الراتب الكلي للمساعد
            </label>
            <input
              type="number"
              min={0}
              step="1000"
              value={totalSalary}
              onChange={(e) => setTotalSalary(e.target.value)}
              required
              dir="ltr"
              className="w-full rounded-xl border border-slate-200 bg-slate-50 px-4 py-2.5 text-sm"
            />
          </div>

          <div>
            <label className="mb-1 block text-sm font-medium text-slate-600">
              نسبة تحمّل الطبيب (%)
            </label>
            <input
              type="number"
              min={0}
              max={100}
              step="1"
              value={doctorSharePct}
              onChange={(e) => setDoctorSharePct(e.target.value)}
              dir="ltr"
              className="w-full rounded-xl border border-slate-200 bg-slate-50 px-4 py-2.5 text-sm"
            />
            <p className="mt-2 rounded-lg bg-teal-50 px-3 py-2 text-xs text-teal-800">
              معاينة: الطبيب {formatCurrency(preview.doctorShare)} · العيادة{" "}
              {formatCurrency(preview.clinicShare)}
            </p>
            <p className="mt-1 text-xs text-slate-400">
              يُحدَّث تلقائياً في سجلات الرواتب غير المُصرفة — السجلات المدفوعة
              تبقى كما هي.
            </p>
          </div>

          {error && (
            <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">
              {error}
            </p>
          )}

          <div className="flex gap-2">
            <button
              type="button"
              onClick={onClose}
              className="flex-1 rounded-xl border border-slate-200 px-4 py-2.5 text-sm font-medium text-slate-600 hover:bg-slate-50"
            >
              إلغاء
            </button>
            <button
              type="submit"
              disabled={saving}
              className="flex flex-1 items-center justify-center gap-2 rounded-xl bg-teal-600 px-4 py-2.5 text-sm font-bold text-white hover:bg-teal-700 disabled:opacity-60"
            >
              {saving && <RefreshCw className="h-4 w-4 animate-spin" />}
              حفظ
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
