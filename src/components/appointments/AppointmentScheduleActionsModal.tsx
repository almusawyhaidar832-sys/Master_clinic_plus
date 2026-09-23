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
  CalendarClock,
  Clock,
  Stethoscope,
} from "lucide-react";
import { Modal } from "@/components/ui/Modal";
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
    <Modal
      onClose={onClose}
      title={appointment.patient_name_ar || "موعد"}
      icon={CalendarClock}
      size="md"
    >
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-slate-border bg-surface p-3.5">
          <div className="min-w-0 space-y-1 text-sm">
            <p className="flex items-center gap-2 font-semibold text-slate-text">
              <Clock className="h-4 w-4 text-premium-500" />
              {formatDate(appointment.appointment_date)}
              {" · "}
              <span dir="ltr" className="tabular-nums">
                {formatTime(appointment.start_time)} – {formatTime(appointment.end_time)}
              </span>
            </p>
            {appointment.doctor?.full_name_ar && (
              <p className="flex items-center gap-2 text-slate-muted">
                <Stethoscope className="h-4 w-4 text-premium-500" />
                {formatDoctorDisplayName(appointment.doctor.full_name_ar)}
              </p>
            )}
          </div>
          <span
            className={cn(
              "inline-flex items-center rounded-full px-2.5 py-1 text-xs font-semibold",
              APPOINTMENT_STATUS_COLORS[appointment.status] ??
                APPOINTMENT_STATUS_COLORS.scheduled
            )}
          >
            {statusLabels[appointment.status] ?? appointment.status}
          </span>
        </div>

        {error && (
          <p className="mb-3 rounded-xl border border-debt-border bg-debt px-3 py-2 text-sm text-debt-text">
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
                className="mc-btn-navy w-full py-3"
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
                className="mc-btn-soft w-full py-3 text-debt-text hover:border-debt-border hover:bg-debt"
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
              className="mc-btn-soft w-full py-3 text-warning-text hover:border-warning-border hover:bg-warning"
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
              className="mc-btn-soft w-full py-3 text-debt-text hover:border-debt-border hover:bg-debt"
            >
              <Trash2 className="h-4 w-4" />
              حذف نهائي
            </button>
          )}

          <button
            type="button"
            onClick={() => void handleOpenPatient()}
            disabled={openingPatient}
            className="mc-btn-pearl w-full py-3"
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
              className="mc-btn-soft w-full py-3"
            >
              <Pencil className="h-4 w-4" />
              تعديل الموعد
            </button>
          ) : null}

          {(flags.canCancel || flags.isPending) && (
            <button
              type="button"
              onClick={onClose}
              className="flex w-full items-center justify-center gap-2 rounded-xl px-4 py-2.5 text-sm font-medium text-slate-muted transition-colors hover:bg-surface hover:text-slate-text"
            >
              إبقاء الحجز كما هو
            </button>
          )}
        </div>
    </Modal>
  );
}
