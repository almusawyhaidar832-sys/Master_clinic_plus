"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { ArrowRight, Building2, Calendar, CheckCircle2 } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { Select } from "@/components/ui/Select";
import { Alert } from "@/components/ui/Alert";
import { validatePatientPhone } from "@/lib/phone";
import { describeWhatsAppDeliveryError } from "@/lib/whatsapp/delivery-errors";
import { todayISO } from "@/lib/utils";
import type { ResolvedBookingClinic } from "@/lib/booking/types";

interface BookingFormProps {
  clinicRef: string;
}

export function BookingForm({ clinicRef }: BookingFormProps) {
  const [clinic, setClinic] = useState<ResolvedBookingClinic | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [doctorId, setDoctorId] = useState("");
  const [patientName, setPatientName] = useState("");
  const [patientPhone, setPatientPhone] = useState("");
  const [date, setDate] = useState(todayISO());
  const [startTime, setStartTime] = useState("10:00");
  const [endTime, setEndTime] = useState("10:30");
  const [notes, setNotes] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [success, setSuccess] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      setLoading(true);
      setError(null);
      try {
        const res = await fetch(
          `/api/booking/clinic?clinic=${encodeURIComponent(clinicRef)}`
        );
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || "تعذر تحميل العيادة");
        if (!cancelled) {
          setClinic(data.clinic);
          if (data.clinic?.doctors?.length === 1) {
            setDoctorId(data.clinic.doctors[0].id);
          }
        }
      } catch (e) {
        if (!cancelled) {
          setError(e instanceof Error ? e.message : "تعذر تحميل العيادة");
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    load();
    return () => {
      cancelled = true;
    };
  }, [clinicRef]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!clinic) return;

    if (!patientPhone.trim()) {
      setError("رقم الجوال مطلوب لتأكيد الحجز عبر واتساب");
      return;
    }
    const phoneCheck = validatePatientPhone(patientPhone);
    if (!phoneCheck.ok) {
      setError(phoneCheck.message);
      return;
    }

    setSubmitting(true);
    setError(null);
    setSuccess(null);

    try {
      const res = await fetch("/api/booking/appointments", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          clinic: clinic.bookingCode,
          doctorId,
          patientName,
          patientPhone: patientPhone.trim(),
          appointmentDate: date,
          startTime,
          endTime,
          notes: notes || null,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "تعذر إتمام الحجز");

      if (data.whatsapp?.sent) {
        setSuccess(
          `تم تسجيل طلب الحجز في ${data.clinicName} — وصلتك رسالة واتساب بالتفاصيل. سيتواصل معك الفريق قريباً للتأكيد.`
        );
      } else {
        setSuccess(
          `تم تسجيل موعدك في ${data.clinicName}. لم تصل رسالة واتساب: ${describeWhatsAppDeliveryError(data.whatsapp?.error)}`
        );
      }
      setPatientName("");
      setPatientPhone("");
      setNotes("");
    } catch (e) {
      setError(e instanceof Error ? e.message : "تعذر إتمام الحجز");
    } finally {
      setSubmitting(false);
    }
  }

  if (loading) {
    return (
      <div className="mx-auto w-full max-w-lg space-y-4">
        <div className="h-20 animate-pulse rounded-xl bg-surface-card" />
        <div className="h-64 animate-pulse rounded-xl bg-surface-card" />
      </div>
    );
  }

  if (error && !clinic) {
    return (
      <div className="mx-auto w-full max-w-lg text-center">
        <Alert variant="error" className="mb-4">{error}</Alert>
        <Link
          href="/booking"
          className="inline-flex items-center gap-2 text-teal-600 hover:underline"
        >
          <ArrowRight className="h-4 w-4" />
          اختر عيادة أخرى
        </Link>
      </div>
    );
  }

  if (!clinic) return null;

  const displayName = clinic.nameAr || clinic.name;

  const inputMobile =
    "min-h-[3rem] text-base sm:text-sm touch-target";

  return (
    <div className="mx-auto w-full max-w-lg pb-4">
      <Link
        href="/booking"
        className="mb-4 inline-flex items-center gap-1 text-sm text-slate-muted hover:text-teal-600"
      >
        <ArrowRight className="h-4 w-4" />
        تغيير العيادة
      </Link>

      <div className="mb-6 flex items-center gap-4 rounded-xl border border-teal-200/60 bg-teal-50/50 p-4">
        {clinic.logoUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={clinic.logoUrl}
            alt=""
            className="h-14 w-14 rounded-xl object-cover"
          />
        ) : (
          <div className="flex h-14 w-14 items-center justify-center rounded-xl bg-teal-500/15 text-teal-600">
            <Building2 className="h-7 w-7" />
          </div>
        )}
        <div>
          <h1 className="text-xl font-bold text-slate-text">{displayName}</h1>
          {clinic.address && (
            <p className="text-sm text-slate-muted">{clinic.address}</p>
          )}
          {clinic.phone && (
            <p className="text-sm text-slate-muted" dir="ltr">
              {clinic.phone}
            </p>
          )}
        </div>
      </div>

      {success ? (
        <div className="rounded-xl border border-green-200 bg-green-50 p-6 text-center">
          <CheckCircle2 className="mx-auto mb-3 h-12 w-12 text-green-600" />
          <p className="font-medium text-green-800">{success}</p>
          <Button
            type="button"
            variant="outline"
            className="mt-4"
            onClick={() => setSuccess(null)}
          >
            حجز موعد آخر
          </Button>
        </div>
      ) : (
        <form
          onSubmit={handleSubmit}
          className="space-y-4 rounded-xl border border-slate-200/80 bg-surface-card p-4 shadow-sm sm:p-5"
        >
          <div className="flex items-center gap-2 text-slate-text">
            <Calendar className="h-5 w-5 text-teal-600" />
            <h2 className="font-semibold">تفاصيل الموعد</h2>
          </div>

          {error && <Alert variant="error">{error}</Alert>}

          {clinic.doctors.length === 0 ? (
            <Alert variant="warning">
              لا يوجد أطباء متاحون للحجز حالياً. تواصل مع العيادة مباشرة.
            </Alert>
          ) : (
            <>
              <Select
                label="الطبيب"
                value={doctorId}
                onChange={(e) => setDoctorId(e.target.value)}
                placeholder="اختر الطبيب"
                required
                options={clinic.doctors.map((d) => ({
                  value: d.id,
                  label: `${d.fullNameAr}${d.specialtyAr ? ` — ${d.specialtyAr}` : ""}`,
                }))}
              />

              <div>
                <label className="mb-1 block text-sm font-medium text-slate-text">
                  اسم المريض
                </label>
                <Input
                  value={patientName}
                  onChange={(e) => setPatientName(e.target.value)}
                  placeholder="الاسم الكامل"
                  required
                  autoComplete="name"
                  className={inputMobile}
                />
              </div>

              <div>
                <label className="mb-1 block text-sm font-medium text-slate-text">
                  رقم الهاتف
                </label>
                <Input
                  value={patientPhone}
                  onChange={(e) => setPatientPhone(e.target.value)}
                  placeholder="07xxxxxxxx"
                  dir="ltr"
                  type="tel"
                  inputMode="tel"
                  autoComplete="tel"
                  required
                  className={`text-left ${inputMobile}`}
                />
              </div>

              <div>
                <label className="mb-1 block text-sm font-medium text-slate-text">
                  التاريخ
                </label>
                <Input
                  type="date"
                  value={date}
                  min={todayISO()}
                  onChange={(e) => setDate(e.target.value)}
                  required
                  className={inputMobile}
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="mb-1 block text-sm font-medium text-slate-text">
                    من
                  </label>
                  <Input
                    type="time"
                    value={startTime}
                    onChange={(e) => setStartTime(e.target.value)}
                    required
                    className={inputMobile}
                  />
                </div>
                <div>
                  <label className="mb-1 block text-sm font-medium text-slate-text">
                    إلى
                  </label>
                  <Input
                    type="time"
                    value={endTime}
                    onChange={(e) => setEndTime(e.target.value)}
                    required
                    className={inputMobile}
                  />
                </div>
              </div>

              <div>
                <label className="mb-1 block text-sm font-medium text-slate-text">
                  ملاحظات (اختياري)
                </label>
                <Input
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  placeholder="سبب الزيارة أو ملاحظة للعيادة"
                  className={inputMobile}
                />
              </div>

              <Button
                type="submit"
                className="touch-target w-full bg-teal-600 py-3 text-base hover:bg-teal-700"
                disabled={submitting || !doctorId}
              >
                {submitting ? "جاري الحجز..." : "تأكيد الحجز"}
              </Button>
            </>
          )}
        </form>
      )}
    </div>
  );
}
