"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import {
  X,
  User,
  Pencil,
  RefreshCw,
  Check,
  Ban,
  Trash2,
} from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { resolveAppointmentPatientProfileHref } from "@/lib/services/ensure-appointment-patient-client";
import { formatDoctorDisplayName } from "@/lib/services/clinic-profile";
import { formatDate, formatTime } from "@/lib/utils";
import { APPOINTMENT_STATUS_COLORS } from "@/components/appointments/appointment-constants";
import { appointmentActionFlags } from "@/components/appointments/appointment-action-flags";
import { useAppointmentStatusLabels } from "@/i18n/localized-labels";
import { setAccountantAppointmentStatusViaApi } from "@/lib/services/accountant-appointments-client";
import { cn } from "@/lib/utils";
import type { AppointmentWithDoctor } from "@/hooks/useCentralizedAppointments";

interface AppointmentScheduleActionsModalProps {
  appointment: AppointmentWithDoctor;
  clinicId: string;
  onClose: () => void;
  onEdit: () => void;
  onCancel: () => void;
  onReject: () => void;
  onDelete: () => void;
  onChanged: (message: string) => void;
}

export function AppointmentScheduleActionsModal({
  appointment,
  clinicId,
  onClose,
  onEdit,
  onCancel,
  onReject,
  onDelete,
  onChanged,
}: AppointmentScheduleActionsModalProps) {
  const statusLabels = useAppointmentStatusLabels();
  const router = useRouter();
  const [openingPatient, setOpeningPatient] = useState(false);
  const [accepting, setAccepting] = useState(false);
  const [error, setError] = useState("");

  const flags = appointmentActionFlags(appointment.status);

  async function handleOpenPatient() {
    setError("");
    setOpeningPatient(true);
    try {
      const supabase = createClient();
      const href = await resolveAppointmentPatientProfileHref(
        supabase,
        clinicId,
        appointment
      );
      router.push(href);
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : "تعذر فتح ملف المريض");
    } finally {
      setOpeningPatient(false);
    }
  }

  async function handleAccept() {
    setError("");
    setAccepting(true);
    const result = await setAccountantAppointmentStatusViaApi(
      appointment.id,
      "accept"
    );
    setAccepting(false);
    if (!result.ok) {
      setError(result.error ?? "تعذر التأكيد");
      return;
    }
    onChanged(
      result.queuedToWaitingRoom
        ? "تم تأكيد الحجز — المراجع في غرفة الانتظار"
        : "تم تأكيد الحجز وإبقاؤه"
    );
    onClose();
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 sm:items-center"
      onClick={onClose}
    >
      <div
        className="w-full max-w-md rounded-t-2xl bg-white p-6 shadow-2xl sm:rounded-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-4 flex items-start justify-between gap-3">
          <div>
            <h2 className="text-lg font-bold text-slate-800">
              {appointment.patient_name_ar || "موعد"}
            </h2>
            <p className="mt-1 text-sm text-slate-muted">
              {formatDate(appointment.appointment_date)}
              {" · "}
              <span dir="ltr">
                {formatTime(appointment.start_time)} – {formatTime(appointment.end_time)}
              </span>
            </p>
            {appointment.doctor?.full_name_ar && (
              <p className="mt-0.5 text-sm text-slate-600">
                {formatDoctorDisplayName(appointment.doctor.full_name_ar)}
              </p>
            )}
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg p-1 hover:bg-slate-100"
          >
            <X className="h-5 w-5 text-slate-500" />
          </button>
        </div>

        <span
          className={cn(
            "mb-4 inline-block rounded-full px-2.5 py-1 text-xs font-medium",
            APPOINTMENT_STATUS_COLORS[appointment.status] ??
              APPOINTMENT_STATUS_COLORS.scheduled
          )}
        >
          {statusLabels[appointment.status] ?? appointment.status}
        </span>

        {error && (
          <p className="mb-3 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-600">
            {error}
          </p>
        )}

        <div className="space-y-2">
          {flags.isPending && (
            <>
              <button
                type="button"
                onClick={() => void handleAccept()}
                disabled={accepting}
                className="flex w-full items-center justify-center gap-2 rounded-xl bg-emerald-600 px-4 py-3 text-sm font-semibold text-white hover:bg-emerald-700 disabled:opacity-60"
              >
                {accepting ? (
                  <RefreshCw className="h-4 w-4 animate-spin" />
                ) : (
                  <Check className="h-4 w-4" />
                )}
                تأكيد وإبقاء الحجز
              </button>
              <button
                type="button"
                onClick={() => {
                  onReject();
                  onClose();
                }}
                className="flex w-full items-center justify-center gap-2 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm font-semibold text-red-700 hover:bg-red-100"
              >
                <X className="h-4 w-4" />
                رفض الطلب
              </button>
            </>
          )}

          {flags.canCancel && (
            <button
              type="button"
              onClick={() => {
                onCancel();
                onClose();
              }}
              className="flex w-full items-center justify-center gap-2 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm font-semibold text-amber-900 hover:bg-amber-100"
            >
              <Ban className="h-4 w-4" />
              إلغاء الحجز
            </button>
          )}

          {flags.canDelete && (
            <button
              type="button"
              onClick={() => {
                onDelete();
                onClose();
              }}
              className="flex w-full items-center justify-center gap-2 rounded-xl border border-red-200 px-4 py-3 text-sm font-semibold text-red-600 hover:bg-red-50"
            >
              <Trash2 className="h-4 w-4" />
              حذف نهائي
            </button>
          )}

          <button
            type="button"
            onClick={() => void handleOpenPatient()}
            disabled={openingPatient}
            className="flex w-full items-center justify-center gap-2 rounded-xl bg-primary px-4 py-3 text-sm font-semibold text-white hover:bg-primary/90 disabled:opacity-60"
          >
            {openingPatient ? (
              <RefreshCw className="h-4 w-4 animate-spin" />
            ) : (
              <User className="h-4 w-4" />
            )}
            ملف المريض
          </button>

          {flags.canEdit ? (
            <button
              type="button"
              onClick={() => {
                onEdit();
                onClose();
              }}
              className="flex w-full items-center justify-center gap-2 rounded-xl border border-slate-border bg-white px-4 py-3 text-sm font-semibold text-slate-700 hover:bg-slate-50"
            >
              <Pencil className="h-4 w-4" />
              تعديل الموعد
            </button>
          ) : null}

          {(flags.canCancel || flags.isPending) && (
            <button
              type="button"
              onClick={onClose}
              className="flex w-full items-center justify-center gap-2 rounded-xl border border-slate-200 px-4 py-3 text-sm font-medium text-slate-600 hover:bg-slate-50"
            >
              إبقاء الحجز كما هو
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
