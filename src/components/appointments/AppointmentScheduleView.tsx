"use client";

import { useEffect, useMemo, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { useActiveClinicId } from "@/hooks/useActiveClinicId";
import { useAppointmentSchedule } from "@/hooks/useAppointmentSchedule";
import {
  APPOINTMENT_STATUS_COLORS,
} from "@/components/appointments/appointment-constants";
import { useAppointmentStatusLabels } from "@/i18n/localized-labels";
import { formatDoctorDisplayName } from "@/lib/services/clinic-profile";
import { formatDate, formatTime, localDateISO, todayISO } from "@/lib/utils";
import { cn } from "@/lib/utils";
import { Select } from "@/components/ui/Select";
import { CalendarRange, Filter, RefreshCw } from "lucide-react";
import { PageHeader } from "@/components/ui/PageHeader";
import { useLanguage } from "@/contexts/LanguageContext";
import { EditAppointmentModal } from "@/components/assistant/EditAppointmentModal";
import { CancelAppointmentModal } from "@/components/assistant/CancelAppointmentModal";
import { RejectAppointmentModal } from "@/components/assistant/RejectAppointmentModal";
import { AppointmentScheduleActionsModal } from "@/components/appointments/AppointmentScheduleActionsModal";
import { appointmentActionFlags } from "@/components/appointments/appointment-action-flags";
import { deleteAccountantAppointmentViaApi } from "@/lib/services/accountant-appointments-client";
import { Check, Ban, Trash2, X } from "lucide-react";
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
  const statusLabels = useAppointmentStatusLabels();
  const { bi } = useLanguage();
  const { clinicId, loading: clinicLoading, missingClinic } = useActiveClinicId();
  const [preset, setPreset] = useState<RangePreset>("this_week");
  const [dateFrom, setDateFrom] = useState(todayISO());
  const [dateTo, setDateTo] = useState(addDaysISO(todayISO(), 6));
  const [doctorId, setDoctorId] = useState("");
  const [doctors, setDoctors] = useState<Doctor[]>([]);
  const [selected, setSelected] = useState<AppointmentWithDoctor | null>(null);
  const [editing, setEditing] = useState<AppointmentWithDoctor | null>(null);
  const [cancelling, setCancelling] = useState<AppointmentWithDoctor | null>(null);
  const [rejecting, setRejecting] = useState<AppointmentWithDoctor | null>(null);
  const [actionId, setActionId] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

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

  async function handleDelete(appt: AppointmentWithDoctor) {
    if (!confirm(`حذف نهائي لموعد ${appt.patient_name_ar}؟`)) return;
    setActionId(appt.id);
    const result = await deleteAccountantAppointmentViaApi(appt.id);
    setActionId(null);
    if (!result.ok) {
      setMessage(result.error ?? "تعذر الحذف");
      return;
    }
    setMessage("تم حذف الموعد نهائياً");
    refresh();
  }

  if (clinicLoading) {
    return (
      <div className="flex justify-center py-16">
        <RefreshCw className="h-6 w-6 animate-spin text-primary" />
      </div>
    );
  }

  if (!clinicId) {
    return (
      <div className="rounded-2xl border border-warning-border bg-warning p-6 text-center text-sm font-medium text-warning-text shadow-card">
        {missingClinic
          ? "حسابك غير مربوط بعيادة — تواصل مع الإدارة"
          : "تعذر تحميل بيانات العيادة"}
      </div>
    );
  }

  return (
    <div className="space-y-5">
      <PageHeader
        eyebrow={bi("المواعيد", "Scheduling")}
        title="جدول المواعيد"
        subtitle="عرض أجندة الحجوزات — تأكيد أو إلغاء أو حذف حسب الحالة (مرحلتان: إلغاء ثم حذف)"
        icon={CalendarRange}
        className="mb-0"
      />

      {message && (
        <p className="flex items-center gap-2 rounded-2xl border border-success-border bg-success px-4 py-2.5 text-sm font-medium text-success-text">
          <Check className="h-4 w-4 shrink-0" />
          {message}
        </p>
      )}

      <section className="mc-panel">
        <div className="mc-panel-head">
          <h2 className="mc-panel-title">
            <Filter />
            {bi("نطاق العرض", "View range")}
          </h2>
          <div className="flex flex-wrap gap-2">
          {(Object.keys(PRESET_LABELS) as Exclude<RangePreset, "custom">[]).map(
            (key) => (
              <button
                key={key}
                type="button"
                onClick={() => applyPreset(key)}
                className={cn("mc-chip", preset === key && "mc-chip--active")}
              >
                {PRESET_LABELS[key]}
              </button>
            )
          )}
          <button
            type="button"
            onClick={() => setPreset("custom")}
            className={cn("mc-chip", preset === "custom" && "mc-chip--active")}
          >
            نطاق مخصص
          </button>
          </div>
        </div>

        <div className="mc-panel-body space-y-4">
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <div>
            <label className="mb-1.5 block text-xs font-semibold text-slate-muted">
              من تاريخ
            </label>
            <input
              type="date"
              value={dateFrom}
              onChange={(e) => {
                setPreset("custom");
                setDateFrom(e.target.value);
              }}
              className="mc-field"
            />
          </div>
          <div>
            <label className="mb-1.5 block text-xs font-semibold text-slate-muted">
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
              className="mc-field"
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

        <div className="flex flex-wrap items-center justify-between gap-2 border-t border-slate-border pt-4 text-sm">
          <p className="flex flex-wrap items-center gap-2 text-slate-muted">
            <span>
              النطاق: <span className="font-semibold text-slate-text">{rangeLabel}</span>
            </span>
            <span className="inline-flex items-center rounded-full bg-primary-50 px-2.5 py-0.5 text-xs font-bold text-primary-700 ring-1 ring-inset ring-primary-200">
              <span className="tabular-nums">{appointments.length}</span>&nbsp;موعد
            </span>
          </p>
          <button
            type="button"
            onClick={() => refresh()}
            className="mc-btn-soft"
          >
            <RefreshCw className={cn("h-4 w-4", loading && "animate-spin")} />
            تحديث
          </button>
        </div>
        </div>
      </section>

      <section className="mc-panel">
      {loading ? (
        <div className="space-y-2 p-5">
          {[0, 1, 2, 3].map((i) => (
            <div key={i} className="mc-skeleton h-12 w-full" />
          ))}
        </div>
      ) : appointments.length === 0 ? (
        <div className="flex flex-col items-center px-6 py-14 text-center">
          <span className="mb-4 flex h-14 w-14 items-center justify-center rounded-2xl bg-surface text-slate-muted ring-1 ring-inset ring-slate-border">
            <CalendarRange className="h-7 w-7" strokeWidth={1.6} />
          </span>
          <p className="text-sm font-medium text-slate-muted">لا توجد حجوزات في هذا النطاق</p>
        </div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[720px] text-sm">
            <thead>
              <tr className="text-xs text-slate-muted">
                <th className="px-5 py-3 text-start font-semibold">اسم المريض</th>
                <th className="px-4 py-3 text-start font-semibold">الطبيب</th>
                <th className="px-4 py-3 text-start font-semibold">التاريخ</th>
                <th className="px-4 py-3 text-start font-semibold">الوقت</th>
                <th className="px-4 py-3 text-start font-semibold">حالة الحجز</th>
                <th className="px-4 py-3 text-start font-semibold">إجراءات</th>
              </tr>
            </thead>
            <tbody>
              {appointments.map((a) => {
                const flags = appointmentActionFlags(a.status);
                return (
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
                  className="cursor-pointer border-b border-slate-border last:border-0 focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-primary/30"
                >
                  <td className="px-5 py-3.5 font-semibold text-slate-text">
                    <div className="flex items-center gap-3">
                      <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-mc-pearl text-sm font-bold text-[#0b1f3a] ring-1 ring-inset ring-premium-200">
                        {(a.patient_name_ar || "—").trim().charAt(0)}
                      </span>
                      <span className="min-w-0">
                        {a.patient_name_ar || "—"}
                        {a.patient_phone && (
                          <span className="mt-0.5 block text-xs font-normal tabular-nums text-slate-muted" dir="ltr">
                            {a.patient_phone}
                          </span>
                        )}
                      </span>
                    </div>
                  </td>
                  <td className="px-4 py-3.5 font-medium text-slate-text">
                    {formatDoctorDisplayName(a.doctor?.full_name_ar) || "—"}
                  </td>
                  <td className="px-4 py-3.5 text-slate-muted">
                    {formatDate(a.appointment_date)}
                  </td>
                  <td className="px-4 py-3.5 font-semibold text-slate-text tabular-nums" dir="ltr">
                    {formatTime(a.start_time)}
                  </td>
                  <td className="px-4 py-3.5">
                    <span
                      className={cn(
                        "inline-flex items-center rounded-full px-2.5 py-1 text-xs font-semibold",
                        APPOINTMENT_STATUS_COLORS[a.status] ??
                          APPOINTMENT_STATUS_COLORS.scheduled
                      )}
                    >
                      {statusLabels[a.status] ?? a.status}
                    </span>
                  </td>
                  <td className="px-4 py-3.5" onClick={(e) => e.stopPropagation()}>
                    <div className="flex flex-wrap gap-1.5">
                      {flags.isPending && (
                        <ScheduleActionBtn
                          onClick={() => setSelected(a)}
                          className="border-transparent bg-mc-navy text-white shadow-soft hover:brightness-110"
                        >
                          <Check className="h-3 w-3" />
                          تأكيد
                        </ScheduleActionBtn>
                      )}
                      {flags.canCancel && (
                        <ScheduleActionBtn
                          onClick={() => setCancelling(a)}
                          className="text-warning-text hover:border-warning-border hover:bg-warning"
                        >
                          <Ban className="h-3 w-3" />
                          إلغاء
                        </ScheduleActionBtn>
                      )}
                      {flags.canDelete && (
                        <ScheduleActionBtn
                          disabled={actionId === a.id}
                          onClick={() => void handleDelete(a)}
                          className="text-debt-text hover:border-debt-border hover:bg-debt"
                        >
                          <Trash2 className="h-3 w-3" />
                          حذف
                        </ScheduleActionBtn>
                      )}
                      {flags.isPending && (
                        <ScheduleActionBtn
                          onClick={() => setRejecting(a)}
                          className="text-debt-text hover:border-debt-border hover:bg-debt"
                        >
                          <X className="h-3 w-3" />
                          رفض
                        </ScheduleActionBtn>
                      )}
                    </div>
                  </td>
                </tr>
              );
              })}
            </tbody>
          </table>
        </div>
      )}
      </section>

      {selected && clinicId && (
        <AppointmentScheduleActionsModal
          appointment={selected}
          clinicId={clinicId}
          onClose={() => setSelected(null)}
          onEdit={() => setEditing(selected)}
          onCancel={() => setCancelling(selected)}
          onReject={() => setRejecting(selected)}
          onDelete={() => void handleDelete(selected)}
          onChanged={(msg) => {
            setMessage(msg);
            refresh();
          }}
        />
      )}

      {cancelling && (
        <CancelAppointmentModal
          appointment={cancelling}
          portal="accountant"
          onClose={() => setCancelling(null)}
          onSaved={() => {
            setMessage("تم إلغاء الحجز — يمكنك حذفه لاحقاً من زر «حذف»");
            setCancelling(null);
            refresh();
          }}
        />
      )}

      {rejecting && (
        <RejectAppointmentModal
          appointment={rejecting}
          portal="accountant"
          onClose={() => setRejecting(null)}
          onSaved={() => {
            setMessage("تم رفض الطلب — الحجز ملغي");
            setRejecting(null);
            refresh();
          }}
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

function ScheduleActionBtn({
  children,
  onClick,
  disabled,
  className,
}: {
  children: React.ReactNode;
  onClick: () => void;
  disabled?: boolean;
  className?: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={cn(
        "inline-flex items-center gap-1 rounded-lg border border-slate-border bg-surface-card px-2.5 py-1.5 text-xs font-semibold transition-colors disabled:opacity-50",
        className
      )}
    >
      {children}
    </button>
  );
}
