"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { CalendarPlus, RefreshCw } from "lucide-react";
import { Modal } from "@/components/ui/Modal";
import { todayISO, addMinutesToTime, DEFAULT_APPOINTMENT_SLOT_MINUTES } from "@/lib/utils";
import { createAssistantAppointmentViaApi } from "@/lib/services/assistant-appointments-client";
import { createAccountantAppointmentViaApi } from "@/lib/services/accountant-appointments-client";
import { createClient } from "@/lib/supabase/client";
import { formatDoctorDisplayName } from "@/lib/services/clinic-profile";
import {
  validatePatientPhone,
  sanitizePatientPhoneInput,
  phoneToLocalDisplay,
  getPatientDisplayPhone,
} from "@/lib/phone";
import { describeWhatsAppDeliveryError } from "@/lib/whatsapp/delivery-errors";
import { Select } from "@/components/ui/Select";
import { PatientSearchField } from "@/components/patients/PatientSearchField";
import type { Doctor } from "@/types";

interface AddAppointmentModalProps {
  onClose: () => void;
  onSaved: (notice?: string) => void;
  portal?: "assistant" | "accountant";
  clinicId?: string | null;
}

export function AddAppointmentModal({
  onClose,
  onSaved,
  portal = "assistant",
  clinicId = null,
}: AddAppointmentModalProps) {
  const [name, setName] = useState("");
  const [selectedPatientId, setSelectedPatientId] = useState<string | null>(null);
  const [phone, setPhone] = useState("");
  const [doctorId, setDoctorId] = useState("");
  const [doctors, setDoctors] = useState<Doctor[]>([]);
  const [date, setDate] = useState(todayISO());
  const [appointmentTime, setAppointmentTime] = useState("10:00");
  const [startTime, setStartTime] = useState("10:00");
  const [endTime, setEndTime] = useState("10:30");
  const [notes, setNotes] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [whatsappNotice, setWhatsappNotice] = useState("");

  useEffect(() => {
    if (portal !== "accountant" || !clinicId) return;
    const supabase = createClient();
    supabase
      .from("doctors")
      .select("*")
      .eq("clinic_id", clinicId)
      .eq("is_active", true)
      .order("full_name_ar")
      .then(({ data }) => {
        const list = (data as Doctor[]) ?? [];
        setDoctors(list);
        if (list[0]?.id) setDoctorId(list[0].id);
      });
  }, [portal, clinicId]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    setWhatsappNotice("");
    if (!name.trim()) {
      setError("اسم المريض مطلوب");
      return;
    }
    if (!phone.trim()) {
      setError("هاتف المريض مطلوب");
      return;
    }
    const phoneCheck = validatePatientPhone(phone);
    if (!phoneCheck.ok) {
      setError(phoneCheck.message);
      return;
    }
    if (portal === "accountant" && !doctorId) {
      setError("اختر الطبيب");
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
    };

    const result =
      portal === "accountant"
        ? await createAccountantAppointmentViaApi({
            ...payload,
            doctor_id: doctorId,
          })
        : await createAssistantAppointmentViaApi(payload);

    setSaving(false);

    if (!result.ok) {
      setError(result.error ?? "تعذر الحفظ");
      return;
    }

    if ("whatsapp" in result && result.whatsapp) {
      const wa = result.whatsapp;
      if (wa.sent && !wa.deliveryWarning) {
        onSaved("تم حفظ الموعد وإرسال إشعار واتساب للمراجع.");
        onClose();
        return;
      }
      const notice = `تم حفظ الموعد، لكن لم تصل رسالة واتساب للمراجع: ${describeWhatsAppDeliveryError(
        wa.deliveryWarning ?? wa.error
      )}`;
      setWhatsappNotice(notice);
      onSaved(notice);
      return;
    }

    onSaved();
    onClose();
  }

  return (
    <Modal
      onClose={onClose}
      title={portal === "accountant" ? "حجز مراجع جديد" : "إضافة موعد"}
      icon={CalendarPlus}
      size="lg"
    >
        {error && (
          <p className="mb-4 rounded-xl border border-debt-border bg-debt px-3.5 py-2.5 text-sm text-debt-text">{error}</p>
        )}
        {whatsappNotice && (
          <p
            className={`mb-4 rounded-xl border px-3.5 py-2.5 text-sm ${
              whatsappNotice.includes("لم تصل")
                ? "border-warning-border bg-warning text-warning-text"
                : "border-success-border bg-success text-success-text"
            }`}
          >
            {whatsappNotice}
            {whatsappNotice.includes("لم تصل") && (
              <>
                {" "}
                <Link href="/dashboard/whatsapp" className="font-semibold underline">
                  إعدادات واتساب
                </Link>
              </>
            )}
          </p>
        )}

        <form onSubmit={handleSubmit} className="space-y-4">
          {portal === "accountant" && (
            <Select
              label="الطبيب"
              value={doctorId}
              onChange={(e) => {
                setDoctorId(e.target.value);
                setName("");
                setSelectedPatientId(null);
                setPhone("");
              }}
              placeholder="— اختر الطبيب —"
              options={doctors.map((d) => ({
                value: d.id,
                label: formatDoctorDisplayName(d.full_name_ar),
              }))}
            />
          )}
          <div>
            <label className="mb-1.5 block text-xs font-semibold text-slate-muted">
              اسم المريض
            </label>
            <PatientSearchField
              portal={portal}
              doctorId={portal === "accountant" ? doctorId || null : null}
              disabled={portal === "accountant" && !doctorId}
              value={name}
              selectedPatientId={selectedPatientId}
              showIcon={false}
              required
              placeholder={
                portal === "accountant" && !doctorId
                  ? "اختر الطبيب أولاً..."
                  : "اكتب حرفين من اسم مراجع هذا الطبيب..."
              }
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
          <div className="flex gap-2 border-t border-slate-border pt-4">
            <button
              type="submit"
              disabled={saving}
              className="mc-btn-navy flex-1 py-3"
            >
              {saving && <RefreshCw className="h-4 w-4 animate-spin" />}
              حفظ الموعد
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
