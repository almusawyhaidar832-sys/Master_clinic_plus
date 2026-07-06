"use client";

import { useState } from "react";
import { X, RefreshCw } from "lucide-react";
import type { Appointment } from "@/types";
import { updateAssistantAppointmentViaApi } from "@/lib/services/assistant-appointments-client";
import { updateAccountantAppointmentViaApi } from "@/lib/services/accountant-appointments-client";
import { PatientSearchField } from "@/components/patients/PatientSearchField";
import {
  getPatientDisplayPhone,
  phoneToLocalDisplay,
  sanitizePatientPhoneInput,
  validatePatientPhone,
} from "@/lib/phone";
import { addMinutesToTime, DEFAULT_APPOINTMENT_SLOT_MINUTES } from "@/lib/utils";

interface EditAppointmentModalProps {
  appointment: Appointment;
  onClose: () => void;
  onSaved: () => void;
  portal?: "assistant" | "accountant";
}

export function EditAppointmentModal({
  appointment,
  onClose,
  onSaved,
  portal = "assistant",
}: EditAppointmentModalProps) {
  const [name, setName] = useState(appointment.patient_name_ar ?? "");
  const [selectedPatientId, setSelectedPatientId] = useState<string | null>(
    appointment.patient_id ?? null
  );
  const [phone, setPhone] = useState(phoneToLocalDisplay(appointment.patient_phone));
  const [date, setDate] = useState(appointment.appointment_date);
  const [appointmentTime, setAppointmentTime] = useState(
    appointment.start_time.slice(0, 5)
  );
  const [startTime, setStartTime] = useState(appointment.start_time.slice(0, 5));
  const [endTime, setEndTime] = useState(appointment.end_time.slice(0, 5));
  const [notes, setNotes] = useState(appointment.notes ?? "");
  const [reason, setReason] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    if (!reason.trim()) {
      setError("سبب التغيير مطلوب");
      return;
    }

    const phoneCheck = validatePatientPhone(phone);
    if (!phoneCheck.ok) {
      setError(phoneCheck.message);
      return;
    }

    setSaving(true);
    const resolvedStart =
      portal === "accountant" ? appointmentTime : startTime;
    const resolvedEnd =
      portal === "accountant"
        ? addMinutesToTime(appointmentTime, DEFAULT_APPOINTMENT_SLOT_MINUTES)
        : endTime;

    const payload = {
      patient_name_ar: name.trim(),
      patient_phone: phoneCheck.normalized,
      patient_id: selectedPatientId,
      appointment_date: date,
      start_time: resolvedStart,
      end_time: resolvedEnd,
      notes: notes.trim() || undefined,
      reason_for_change: reason.trim(),
    };
    const result =
      portal === "accountant"
        ? await updateAccountantAppointmentViaApi(appointment.id, payload)
        : await updateAssistantAppointmentViaApi(appointment.id, payload);
    setSaving(false);

    if (!result.ok) {
      setError(result.error ?? "تعذر التعديل");
      return;
    }
    onSaved();
    onClose();
  }

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 sm:items-center">
      <div className="max-h-[92vh] w-full max-w-lg overflow-y-auto rounded-t-2xl bg-white p-6 shadow-2xl sm:rounded-2xl">
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-lg font-bold text-slate-800">تعديل الموعد</h2>
          <button type="button" onClick={onClose} className="rounded-lg p-1 hover:bg-slate-100">
            <X className="h-5 w-5 text-slate-500" />
          </button>
        </div>

        {error && (
          <p className="mb-3 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-600">{error}</p>
        )}

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="mb-1 block text-sm font-medium text-slate-600">
              اسم المريض
            </label>
            <PatientSearchField
              portal={portal}
              doctorId={appointment.doctor_id}
              value={name}
              selectedPatientId={selectedPatientId}
              showIcon={false}
              required
              placeholder="اكتب حرفين من اسم مراجع هذا الطبيب..."
              inputClassName="rounded-xl border border-slate-200 bg-slate-50 px-4 py-2.5 text-sm"
              onChange={(v) => {
                setName(v);
                setSelectedPatientId(null);
              }}
              onSelect={(p) => {
                setSelectedPatientId(p.id);
                setName(p.full_name_ar);
                setPhone(phoneToLocalDisplay(getPatientDisplayPhone(p)));
              }}
            />
          </div>
          <div>
            <label className="mb-1 block text-sm font-medium text-slate-600">الهاتف</label>
            <input
              value={phone}
              onChange={(e) => setPhone(sanitizePatientPhoneInput(e.target.value))}
              required
              dir="ltr"
              inputMode="tel"
              placeholder="07801234567"
              className="w-full rounded-xl border border-slate-200 bg-slate-50 px-4 py-2.5 text-sm"
            />
            <p className="mt-1 text-xs text-slate-500">ابدأ بـ 078 أو 077</p>
          </div>
          <div>
            <label className="mb-1 block text-sm font-medium text-slate-600">التاريخ</label>
            <input
              type="date"
              value={date}
              onChange={(e) => setDate(e.target.value)}
              required
              className="w-full rounded-xl border border-slate-200 bg-slate-50 px-4 py-2.5 text-sm"
            />
          </div>
          {portal === "accountant" ? (
            <div>
              <label className="mb-1 block text-sm font-medium text-slate-600">
                وقت الموعد
              </label>
              <input
                type="time"
                value={appointmentTime}
                onChange={(e) => setAppointmentTime(e.target.value)}
                required
                className="w-full rounded-xl border border-slate-200 bg-slate-50 px-4 py-2.5 text-sm"
              />
            </div>
          ) : (
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="mb-1 block text-sm font-medium text-slate-600">من</label>
                <input
                  type="time"
                  value={startTime}
                  onChange={(e) => setStartTime(e.target.value)}
                  required
                  className="w-full rounded-xl border border-slate-200 bg-slate-50 px-4 py-2.5 text-sm"
                />
              </div>
              <div>
                <label className="mb-1 block text-sm font-medium text-slate-600">إلى</label>
                <input
                  type="time"
                  value={endTime}
                  onChange={(e) => setEndTime(e.target.value)}
                  required
                  className="w-full rounded-xl border border-slate-200 bg-slate-50 px-4 py-2.5 text-sm"
                />
              </div>
            </div>
          )}
          <div>
            <label className="mb-1 block text-sm font-medium text-slate-600">ملاحظات</label>
            <input
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              className="w-full rounded-xl border border-slate-200 bg-slate-50 px-4 py-2.5 text-sm"
            />
          </div>
          <div>
            <label className="mb-1 block text-sm font-medium text-amber-800">
              سبب التغيير *
            </label>
            <textarea
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              required
              rows={3}
              placeholder="مثال: بناءً على طلب المريض — تغيير الوقت"
              className="w-full rounded-xl border border-amber-200 bg-amber-50/50 px-4 py-2.5 text-sm"
            />
            <p className="mt-1 text-xs text-slate-500">
              يُرسل للمريض عبر واتساب مع تفاصيل الموعد الجديد
            </p>
          </div>
          <div className="flex gap-2 pt-2">
            <button
              type="submit"
              disabled={saving}
              className="flex flex-1 items-center justify-center gap-2 rounded-xl bg-teal-600 py-3 text-sm font-bold text-white disabled:opacity-60"
            >
              {saving && <RefreshCw className="h-4 w-4 animate-spin" />}
              حفظ التعديل
            </button>
            <button
              type="button"
              onClick={onClose}
              className="rounded-xl border border-slate-200 px-4 py-3 text-sm"
            >
              إلغاء
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
