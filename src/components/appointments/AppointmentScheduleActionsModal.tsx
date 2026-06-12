"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { X, User, Pencil, RefreshCw } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { resolveAppointmentPatientProfileHref } from "@/lib/services/ensure-appointment-patient-client";
import { formatDoctorDisplayName } from "@/lib/services/clinic-profile";
import { formatDate, formatTime } from "@/lib/utils";
import {
  APPOINTMENT_STATUS_COLORS,
} from "@/components/appointments/appointment-constants";
import { useAppointmentStatusLabels } from "@/i18n/localized-labels";
import { cn } from "@/lib/utils";
import type { AppointmentWithDoctor } from "@/hooks/useCentralizedAppointments";

interface AppointmentScheduleActionsModalProps {
  appointment: AppointmentWithDoctor;
  clinicId: string;
  onClose: () => void;
  onEdit: () => void;
}

function canEditAppointment(status: string): boolean {
  return (
    status !== "cancelled" &&
    status !== "completed" &&
    status !== "in_examination" &&
    status !== "in_clinic"
  );
}

export function AppointmentScheduleActionsModal({
  appointment,
  clinicId,
  onClose,
  onEdit,
}: AppointmentScheduleActionsModalProps) {
  const statusLabels = useAppointmentStatusLabels();
  const router = useRouter();
  const [openingPatient, setOpeningPatient] = useState(false);
  const [error, setError] = useState("");

  const editable = canEditAppointment(appointment.status);

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

          {editable ? (
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
          ) : (
            <p className="rounded-xl bg-slate-50 px-3 py-2 text-center text-xs text-slate-muted">
              لا يمكن تعديل موعد مكتمل أو ملغى أو جارٍ فحصه
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
