"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { getActiveClinicId } from "@/lib/clinic-context";
import { useAppointmentsRealtime } from "@/hooks/useAppointmentsRealtime";
import type { DashboardAppointment } from "@/components/operations/PaymentInvoiceModal";
import { resolveAppointmentPaymentUrl } from "@/lib/ledger/open-appointment-payment";
import { EditAppointmentModal } from "@/components/assistant/EditAppointmentModal";
import { RejectAppointmentModal } from "@/components/assistant/RejectAppointmentModal";
import { setAccountantAppointmentStatusViaApi } from "@/lib/services/accountant-appointments-client";
import { broadcastPatientSentToDoctor } from "@/lib/queue/broadcast";
import { notifyQueueRefresh } from "@/lib/queue/queue-refresh";
import { authPortalHeaders } from "@/lib/auth/api-portal";
import { normalizeAppointmentRows } from "@/lib/appointments/normalize-row";
import { cn, formatTime, todayISO } from "@/lib/utils";
import { useLanguage } from "@/contexts/LanguageContext";
import { useAppointmentStatusLabels } from "@/i18n/localized-labels";
import type { AppointmentStatus } from "@/types";
import {
  CalendarClock,
  DoorOpen,
  Receipt,
  RefreshCw,
  Stethoscope,
  Check,
  X,
  Pencil,
} from "lucide-react";

const STATUS_STYLE: Record<
  AppointmentStatus,
  { color: string; bg: string }
> = {
  pending:        { color: "text-amber-700",   bg: "bg-amber-100"   },
  scheduled:      { color: "text-slate-600",   bg: "bg-slate-100"   },
  confirmed:      { color: "text-blue-600",    bg: "bg-blue-100"    },
  waiting:        { color: "text-amber-800",   bg: "bg-amber-50"    },
  in_clinic:      { color: "text-teal-700",    bg: "bg-teal-100"    },
  in_examination: { color: "text-emerald-700", bg: "bg-emerald-100" },
  ready_for_billing: { color: "text-violet-700", bg: "bg-violet-100" },
  ready_for_payment: { color: "text-violet-700", bg: "bg-violet-100" },
  completed:      { color: "text-violet-600",  bg: "bg-violet-100"  },
  cancelled:      { color: "text-red-600",     bg: "bg-red-100"     },
  no_show:        { color: "text-amber-600",   bg: "bg-amber-100"   },
};

interface TodayAppointmentsPanelProps {
  /** عنوان مخصص للقسم */
  title?: string;
  compact?: boolean;
  /** بعد الموافقة — تحديث غرفة الانتظار في نفس الصفحة */
  onApprovedToQueue?: () => void;
}

