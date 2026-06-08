"use client";

import { useState } from "react";
import { X, RefreshCw } from "lucide-react";
import type { Appointment } from "@/types";
import { setAssistantAppointmentStatusViaApi } from "@/lib/services/assistant-appointments-client";
import { setAccountantAppointmentStatusViaApi } from "@/lib/services/accountant-appointments-client";

interface RejectAppointmentModalProps {
  appointment: Appointment;
  onClose: () => void;
  onSaved: () => void;
  portal?: "assistant" | "accountant";
}

export function RejectAppointmentModal({
  appointment,
  onClose,
  onSaved,
  portal = "assistant",
}: RejectAppointmentModalProps) {
  const [reason, setReason] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!reason.trim()) {
      setError("سبب الرفض مطلوب");
      return;
    }
    setSaving(true);
    const result =
      portal === "accountant"
        ? await setAccountantAppointmentStatusViaApi(
            appointment.id,
            "reject",
            reason.trim()
          )
        : await setAssistantAppointmentStatusViaApi(
            appointment.id,
            "reject",
            reason.trim()
          );
    setSaving(false);
    if (!result.ok) {
      setError(result.error ?? "تعذر الرفض");
      return;
    }
    onSaved();
    onClose();
  }

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 sm:items-center">
      <div className="w-full max-w-md rounded-t-2xl bg-white p-6 shadow-2xl sm:rounded-2xl">
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-lg font-bold text-slate-800">رفض طلب الحجز</h2>
          <button type="button" onClick={onClose} className="rounded-lg p-1 hover:bg-slate-100">
            <X className="h-5 w-5 text-slate-500" />
          </button>
        </div>
        <p className="mb-3 text-sm text-slate-600">
          {appointment.patient_name_ar} — سيتم إشعار المريض عبر واتساب
        </p>
        {error && (
          <p className="mb-3 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-600">{error}</p>
        )}
        <form onSubmit={handleSubmit} className="space-y-4">
          <textarea
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            required
            rows={3}
            placeholder="سبب الرفض..."
            className="w-full rounded-xl border border-slate-200 bg-slate-50 px-4 py-2.5 text-sm"
          />
          <div className="flex gap-2">
            <button
              type="submit"
              disabled={saving}
              className="flex flex-1 items-center justify-center gap-2 rounded-xl bg-red-600 py-3 text-sm font-bold text-white disabled:opacity-60"
            >
              {saving && <RefreshCw className="h-4 w-4 animate-spin" />}
              تأكيد الرفض
            </button>
            <button type="button" onClick={onClose} className="rounded-xl border px-4 py-3 text-sm">
              إلغاء
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
