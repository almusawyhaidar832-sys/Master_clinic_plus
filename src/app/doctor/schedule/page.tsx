"use client";

import { useCallback, useEffect, useState } from "react";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { Card, CardHeader, CardTitle } from "@/components/ui/Card";
import { Alert } from "@/components/ui/Alert";
import { createClient } from "@/lib/supabase/client";
import { getDoctorForCurrentUser } from "@/lib/clinic-context";
import { formatTime, formatDate, todayISO } from "@/lib/utils";
import type { Appointment, Doctor, ScheduleLock } from "@/types";

const statusLabels: Record<string, string> = {
  scheduled: "مجدول",
  confirmed: "مؤكد",
  completed: "مكتمل",
  cancelled: "ملغي",
  no_show: "لم يحضر",
};

export default function DoctorSchedulePage() {
  const [doctor, setDoctor] = useState<Doctor | null>(null);
  const [appointments, setAppointments] = useState<Appointment[]>([]);
  const [locks, setLocks] = useState<ScheduleLock[]>([]);
  const [view, setView] = useState<"appointments" | "lock">("appointments");
  const [message, setMessage] = useState<string | null>(null);

  const [patientName, setPatientName] = useState("");
  const [patientPhone, setPatientPhone] = useState("");
  const [date, setDate] = useState(todayISO());
  const [startTime, setStartTime] = useState("10:00");
  const [endTime, setEndTime] = useState("10:30");
  const [lockReason, setLockReason] = useState("");

  const load = useCallback(async () => {
    const supabase = createClient();
    const doc = await getDoctorForCurrentUser(supabase);
    setDoctor(doc);
    if (!doc) return;

    const today = todayISO();
    const [aRes, lRes] = await Promise.all([
      supabase
        .from("appointments")
        .select("*")
        .eq("doctor_id", doc.id)
        .gte("appointment_date", today)
        .order("appointment_date")
        .order("start_time"),
      supabase
        .from("schedule_locks")
        .select("*")
        .eq("doctor_id", doc.id)
        .gte("lock_date", today),
    ]);
    setAppointments((aRes.data as Appointment[]) || []);
    setLocks((lRes.data as ScheduleLock[]) || []);
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  async function addAppointment(e: React.FormEvent) {
    e.preventDefault();
    if (!doctor) return;
    const supabase = createClient();
    const { error } = await supabase.from("appointments").insert({
      clinic_id: doctor.clinic_id,
      doctor_id: doctor.id,
      patient_name_ar: patientName,
      patient_phone: patientPhone || null,
      appointment_date: date,
      start_time: startTime,
      end_time: endTime,
      status: "scheduled",
    });
    setMessage(error ? "تعذر الحجز" : "تم إضافة الموعد");
    if (!error) {
      setPatientName("");
      setPatientPhone("");
      load();
    }
  }

  async function cancelAppointment(id: string) {
    const supabase = createClient();
    await supabase
      .from("appointments")
      .update({ status: "cancelled" })
      .eq("id", id);
    load();
  }

  async function confirmAppointment(appointment: Appointment) {
    const supabase = createClient();
    await supabase
      .from("appointments")
      .update({ status: "confirmed" })
      .eq("id", appointment.id);

    if (appointment.patient_phone && doctor) {
      await fetch("/api/whatsapp/send", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          type: "appointment_confirmation",
          phone: appointment.patient_phone,
          payload: {
            patientName: appointment.patient_name_ar ?? "عميلنا",
            date: formatDate(appointment.appointment_date),
            time: formatTime(appointment.start_time),
            doctorName: doctor.full_name_ar,
          },
        }),
      });
    }
    load();
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
      reason_ar: lockReason || "غير متاح",
    });
    setMessage(error ? "تعذر قفل الفترة" : "تم قفل الفترة");
    if (!error) load();
  }

  if (!doctor) {
    return (
      <Alert variant="warning">يجب ربط حسابك بسجل طبيب لإدارة المواعيد</Alert>
    );
  }

  return (
    <div className="space-y-4">
      <h2 className="text-lg font-bold text-slate-text">إدارة المواعيد</h2>

      <div className="flex gap-2">
        <Button
          size="sm"
          variant={view === "appointments" ? "primary" : "outline"}
          onClick={() => setView("appointments")}
        >
          مواعيد
        </Button>
        <Button
          size="sm"
          variant={view === "lock" ? "primary" : "outline"}
          onClick={() => setView("lock")}
        >
          قفل وقت
        </Button>
      </div>

      {message && <Alert variant="success">{message}</Alert>}

      {view === "appointments" ? (
        <>
          <Card>
            <CardHeader>
              <CardTitle className="text-base">موعد جديد</CardTitle>
            </CardHeader>
            <form onSubmit={addAppointment} className="space-y-3">
              <Input
                label="اسم المريض"
                value={patientName}
                onChange={(e) => setPatientName(e.target.value)}
                required
              />
              <Input
                label="الهاتف"
                value={patientPhone}
                onChange={(e) => setPatientPhone(e.target.value)}
                dir="ltr"
                className="text-left"
              />
              <Input
                label="التاريخ"
                type="date"
                value={date}
                onChange={(e) => setDate(e.target.value)}
                dir="ltr"
                className="text-left"
              />
              <div className="grid grid-cols-2 gap-2">
                <Input
                  label="من"
                  type="time"
                  value={startTime}
                  onChange={(e) => setStartTime(e.target.value)}
                  dir="ltr"
                  className="text-left"
                />
                <Input
                  label="إلى"
                  type="time"
                  value={endTime}
                  onChange={(e) => setEndTime(e.target.value)}
                  dir="ltr"
                  className="text-left"
                />
              </div>
              <Button type="submit" className="w-full">
                حفظ الموعد
              </Button>
            </form>
          </Card>

          <div className="space-y-2">
            <h3 className="font-semibold text-sm">المواعيد القادمة</h3>
            {appointments.length === 0 ? (
              <p className="text-sm text-slate-muted">لا توجد مواعيد</p>
            ) : (
              appointments.map((a) => (
                <Card key={a.id} className="p-3">
                  <p className="font-medium">{a.patient_name_ar}</p>
                  <p className="text-xs text-slate-muted">
                    {a.appointment_date} — {formatTime(a.start_time)} -{" "}
                    {formatTime(a.end_time)}
                  </p>
                  <p className="text-xs text-primary">
                    {statusLabels[a.status] ?? a.status}
                  </p>
                  {a.status !== "cancelled" && (
                    <div className="mt-2 flex gap-2">
                      {a.status === "scheduled" && (
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => confirmAppointment(a)}
                        >
                          تأكيد
                        </Button>
                      )}
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => cancelAppointment(a.id)}
                      >
                        إلغاء
                      </Button>
                    </div>
                  )}
                </Card>
              ))
            )}
          </div>
        </>
      ) : (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">قفل فترة زمنية</CardTitle>
          </CardHeader>
          <form onSubmit={addLock} className="space-y-3">
            <Input
              label="التاريخ"
              type="date"
              value={date}
              onChange={(e) => setDate(e.target.value)}
              dir="ltr"
              className="text-left"
            />
            <div className="grid grid-cols-2 gap-2">
              <Input
                label="من"
                type="time"
                value={startTime}
                onChange={(e) => setStartTime(e.target.value)}
                dir="ltr"
                className="text-left"
              />
              <Input
                label="إلى"
                type="time"
                value={endTime}
                onChange={(e) => setEndTime(e.target.value)}
                dir="ltr"
                className="text-left"
              />
            </div>
            <Input
              label="السبب"
              value={lockReason}
              onChange={(e) => setLockReason(e.target.value)}
            />
            <Button type="submit" className="w-full">
              قفل الفترة
            </Button>
          </form>
          {locks.length > 0 && (
            <ul className="mt-4 space-y-2 text-sm">
              {locks.map((l) => (
                <li key={l.id} className="rounded bg-surface p-2">
                  {l.lock_date} {formatTime(l.start_time)} -{" "}
                  {formatTime(l.end_time)} — {l.reason_ar}
                </li>
              ))}
            </ul>
          )}
        </Card>
      )}
    </div>
  );
}
