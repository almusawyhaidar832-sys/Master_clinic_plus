"use client";

import { useState } from "react";
import { CalendarCog, RefreshCw } from "lucide-react";
import { Modal } from "@/components/ui/Modal";
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
    <Modal onClose={onClose} title="تعديل الموعد" icon={CalendarCog} size="lg">
        {error && (
          <p className="mb-4 rounded-xl border border-debt-border bg-debt px-3.5 py-2.5 text-sm text-debt-text">{error}</p>
        )}

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="mb-1.5 block text-xs font-semibold text-slate-muted">
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
              inputClassName="mc-field"
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
            <label className="mb-1.5 block text-xs font-semibold text-slate-muted">الهاتف</label>
            <input
              value={phone}
              onChange={(e) => setPhone(sanitizePatientPhoneInput(e.target.value))}
              required
              dir="ltr"
              inputMode="tel"
              placeholder="07801234567"
              className="mc-field"
            />
            <p className="mt-1 text-xs text-slate-muted">ابدأ بـ 078 أو 077</p>
          </div>
          <div>
            <label className="mb-1.5 block text-xs font-semibold text-slate-muted">التاريخ</label>
            <input
              type="date"
              value={date}
              onChange={(e) => setDate(e.target.value)}
              required
              className="mc-field"
            />
          </div>
          {portal === "accountant" ? (
            <div>
              <label className="mb-1.5 block text-xs font-semibold text-slate-muted">
                وقت الموعد
              </label>
              <input
                type="time"
                value={appointmentTime}
                onChange={(e) => setAppointmentTime(e.target.value)}
                required
                className="mc-field"
              />
            </div>
          ) : (
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="mb-1.5 block text-xs font-semibold text-slate-muted">من</label>
                <input
                  type="time"
                  value={startTime}
                  onChange={(e) => setStartTime(e.target.value)}
                  required
                  className="mc-field"
                />
              </div>
              <div>
                <label className="mb-1.5 block text-xs font-semibold text-slate-muted">إلى</label>
                <input
                  type="time"
                  value={endTime}
                  onChange={(e) => setEndTime(e.target.value)}
                  required
                  className="mc-field"
                />
              </div>
            </div>
          )}
          <div>
            <label className="mb-1.5 block text-xs font-semibold text-slate-muted">ملاحظات</label>
            <input
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              className="mc-field"
            />
          </div>
          <div className="rounded-2xl border border-premium-200 bg-premium-50/60 p-3.5">
            <label className="mb-1.5 block text-xs font-bold text-premium-700">
              سبب التغيير *
            </label>
            <textarea
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              required
              rows={3}
              placeholder="مثال: بناءً على طلب المريض — تغيير الوقت"
              className="mc-field"
            />
            <p className="mt-1.5 text-xs text-slate-muted">
              يُرسل للمريض عبر واتساب مع تفاصيل الموعد الجديد
            </p>
          </div>
          <div className="flex gap-2 border-t border-slate-border pt-4">
            <button
              type="submit"
              disabled={saving}
              className="mc-btn-navy flex-1 py-3"
            >
              {saving && <RefreshCw className="h-4 w-4 animate-spin" />}
              حفظ التعديل
            </button>
            <button
              type="button"
              onClick={onClose}
              className="mc-btn-soft px-5 py-3"
            >
              إلغاء
            </button>
          </div>
        </form>
    </Modal>
  );
}
