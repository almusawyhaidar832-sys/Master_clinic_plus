"use client";

import { useCallback, useEffect, useState } from "react";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { Card, CardHeader, CardTitle } from "@/components/ui/Card";
import { Alert } from "@/components/ui/Alert";
import { createClient } from "@/lib/supabase/client";
import { getDoctorForCurrentUser } from "@/lib/clinic-context";
import { createDoctorAppointmentViaApi } from "@/lib/services/doctor-appointments-client";
import { validatePatientPhone } from "@/lib/phone";
import { describeWhatsAppDeliveryError } from "@/lib/whatsapp/delivery-errors";
import { formatTime, todayISO } from "@/lib/utils";
import { DoctorAppointmentsPanel } from "@/components/appointments/DoctorAppointmentsPanel";
import type { Doctor, ScheduleLock } from "@/types";

export default function DoctorSchedulePage() {
  const [doctor, setDoctor] = useState<Doctor | null>(null);
  const [locks, setLocks] = useState<ScheduleLock[]>([]);
  const [view, setView] = useState<"appointments" | "lock">("appointments");
  const [message, setMessage] = useState<string | null>(null);

  const [patientName, setPatientName] = useState("");
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
      setMessage("رقم جوال المراجع مطلوب لإرسال تأكيد واتساب");
      return;
    }
    const phoneCheck = validatePatientPhone(patientPhone);
    if (!phoneCheck.ok) {
      setMessage(phoneCheck.message);
      return;
    }

    const result = await createDoctorAppointmentViaApi({
      patient_name_ar: patientName.trim(),
      patient_phone: patientPhone.trim(),
      appointment_date: date,
      start_time: startTime,
      end_time: endTime,
    });

    if (!result.ok) {
      setMessage(result.error ?? "تعذر الحجز");
      return;
    }

    if (result.whatsapp?.sent) {
      setMessage("تم إضافة الموعد وإرسال تأكيد واتساب للمراجع");
    } else {
      setMessage(
        `تم إضافة الموعد — لم تصل رسالة واتساب: ${describeWhatsAppDeliveryError(result.whatsapp?.error)}`
      );
    }

    setPatientName("");
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
      reason_ar: lockReason || "محجوز",
    });
    setMessage(error ? "تعذر قفل الوقت" : "تم قفل الفترة");
    if (!error) {
      setLockReason("");
      loadLocks();
    }
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
                required
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

          <DoctorAppointmentsPanel />
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