export function TodayAppointmentsPanel({
  title,
  compact = false,
  onApprovedToQueue,
}: TodayAppointmentsPanelProps) {
  const { t, bi } = useLanguage();
  const statusLabels = useAppointmentStatusLabels();
  const panelTitle = title ?? t("todayBookingsTitle");
  const [clinicId, setClinicId] = useState<string | null>(null);
  const [appointments, setAppointments] = useState<DashboardAppointment[]>([]);
  const [loading, setLoading] = useState(true);
  const [checkingIn, setCheckingIn] = useState<string | null>(null);
  const [actionId, setActionId] = useState<string | null>(null);
  const [editing, setEditing] = useState<DashboardAppointment | null>(null);
  const [rejecting, setRejecting] = useState<DashboardAppointment | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [payingId, setPayingId] = useState<string | null>(null);
  const [finishingId, setFinishingId] = useState<string | null>(null);
  const router = useRouter();

  const load = useCallback(async () => {
    setLoading(true);
    const supabase = createClient();
    const active = await getActiveClinicId(supabase);

    if (!active?.clinicId) {
      setClinicId(null);
      setAppointments([]);
      setLoading(false);
      return;
    }

    setClinicId(active.clinicId);

    const { data, error } = await supabase
      .from("appointments")
      .select(
        `*,
        doctor:doctors!doctor_id ( full_name_ar, percentage, materials_share, payment_type )`
      )
      .eq("clinic_id", active.clinicId)
      .eq("appointment_date", todayISO())
      .neq("status", "cancelled")
      .order("start_time");

    if (error) {
      setMessage(t("msgLoadAppointmentsFailed"));
      setAppointments([]);
    } else {
      setAppointments(
        normalizeAppointmentRows((data ?? []) as Record<string, unknown>[]) as DashboardAppointment[]
      );
    }
    setLoading(false);
  }, [t]);

  useEffect(() => {
    load();
  }, [load]);

  useAppointmentsRealtime(clinicId, load);

  useEffect(() => {
    if (!toast) return;
    const timer = setTimeout(() => setToast(null), 4000);
    return () => clearTimeout(timer);
  }, [toast]);

  async function handleApprove(appointment: DashboardAppointment) {
    setActionId(appointment.id);
    setMessage(null);
    try {
      const result = await setAccountantAppointmentStatusViaApi(
        appointment.id,
        "accept"
      );
      if (!result.ok) {
        setMessage(result.error ?? t("msgApproveFailed"));
        return;
      }
      setToast(t("toastPatientToQueue"));
      if (clinicId) {
        notifyQueueRefresh({ scope: "clinic", clinicId });
      }
      onApprovedToQueue?.();
      load();
    } finally {
      setActionId(null);
    }
  }

  async function handleCheckIn(appointment: DashboardAppointment) {
    setCheckingIn(appointment.id);
    setMessage(null);
    try {
      let res: Response;
      try {
        res = await fetch("/api/operations/check-in", {
          method: "POST",
          credentials: "include",
          headers: {
            "Content-Type": "application/json",
            ...authPortalHeaders("accountant"),
          },
          body: JSON.stringify({ appointment_id: appointment.id }),
        });
      } catch {
        setMessage(t("errServerConnection"));
        return;
      }

      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        setMessage(json.error ?? t("msgCheckInFailed"));
        return;
      }

      const name = appointment.patient_name_ar || t("entityPatient");
      setToast(
        bi(
          `تم دخول ${name} لغرفة الانتظار — أُشعر الطبيب`,
          `${name} checked in — doctor notified`
        )
      );

      const supabase = createClient();
      void broadcastPatientSentToDoctor(supabase, appointment.doctor_id, {
        name,
        entryId: json.queue_entry_id as string | undefined,
      });

      if (clinicId) {
        notifyQueueRefresh({ scope: "clinic", clinicId });
        notifyQueueRefresh({ scope: "doctor", doctorId: appointment.doctor_id });
      }
      onApprovedToQueue?.();
      load();
    } finally {
      setCheckingIn(null);
    }
  }

  async function handleOpenPayment(appointment: DashboardAppointment) {
    if (!clinicId) return;
    setPayingId(appointment.id);
    setMessage(null);
    try {
      const href = await resolveAppointmentPaymentUrl({
        clinicId,
        appointmentId: appointment.id,
        patientId: appointment.patient_id,
        doctorId: appointment.doctor_id,
        patientPhone: appointment.patient_phone,
        patientNameAr: appointment.patient_name_ar,
      });
      router.push(href);
    } catch (err) {
      setMessage(err instanceof Error ? err.message : t("errOpenSession"));
    } finally {
      setPayingId(null);
    }
  }

  async function handleFinishExamination(appointment: DashboardAppointment) {
    setFinishingId(appointment.id);
    setMessage(null);
    try {
      let res: Response;
      try {
        res = await fetch("/api/operations/finish-examination", {
          method: "POST",
          credentials: "include",
          headers: {
            "Content-Type": "application/json",
            ...authPortalHeaders("accountant"),
          },
          body: JSON.stringify({ appointment_id: appointment.id }),
        });
      } catch {
        setMessage(t("errServerConnection"));
        return;
      }

      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        setMessage(json.error ?? t("msgFinishExamFailed"));
        return;
      }

      setToast(t("toastExamFinishedPayment"));
      if (clinicId) {
        notifyQueueRefresh({ scope: "clinic", clinicId });
        notifyQueueRefresh({ scope: "doctor", doctorId: appointment.doctor_id });
      }
      onApprovedToQueue?.();
      load();
    } finally {
      setFinishingId(null);
    }
  }

  const pending = appointments.filter((a) => a.status !== "completed");
  const pendingReview = appointments.filter((a) => a.status === "pending");

  return (
    <section
      className={cn(
        "rounded-2xl border border-slate-200 bg-white shadow-sm",
        compact ? "p-4" : "p-5"
      )}
    >
      <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
        <h2 className="flex items-center gap-2 text-lg font-bold text-slate-800">
          <CalendarClock className="h-5 w-5 text-primary" />
          {panelTitle}
          <span className="text-sm font-normal text-slate-400">
            ({pending.length} {t("todayActiveSuffix")})
          </span>
        </h2>
        <button
          type="button"
          onClick={load}
          className="rounded-lg border border-slate-200 p-2 text-slate-500 hover:bg-slate-50"
        >
          <RefreshCw className={cn("h-4 w-4", loading && "animate-spin")} />
        </button>
      </div>

      {toast && (
        <p className="mb-3 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm font-medium text-emerald-800">
          {toast}
        </p>
      )}

      {pendingReview.length > 0 && (
        <p className="mb-3 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900">
          <strong>{pendingReview.length}</strong> {t("todayBarcodePending")}
        </p>
      )}

      {message && (
        <p className="mb-3 rounded-lg bg-primary/5 px-3 py-2 text-sm text-primary">
          {message}
        </p>
      )}

      {loading ? (
        <div className="flex justify-center py-8">
          <RefreshCw className="h-6 w-6 animate-spin text-primary" />
        </div>
      ) : pending.length === 0 ? (
        <p className="py-6 text-center text-sm text-slate-400">
          {t("todayNoActiveBookings")}
        </p>
      ) : (
        <div className="space-y-2">
          {pending.map((a) => {
            const cfg = STATUS_STYLE[a.status] ?? STATUS_STYLE.scheduled;
            const statusLabel = statusLabels[a.status] ?? a.status;
            const isPending = a.status === "pending";
            const canCheckIn = ["scheduled", "confirmed", "waiting"].includes(a.status);
            const canCheckout =
              a.status === "ready_for_billing" || a.status === "ready_for_payment";
            const inConsultation = a.status === "in_clinic" || a.status === "in_examination";

            return (
              <div
                key={a.id}
                className={cn(
                  "flex flex-wrap items-center justify-between gap-3 rounded-xl border p-3",
                  isPending
                    ? "border-amber-200 bg-amber-50/60"
                    : "border-slate-100 bg-slate-50/80"
                )}
              >
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-semibold text-slate-800">
                      {a.patient_name_ar || t("entityPatient")}
                    </span>
                    <span
                      className={cn(
                        "rounded-full px-2 py-0.5 text-xs font-medium",
                        cfg.bg,
                        cfg.color
                      )}
                    >
                      {statusLabel}
                    </span>
                  </div>
                  <p className="mt-0.5 flex items-center gap-1 text-xs text-slate-500">
                    <Stethoscope className="h-3 w-3" />
                    {a.doctor?.full_name_ar ?? t("entityDoctor")}
                    <span>·</span>
                    {formatTime(a.start_time)}
                  </p>
                </div>

                <div className="flex flex-wrap gap-2">
                  {isPending && (
                    <>
                      <button
                        type="button"
                        disabled={actionId === a.id}
                        onClick={() => handleApprove(a)}
                        className="flex items-center gap-1 rounded-lg bg-teal-600 px-3 py-1.5 text-xs font-bold text-white hover:bg-teal-700 disabled:opacity-60"
                      >
                        {actionId === a.id ? (
                          <RefreshCw className="h-3 w-3 animate-spin" />
                        ) : (
                          <Check className="h-3 w-3" />
                        )}
                        {t("apptApprove")}
                      </button>
                      <button
                        type="button"
                        onClick={() => setRejecting(a)}
                        className="flex items-center gap-1 rounded-lg border border-red-200 bg-white px-3 py-1.5 text-xs font-bold text-red-600 hover:bg-red-50"
                      >
                        <X className="h-3 w-3" />
                        {t("apptReject")}
                      </button>
                      <button
                        type="button"
                        onClick={() => setEditing(a)}
                        className="flex items-center gap-1 rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-bold text-slate-600 hover:bg-slate-50"
                      >
                        <Pencil className="h-3 w-3" />
                        {t("edit")}
                      </button>
                    </>
                  )}
                  {canCheckIn && (
                    <button
                      type="button"
                      disabled={checkingIn === a.id}
                      onClick={() => handleCheckIn(a)}
                      className="flex items-center gap-1 rounded-lg bg-emerald-600 px-3 py-1.5 text-xs font-bold text-white hover:bg-emerald-700 disabled:opacity-60"
                    >
                      {checkingIn === a.id ? (
                        <RefreshCw className="h-3 w-3 animate-spin" />
                      ) : (
                        <DoorOpen className="h-3 w-3" />
                      )}
                      {t("apptCheckIn")}
                    </button>
                  )}
                  {inConsultation && (
                    <button
                      type="button"
                      disabled={finishingId === a.id}
                      onClick={() => handleFinishExamination(a)}
                      className="flex items-center gap-1 rounded-lg bg-violet-600 px-3 py-1.5 text-xs font-bold text-white hover:bg-violet-700 disabled:opacity-60"
                    >
                      {finishingId === a.id ? (
                        <RefreshCw className="h-3 w-3 animate-spin" />
                      ) : (
                        <Receipt className="h-3 w-3" />
                      )}
                      {t("apptFinishExam")}
                    </button>
                  )}
                  {canCheckout && (
                    <button
                      type="button"
                      disabled={payingId === a.id}
                      onClick={() => handleOpenPayment(a)}
                      className="flex items-center gap-1 rounded-lg bg-violet-600 px-3 py-1.5 text-xs font-bold text-white hover:bg-violet-700 disabled:opacity-60"
                    >
                      {payingId === a.id ? (
                        <RefreshCw className="h-3 w-3 animate-spin" />
                      ) : (
                        <Receipt className="h-3 w-3" />
                      )}
                      {t("apptPay")}
                    </button>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {editing && (
        <EditAppointmentModal
          appointment={editing}
          portal="accountant"
          onClose={() => setEditing(null)}
          onSaved={() => {
            setMessage(t("msgAppointmentUpdated"));
            load();
          }}
        />
      )}

      {rejecting && (
        <RejectAppointmentModal
          appointment={rejecting}
          portal="accountant"
          onClose={() => setRejecting(null)}
          onSaved={() => {
            setMessage(t("msgAppointmentRejected"));
            load();
          }}
        />
      )}
    </section>
  );
}
