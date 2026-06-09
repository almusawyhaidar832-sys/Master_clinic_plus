"use client";

import { useEffect, useMemo, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { useActiveClinicId } from "@/hooks/useActiveClinicId";
import { useAppointmentSchedule } from "@/hooks/useAppointmentSchedule";
import {
  APPOINTMENT_STATUS_COLORS,
  APPOINTMENT_STATUS_LABELS,
} from "@/components/appointments/appointment-constants";
import { formatDoctorDisplayName } from "@/lib/services/clinic-profile";
import { formatDate, formatTime, localDateISO, todayISO } from "@/lib/utils";
import { cn } from "@/lib/utils";
import { Select } from "@/components/ui/Select";
import { CalendarRange, RefreshCw } from "lucide-react";
import { EditAppointmentModal } from "@/components/assistant/EditAppointmentModal";
import { AppointmentScheduleActionsModal } from "@/components/appointments/AppointmentScheduleActionsModal";
import type { AppointmentWithDoctor } from "@/hooks/useCentralizedAppointments";
import type { Doctor } from "@/types";

type RangePreset = "today" | "this_week" | "next_week" | "custom";

function addDaysISO(iso: string, days: number): string {
  const d = new Date(`${iso}T12:00:00`);
  d.setDate(d.getDate() + days);
  return localDateISO(d);
}

function weekBoundsFrom(base: string): { from: string; to: string } {
  return { from: base, to: addDaysISO(base, 6) };
}

const PRESET_LABELS: Record<Exclude<RangePreset, "custom">, string> = {
  today: "اليوم",
  this_week: "هذا الأسبوع",
  next_week: "الأسبوع القادم",
};

export function AppointmentScheduleView() {
  const { clinicId, loading: clinicLoading, missingClinic } = useActiveClinicId();
  const [preset, setPreset] = useState<RangePreset>("this_week");
  const [dateFrom, setDateFrom] = useState(todayISO());
  const [dateTo, setDateTo] = useState(addDaysISO(todayISO(), 6));
  const [doctorId, setDoctorId] = useState("");
  const [doctors, setDoctors] = useState<Doctor[]>([]);
  const [selected, setSelected] = useState<AppointmentWithDoctor | null>(null);
  const [editing, setEditing] = useState<AppointmentWithDoctor | null>(null);

  useEffect(() => {
    if (!clinicId) return;
    const supabase = createClient();
    supabase
      .from("doctors")
      .select("*")
      .eq("clinic_id", clinicId)
      .eq("is_active", true)
      .order("full_name_ar")
      .then(({ data }) => setDoctors((data as Doctor[]) ?? []));
  }, [clinicId]);

  function applyPreset(next: RangePreset) {
    setPreset(next);
    const today = todayISO();
    if (next === "today") {
      setDateFrom(today);
      setDateTo(today);
      return;
    }
    if (next === "this_week") {
      const w = weekBoundsFrom(today);
      setDateFrom(w.from);
      setDateTo(w.to);
      return;
    }
    if (next === "next_week") {
      const w = weekBoundsFrom(addDaysISO(today, 7));
      setDateFrom(w.from);
      setDateTo(w.to);
    }
  }

  const effectiveFrom = dateFrom;
  const effectiveTo = dateTo >= dateFrom ? dateTo : dateFrom;

  const { appointments, loading, refresh } = useAppointmentSchedule({
    clinicId,
    dateFrom: effectiveFrom,
    dateTo: effectiveTo,
    doctorId: doctorId || null,
    enabled: Boolean(clinicId),
  });

  const rangeLabel = useMemo(() => {
    if (effectiveFrom === effectiveTo) return formatDate(effectiveFrom);
    return `${formatDate(effectiveFrom)} — ${formatDate(effectiveTo)}`;
  }, [effectiveFrom, effectiveTo]);

  if (clinicLoading) {
    return (
      <div className="flex justify-center py-16">
        <RefreshCw className="h-6 w-6 animate-spin text-primary" />
      </div>
    );
  }

  if (!clinicId) {
    return (
      <div className="rounded-2xl border border-amber-200 bg-amber-50 p-6 text-center text-sm text-amber-800">
        {missingClinic
          ? "حسابك غير مربوط بعيادة — تواصل مع الإدارة"
          : "تعذر تحميل بيانات العيادة"}
      </div>
    );
  }

  return (
    <div className="space-y-5">
      <div>
        <h1 className="flex items-center gap-2 text-2xl font-bold text-slate-text">
          <CalendarRange className="h-7 w-7 text-primary" />
          جدول المواعيد
        </h1>
        <p className="mt-1 text-sm text-slate-muted">
          عرض أجندة الحجوزات حسب التاريخ والطبيب — اضغط على أي موعد لفتح ملف المريض أو
          تعديله
        </p>
      </div>

      <div className="rounded-2xl border border-slate-border bg-surface-card p-4 shadow-card space-y-4">
        <div className="flex flex-wrap gap-2">
          {(Object.keys(PRESET_LABELS) as Exclude<RangePreset, "custom">[]).map(
            (key) => (
              <button
                key={key}
                type="button"
                onClick={() => applyPreset(key)}
                className={cn(
                  "rounded-lg px-3 py-2 text-sm font-semibold transition-colors",
                  preset === key
                    ? "bg-primary text-white"
                    : "border border-slate-border bg-white text-slate-muted hover:bg-surface"
                )}
              >
                {PRESET_LABELS[key]}
              </button>
            )
          )}
          <button
            type="button"
            onClick={() => setPreset("custom")}
            className={cn(
              "rounded-lg px-3 py-2 text-sm font-semibold transition-colors",
              preset === "custom"
                ? "bg-primary text-white"
                : "border border-slate-border bg-white text-slate-muted hover:bg-surface"
            )}
          >
            نطاق مخصص
          </button>
        </div>

        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <div>
            <label className="mb-1 block text-xs font-medium text-slate-muted">
              من تاريخ
            </label>
            <input
              type="date"
              value={dateFrom}
              onChange={(e) => {
                setPreset("custom");
                setDateFrom(e.target.value);
              }}
              className="w-full rounded-lg border border-slate-border px-3 py-2 text-sm"
            />
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium text-slate-muted">
              إلى تاريخ
            </label>
            <input
              type="date"
              value={dateTo}
              min={dateFrom}
              onChange={(e) => {
                setPreset("custom");
                setDateTo(e.target.value);
              }}
              className="w-full rounded-lg border border-slate-border px-3 py-2 text-sm"
            />
          </div>
          <div className="sm:col-span-2">
            <Select
              label="الطبيب"
              value={doctorId}
              onChange={(e) => setDoctorId(e.target.value)}
              placeholder="كل الأطباء"
              options={[
                { value: "", label: "كل الأطباء" },
                ...doctors.map((d) => ({
                  value: d.id,
                  label: formatDoctorDisplayName(d.full_name_ar),
                })),
              ]}
            />
          </div>
        </div>

        <div className="flex flex-wrap items-center justify-between gap-2 text-sm">
          <p className="text-slate-muted">
            النطاق: <span className="font-semibold text-slate-text">{rangeLabel}</span>
            {" · "}
            <span className="tabular-nums">{appointments.length}</span> موعد
          </p>
          <button
            type="button"
            onClick={() => refresh()}
            className="inline-flex items-center gap-1.5 rounded-lg border border-slate-border px-3 py-1.5 text-slate-muted hover:bg-surface"
          >
            <RefreshCw className={cn("h-4 w-4", loading && "animate-spin")} />
            تحديث
          </button>
        </div>
      </div>

      {loading ? (
        <div className="flex justify-center py-12">
          <RefreshCw className="h-6 w-6 animate-spin text-primary" />
        </div>
      ) : appointments.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-slate-border bg-white p-10 text-center text-sm text-slate-muted">
          لا توجد حجوزات في هذا النطاق
        </div>
      ) : (
        <div className="overflow-x-auto rounded-2xl border border-slate-border bg-white shadow-sm">
          <table className="w-full min-w-[720px] text-sm">
            <thead>
              <tr className="border-b bg-slate-50 text-right text-xs text-slate-muted">
                <th className="px-4 py-3 font-medium">اسم المريض</th>
                <th className="px-4 py-3 font-medium">الطبيب</th>
                <th className="px-4 py-3 font-medium">التاريخ</th>
                <th className="px-4 py-3 font-medium">الوقت</th>
                <th className="px-4 py-3 font-medium">حالة الحجز</th>
              </tr>
            </thead>
            <tbody>
              {appointments.map((a) => (
                <tr
                  key={a.id}
                  role="button"
                  tabIndex={0}
                  onClick={() => setSelected(a)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" || e.key === " ") {
                      e.preventDefault();
                      setSelected(a);
                    }
                  }}
                  className="cursor-pointer border-b border-slate-100 last:border-0 hover:bg-primary/5 focus:bg-primary/5 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/30"
                >
                  <td className="px-4 py-3 font-semibold text-slate-text">
                    {a.patient_name_ar || "—"}
                    {a.patient_phone && (
                      <span className="mt-0.5 block text-xs font-normal text-slate-muted" dir="ltr">
                        {a.patient_phone}
                      </span>
                    )}
                  </td>
                  <td className="px-4 py-3 text-slate-700">
                    {formatDoctorDisplayName(a.doctor?.full_name_ar) || "—"}
                  </td>
                  <td className="px-4 py-3 text-slate-600">
                    {formatDate(a.appointment_date)}
                  </td>
                  <td className="px-4 py-3 text-slate-600 tabular-nums" dir="ltr">
                    {formatTime(a.start_time)} – {formatTime(a.end_time)}
                  </td>
                  <td className="px-4 py-3">
                    <span
                      className={cn(
                        "inline-block rounded-full px-2.5 py-1 text-xs font-medium",
                        APPOINTMENT_STATUS_COLORS[a.status] ??
                          APPOINTMENT_STATUS_COLORS.scheduled
                      )}
                    >
                      {APPOINTMENT_STATUS_LABELS[a.status] ?? a.status}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {selected && clinicId && (
        <AppointmentScheduleActionsModal
          appointment={selected}
          clinicId={clinicId}
          onClose={() => setSelected(null)}
          onEdit={() => setEditing(selected)}
        />
      )}

      {editing && (
        <EditAppointmentModal
          appointment={editing}
          portal="accountant"
          onClose={() => setEditing(null)}
          onSaved={() => {
            setEditing(null);
            refresh();
          }}
        />
      )}
    </div>
  );
}
