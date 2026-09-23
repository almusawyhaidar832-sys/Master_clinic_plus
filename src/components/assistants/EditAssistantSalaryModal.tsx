"use client";

import { useMemo, useState } from "react";
import { RefreshCw, Wallet } from "lucide-react";
import { Modal } from "@/components/ui/Modal";
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
    <Modal
      onClose={onClose}
      title={`تعديل راتب — ${assistant.full_name_ar}`}
      icon={Wallet}
      size="md"
    >
        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="mb-1.5 block text-xs font-semibold text-slate-muted">
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
              className="mc-field"
            />
          </div>

          <div>
            <label className="mb-1.5 block text-xs font-semibold text-slate-muted">
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
              className="mc-field"
            />
            <p className="mt-2 rounded-xl border border-premium-200 bg-premium-50 px-3 py-2 text-xs font-semibold tabular-nums text-premium-700">
              معاينة: الطبيب {formatCurrency(preview.doctorShare)} · العيادة{" "}
              {formatCurrency(preview.clinicShare)}
            </p>
            <p className="mt-1.5 text-xs text-slate-muted">
              يُحدَّث تلقائياً في سجلات الرواتب غير المُصرفة — السجلات المدفوعة
              تبقى كما هي.
            </p>
          </div>

          {error && (
            <p className="rounded-xl border border-debt-border bg-debt px-3 py-2 text-sm text-debt-text">
              {error}
            </p>
          )}

          <div className="flex gap-2 border-t border-slate-border pt-4">
            <button
              type="button"
              onClick={onClose}
              className="mc-btn-soft flex-1 py-2.5"
            >
              إلغاء
            </button>
            <button
              type="submit"
              disabled={saving}
              className="mc-btn-navy flex-1 py-2.5"
            >
              {saving && <RefreshCw className="h-4 w-4 animate-spin" />}
              حفظ
            </button>
          </div>
        </form>
    </Modal>
  );
}
