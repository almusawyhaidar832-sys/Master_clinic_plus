"use client";

import { useState } from "react";
import { X, RefreshCw } from "lucide-react";
import type { Appointment } from "@/types";
import { setAssistantAppointmentStatusViaApi } from "@/lib/services/assistant-appointments-client";
import { setAccountantAppointmentStatusViaApi } from "@/lib/services/accountant-appointments-client";

interface CancelAppointmentModalProps {
  appointment: Appointment;
  onClose: () => void;
  onSaved: () => void;
  portal?: "assistant" | "accountant";
}

export function CancelAppointmentModal({
  appointment,
  onClose,
  onSaved,
  portal = "assistant",
}: CancelAppointmentModalProps) {
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    const result =
      portal === "accountant"
        ? await setAccountantAppointmentStatusViaApi(appointment.id, "cancel")
        : await setAssistantAppointmentStatusViaApi(appointment.id, "cancel");
    setSaving(false);
    if (!result.ok) {
      setError(result.error ?? "تعذر الإلغاء");
      return;
    }
    onSaved();
    onClose();
  }

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 sm:items-center">
      <div className="w-full max-w-md rounded-t-2xl bg-white p-6 shadow-2xl sm:rounded-2xl">
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-lg font-bold text-slate-800">إلغاء الحجز</h2>
          <button type="button" onClick={onClose} className="rounded-lg p-1 hover:bg-slate-100">
            <X className="h-5 w-5 text-slate-500" />
          </button>
        </div>
        <p className="mb-4 text-sm text-slate-600">
          المرحلة الأولى: سيتم إلغاء حجز{" "}
          <strong>{appointment.patient_name_ar}</strong> ويبقى في الجدول بحالة «ملغي».
          يمكنك حذفه لاحقاً من زر «حذف».
        </p>
        {error && (
          <p className="mb-3 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-600">{error}</p>
        )}
        <form onSubmit={handleSubmit} className="flex gap-2">
          <button
            type="button"
            onClick={onClose}
            className="flex-1 rounded-xl border border-slate-200 py-2.5 text-sm font-medium text-slate-700"
          >
            تراجع
          </button>
          <button
            type="submit"
            disabled={saving}
            className="flex flex-1 items-center justify-center gap-2 rounded-xl bg-amber-600 py-2.5 text-sm font-semibold text-white hover:bg-amber-700 disabled:opacity-60"
          >
            {saving ? <RefreshCw className="h-4 w-4 animate-spin" /> : null}
            إلغاء الحجز
          </button>
        </form>
      </div>
    </div>
  );
}
