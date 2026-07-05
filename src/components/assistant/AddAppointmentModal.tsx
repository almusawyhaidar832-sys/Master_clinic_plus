"use client";

import { useEffect, useState } from "react";
import { X, RefreshCw } from "lucide-react";
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
      if (wa.sent) {
        onSaved("تم حفظ الموعد وأُرسلت رسالة واتساب للمراجع.");
        onClose();
        return;
      }
      const notice = `تم حفظ الموعد، لكن لم تصل رسالة واتساب للمراجع: ${describeWhatsAppDeliveryError(wa.error)}`;
      setWhatsappNotice(notice);
      onSaved(notice);
      return;
    }

    onSaved();
    onClose();
  }

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 sm:items-center">
      <div className="max-h-[92vh] w-full max-w-lg overflow-y-auto rounded-t-2xl bg-white p-6 shadow-2xl sm:rounded-2xl">
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-lg font-bold text-slate-800">
            {portal === "accountant" ? "حجز مراجع جديد" : "إضافة موعد"}
          </h2>
          <button type="button" onClick={onClose} className="rounded-lg p-1 hover:bg-slate-100">
            <X className="h-5 w-5 text-slate-500" />
          </button>
        </div>

        {error && (
          <p className="mb-3 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-600">{error}</p>
        )}
        {whatsappNotice && (
          <p
            className={`mb-3 rounded-lg px-3 py-2 text-sm ${
              whatsappNotice.includes("لم تصل")
                ? "bg-amber-50 text-amber-800"
                : "bg-emerald-50 text-emerald-800"
            }`}
          >
            {whatsappNotice}
            {whatsappNotice.includes("لم تصل") && (
              <>
                {" "}
                <a href="/dashboard/whatsapp" className="font-semibold underline">
                  إعدادات واتساب
                </a>
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
            <label className="mb-1 block text-sm font-medium text-slate-600">
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
          <div className="flex gap-2 pt-2">
            <button
              type="submit"
              disabled={saving}
              className="flex flex-1 items-center justify-center gap-2 rounded-xl bg-teal-600 py-3 text-sm font-bold text-white disabled:opacity-60"
            >
              {saving && <RefreshCw className="h-4 w-4 animate-spin" />}
              حفظ الموعد
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
