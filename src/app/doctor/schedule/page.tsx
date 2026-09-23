"use client";

import { useCallback, useEffect, useState } from "react";
import { Input } from "@/components/ui/Input";
import { Alert } from "@/components/ui/Alert";
import { PageHeader } from "@/components/ui/PageHeader";
import { CalendarCheck, CalendarClock, CalendarPlus, Lock } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { getDoctorForCurrentUser } from "@/lib/clinic-context";
import { createDoctorAppointmentViaApi } from "@/lib/services/doctor-appointments-client";
import { validatePatientPhone } from "@/lib/phone";
import { describeWhatsAppDeliveryError } from "@/lib/whatsapp/delivery-errors";
import { cn, formatTime, todayISO } from "@/lib/utils";
import { DoctorAppointmentsPanel } from "@/components/appointments/DoctorAppointmentsPanel";
import { PatientSearchField } from "@/components/patients/PatientSearchField";
import { getPatientDisplayPhone } from "@/lib/phone";
import { useLanguage } from "@/contexts/LanguageContext";
import type { Doctor, ScheduleLock } from "@/types";

export default function DoctorSchedulePage() {
  const { t, bi } = useLanguage();
  const [doctor, setDoctor] = useState<Doctor | null>(null);
  const [locks, setLocks] = useState<ScheduleLock[]>([]);
  const [view, setView] = useState<"appointments" | "lock">("appointments");
  const [message, setMessage] = useState<string | null>(null);

  const [patientName, setPatientName] = useState("");
  const [selectedPatientId, setSelectedPatientId] = useState<string | null>(null);
  const [patientPhone, setPatientPhone] = useState("");
  const [date, setDate] = useState(todayISO());
  const [startTime, setStartTime] = useState("10:00");
  const [endTime, setEndTime] = useState("10:30");
  const [lockReason, setLockReason] = useState("");

  const loadLocks = useCallback(async () => {
    const supabase = createClient();
    const doc = await getDoctorForCurrentUser(supabase);
    setDoctor(doc);
    if (!doc) return;

    const today = todayISO();
    const { data } = await supabase
      .from("schedule_locks")
      .select("*")
      .eq("clinic_id", doc.clinic_id)
      .eq("doctor_id", doc.id)
      .gte("lock_date", today);

    setLocks((data as ScheduleLock[]) || []);
  }, []);

  useEffect(() => {
    loadLocks();
  }, [loadLocks]);

  async function addAppointment(e: React.FormEvent) {
    e.preventDefault();
    if (!doctor) return;

    if (!patientPhone.trim()) {
      setMessage(t("docPhoneRequiredWhatsApp"));
      return;
    }
    const phoneCheck = validatePatientPhone(patientPhone);
    if (!phoneCheck.ok) {
      setMessage(phoneCheck.message);
      return;
    }

    const result = await createDoctorAppointmentViaApi({
      patient_name_ar: patientName.trim(),
      patient_phone: phoneCheck.normalized,
      patient_id: selectedPatientId,
      appointment_date: date,
      start_time: startTime,
      end_time: endTime,
    });

    if (!result.ok) {
      setMessage(result.error ?? t("docBookingFailed"));
      return;
    }

    if (result.whatsapp?.sent) {
      setMessage(t("docAppointmentAddedWhatsApp"));
    } else {
      setMessage(
        `${t("docAppointmentAddedNoWhatsApp")} ${describeWhatsAppDeliveryError(result.whatsapp?.error)}`
      );
    }

    setPatientName("");
    setSelectedPatientId(null);
    setPatientPhone("");
  }

  async function addLock(e: React.FormEvent) {
    e.preventDefault();
    if (!doctor) return;
    const supabase = createClient();
    const { error } = await supabase.from("schedule_locks").insert({
      clinic_id: doctor.clinic_id,
      doctor_id: doctor.id,
      lock_date: date,
      start_time: startTime,
      end_time: endTime,
      reason_ar: lockReason || t("docReservedDefault"),
    });
    setMessage(error ? t("docLockFailed") : t("docLockSuccess"));
    if (!error) {
      setLockReason("");
      loadLocks();
    }
  }

  return (
    <div className="space-y-5 animate-fade-in">
      <PageHeader
        title={t("docScheduleTitle")}
        eyebrow={bi("بوابة الطبيب", "Doctor portal")}
        icon={CalendarClock}
        className="!mb-0"
      />

      <div className="mc-tab-group">
        <button
          type="button"
          className={cn("mc-tab min-h-[44px]", view === "appointments" && "mc-tab--active")}
          onClick={() => setView("appointments")}
        >
          <CalendarPlus className="h-4 w-4 shrink-0" />
          {t("docTabAppointments")}
        </button>
        <button
          type="button"
          className={cn("mc-tab min-h-[44px]", view === "lock" && "mc-tab--active")}
          onClick={() => setView("lock")}
        >
          <Lock className="h-4 w-4 shrink-0" />
          {t("docTabLockTime")}
        </button>
      </div>

      {message && <Alert variant="success">{message}</Alert>}

      {view === "appointments" ? (
        <>
          <section className="mc-panel !overflow-visible">
            <div className="mc-panel-head !px-4 rounded-t-2xl">
              <h3 className="mc-panel-title no-accent">
                <CalendarPlus />
                {t("docNewAppointment")}
              </h3>
            </div>
            <form onSubmit={addAppointment} className="space-y-3.5 p-4">
              <div>
                <label className="mc-label mb-1.5 block">
                  {t("docPatientNameLabel")}
                </label>
                <PatientSearchField
                  portal="doctor"
                  value={patientName}
                  selectedPatientId={selectedPatientId}
                  showIcon={false}
                  required
                  placeholder={t("docSearchPastPatient")}
                  onChange={(v) => {
                    setPatientName(v);
                    setSelectedPatientId(null);
                  }}
                  onSelect={(p) => {
                    setSelectedPatientId(p.id);
                    setPatientName(p.full_name_ar);
                    setPatientPhone(getPatientDisplayPhone(p) ?? "");
                  }}
                />
              </div>
              <Input
                label={t("phone")}
                value={patientPhone}
                onChange={(e) => setPatientPhone(e.target.value)}
                dir="ltr"
                className="h-11 rounded-xl text-left"
                required
              />
              <div className="rounded-2xl border border-slate-border bg-surface p-3">
                <Input
                  label={t("expenseDate")}
                  type="date"
                  value={date}
                  onChange={(e) => setDate(e.target.value)}
                  dir="ltr"
                  className="h-11 rounded-xl text-left"
                />
                <div className="mt-3 grid grid-cols-2 gap-2.5">
                  <Input
                    label={bi("من", "From")}
                    type="time"
                    value={startTime}
                    onChange={(e) => setStartTime(e.target.value)}
                    dir="ltr"
                    className="h-11 rounded-xl text-left"
                  />
                  <Input
                    label={bi("إلى", "To")}
                    type="time"
                    value={endTime}
                    onChange={(e) => setEndTime(e.target.value)}
                    dir="ltr"
                    className="h-11 rounded-xl text-left"
                  />
                </div>
              </div>
              <button type="submit" className="mc-btn-navy min-h-[50px] w-full rounded-2xl text-[15px]">
                <CalendarCheck className="h-4 w-4 text-premium-300" />
                {t("docSaveAppointment")}
              </button>
            </form>
          </section>

          <DoctorAppointmentsPanel />
        </>
      ) : (
        <section className="mc-panel">
          <div className="mc-panel-head !px-4">
            <h3 className="mc-panel-title no-accent">
              <Lock />
              {t("docLockTimeSlot")}
            </h3>
          </div>
          <form onSubmit={addLock} className="space-y-3.5 p-4">
            <div className="rounded-2xl border border-slate-border bg-surface p-3">
              <Input
                label={t("expenseDate")}
                type="date"
                value={date}
                onChange={(e) => setDate(e.target.value)}
                dir="ltr"
                className="h-11 rounded-xl text-left"
              />
              <div className="mt-3 grid grid-cols-2 gap-2.5">
                <Input
                  label={bi("من", "From")}
                  type="time"
                  value={startTime}
                  onChange={(e) => setStartTime(e.target.value)}
                  dir="ltr"
                  className="h-11 rounded-xl text-left"
                />
                <Input
                  label={bi("إلى", "To")}
                  type="time"
                  value={endTime}
                  onChange={(e) => setEndTime(e.target.value)}
                  dir="ltr"
                  className="h-11 rounded-xl text-left"
                />
              </div>
            </div>
            <Input
              label={t("docReasonLabel")}
              value={lockReason}
              onChange={(e) => setLockReason(e.target.value)}
              className="h-11 rounded-xl"
            />
            <button type="submit" className="mc-btn-navy min-h-[50px] w-full rounded-2xl text-[15px]">
              <Lock className="h-4 w-4 text-premium-300" />
              {t("docLockPeriodBtn")}
            </button>
          </form>
          {locks.length > 0 && (
            <ul className="divide-y divide-slate-border border-t border-slate-border">
              {locks.map((l) => (
                <li key={l.id} className="flex min-h-[60px] items-center gap-3 px-4 py-3">
                  <span className="mc-kpi__icon mc-tone-royal h-10 w-10 rounded-xl">
                    <Lock className="h-4 w-4" />
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-bold text-slate-text">{l.reason_ar}</p>
                    <p className="mt-0.5 text-[11px] text-slate-muted tabular-nums" dir="ltr">
                      {l.lock_date}
                    </p>
                  </div>
                  <span
                    className="shrink-0 rounded-xl border border-slate-border bg-surface px-2.5 py-1 text-xs font-semibold tabular-nums text-slate-text"
                    dir="ltr"
                  >
                    {formatTime(l.start_time)} - {formatTime(l.end_time)}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </section>
      )}
    </div>
  );
}
