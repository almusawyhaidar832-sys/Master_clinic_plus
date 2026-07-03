"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { translateDbError } from "@/lib/db-errors";
import { cn } from "@/lib/utils";
import { Alert } from "@/components/ui/Alert";
import { authPortalHeaders } from "@/lib/auth/api-portal";
import { broadcastPatientSentToDoctor } from "@/lib/queue/broadcast";
import { notifyQueueRefresh } from "@/lib/queue/queue-refresh";
import { tryEnqueueQueueAddOffline } from "@/lib/offline/queue-add/enqueue";
import { cacheOfflineDoctors } from "@/lib/offline/reference-cache";
import { useQueueListRefresh } from "@/hooks/useQueueListRefresh";
import { announcePatientCall } from "@/lib/queue/realtime-client";
import {
  resolveDoctorSpeechName,
  resolvePatientSpeechName,
} from "@/lib/queue/utils";
import { TodayAppointmentsPanel } from "@/components/operations/TodayAppointmentsPanel";
import { InProgressOverridePanel } from "@/components/queue/InProgressOverridePanel";
import { resolveAppointmentPaymentUrl } from "@/lib/ledger/open-appointment-payment";
import { PatientSearchField } from "@/components/patients/PatientSearchField";
import { getPatientDisplayPhone } from "@/lib/phone";
import { useLanguage } from "@/contexts/LanguageContext";
import { getQueueStatusLabel, type QueueStatusKey } from "@/i18n/localized-labels";
import type { Language, TranslationKey } from "@/i18n/translations";
import type { PatientSearchResult } from "@/lib/services/patient-search";
import {
  Users, Clock, CheckCircle2, UserCheck, Plus, Volume2,
  RefreshCw, Monitor, Phone, X, ChevronRight, Send, RotateCcw, Receipt, LogOut,
  ArrowRightLeft,
} from "lucide-react";
import { QueueScreenSetupButton } from "@/components/queue/QueueScreenSetupModal";

type QueueStatus =
  | "waiting"
  | "called"
  | "in_progress"
  | "ready_for_billing"
  | "ready_for_payment"
  | "done"
  | "cancelled";

interface QueueEntry {
  id: string;
  ticket_number: number;
  status: QueueStatus;
  patient_name: string | null;
  patient_phone: string | null;
  patient_id: string | null;
  doctor_id: string;
  created_at: string;
  called_at: string | null;
  entered_at: string | null;
  sent_to_doctor_at: string | null;
  appointment_id: string | null;
  transfer_to_doctor_id: string | null;
  transfer_requested_at: string | null;
  cancellation_requested_at: string | null;
  cancellation_actor_label: string | null;
  notes: string | null;
  doctor: { full_name_ar: string } | null;
  transfer_to_doctor?: { full_name_ar: string } | null;
  patient: { full_name_ar: string; speech_name_ar?: string | null } | null;
}

interface Doctor {
  id: string;
  full_name_ar: string;
  specialty_ar: string | null;
}

interface QueueStats {
  waiting: number;
  called: number;
  in_progress: number;
  ready_for_billing: number;
  ready_for_payment: number;
  done: number;
  total: number;
}

const STATUS_STYLE: Record<QueueStatus, { color: string; bg: string; border: string }> = {
  waiting:     { color: "text-amber-600",  bg: "bg-amber-50",   border: "border-amber-200" },
  called:      { color: "text-blue-600",   bg: "bg-blue-50",    border: "border-blue-200"  },
  in_progress: { color: "text-emerald-600",bg: "bg-emerald-50", border: "border-emerald-200"},
  ready_for_billing: { color: "text-violet-600", bg: "bg-violet-50", border: "border-violet-200" },
  ready_for_payment: { color: "text-violet-600", bg: "bg-violet-50", border: "border-violet-200" },
  done:        { color: "text-slate-500",  bg: "bg-slate-50",   border: "border-slate-200" },
  cancelled:   { color: "text-red-500",    bg: "bg-red-50",     border: "border-red-200"   },
};

const NEXT_STATUS: Partial<Record<QueueStatus, QueueStatus>> = {
  waiting: "called",
  called: "in_progress",
};

function AddToQueueModal({
  doctors,
  onClose,
  onAdd,
}: {
  doctors: Doctor[];
  onClose: () => void;
  onAdd: (data: {
    doctor_id: string;
    patient_name: string;
    patient_phone: string;
    patient_id?: string | null;
    send_to_doctor: boolean;
    notes?: string;
  }) => Promise<boolean>;
}) {
  const { t } = useLanguage();
  const [doctorId, setDoctorId] = useState(doctors[0]?.id ?? "");
  const [name, setName]   = useState("");
  const [phone, setPhone] = useState("");
  const [notes, setNotes] = useState("");
  const [selectedPatientId, setSelectedPatientId] = useState<string | null>(null);
  const [sendNow, setSendNow] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  const handlePatientSelect = (patient: PatientSearchResult) => {
    setSelectedPatientId(patient.id);
    setName(patient.full_name_ar);
    setPhone(getPatientDisplayPhone(patient) ?? "");
  };

  async function handleSubmit() {
    if (!doctorId || submitting) return;
    const trimmedName = name.trim();
    if (!trimmedName) {
      setFormError(t("queuePatientNameRequired"));
      return;
    }

    setFormError(null);
    setSubmitting(true);
    try {
      const ok = await onAdd({
        doctor_id: doctorId,
        patient_name: trimmedName,
        patient_phone: phone.trim(),
        patient_id: selectedPatientId,
        send_to_doctor: sendNow,
        notes: notes.trim() || undefined,
      });
      if (ok) {
        onClose();
      }
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 sm:items-center">
      <div className="w-full max-w-md rounded-t-2xl bg-white p-6 shadow-2xl sm:rounded-2xl">
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-lg font-bold text-slate-800">{t("addToQueue")}</h2>
          <button onClick={onClose} className="rounded-lg p-1 hover:bg-slate-100">
            <X className="h-5 w-5 text-slate-500" />
          </button>
        </div>

        <div className="space-y-4">
          <div>
            <label className="mb-1 block text-sm font-medium text-slate-600">{t("selectDoctor")}</label>
            <select
              value={doctorId}
              onChange={(e) => setDoctorId(e.target.value)}
              className="w-full rounded-xl border border-slate-200 bg-slate-50 px-4 py-2.5 text-sm focus:border-primary focus:outline-none"
            >
              {doctors.map((d) => (
                <option key={d.id} value={d.id}>{d.full_name_ar}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="mb-1 block text-sm font-medium text-slate-600">{t("patientName")}</label>
            <PatientSearchField
              portal="accountant"
              value={name}
              selectedPatientId={selectedPatientId}
              onChange={(value) => {
                setName(value);
                setSelectedPatientId(null);
              }}
              onSelect={handlePatientSelect}
              placeholder={t("queueSearchPlaceholder")}
              inputClassName="w-full rounded-xl border border-slate-200 bg-slate-50 py-2.5 pr-10 pl-4 text-sm focus:border-primary focus:outline-none"
            />
            {selectedPatientId && (
              <p className="mt-1 text-xs text-emerald-600">{t("queueLinkedPatient")}</p>
            )}
          </div>
          <div>
            <label className="mb-1 block text-sm font-medium text-slate-600">{t("patientPhone")}</label>
            <input
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              placeholder="07xxxxxxxx"
              className="w-full rounded-xl border border-slate-200 bg-slate-50 px-4 py-2.5 text-sm focus:border-primary focus:outline-none"
            />
          </div>
          <div>
            <label className="mb-1 block text-sm font-medium text-slate-600">{t("queueIntakeNotes")}</label>
            <textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder={t("queueIntakeNotesPlaceholder")}
              rows={3}
              className="w-full resize-none rounded-xl border border-slate-200 bg-slate-50 px-4 py-2.5 text-sm focus:border-primary focus:outline-none"
            />
            <p className="mt-1 text-xs text-slate-500">{t("queueIntakeNotesHint")}</p>
          </div>
          <label className="flex cursor-pointer items-center gap-2 text-sm text-slate-600">
            <input
              type="checkbox"
              checked={sendNow}
              onChange={(e) => setSendNow(e.target.checked)}
              className="h-4 w-4 rounded border-slate-300 text-primary"
            />
            {t("queueNotifyDoctor")}
          </label>
          {formError && (
            <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">
              {formError}
            </p>
          )}
        </div>

        <div className="mt-6 flex gap-3">
          <button
            type="button"
            onClick={onClose}
            disabled={submitting}
            className="flex-1 rounded-xl border border-slate-200 py-2.5 text-sm font-medium text-slate-600 hover:bg-slate-50 disabled:opacity-60"
          >
            {t("cancel")}
          </button>
          <button
            type="button"
            disabled={submitting || !doctorId}
            onClick={() => void handleSubmit()}
            className="flex-1 rounded-xl bg-primary py-2.5 text-sm font-bold text-white hover:bg-primary/90 disabled:opacity-60"
          >
            {submitting
              ? t("queueAddingPatient")
              : sendNow
                ? t("queueAddAndSend")
                : t("queueAddOnly")}
          </button>
        </div>
      </div>
    </div>
  );
}

function StatCard({ label, value, icon: Icon, color }: {
  label: string; value: number; icon: React.ComponentType<{ className?: string }>; color: string;
}) {
  return (
    <div className="flex items-center gap-3 rounded-2xl border border-slate-100 bg-white p-4 shadow-sm">
      <div className={cn("flex h-10 w-10 items-center justify-center rounded-xl", color)}>
        <Icon className="h-5 w-5" />
      </div>
      <div>
        <p className="text-2xl font-bold text-slate-800">{value}</p>
        <p className="text-xs text-slate-500">{label}</p>
      </div>
    </div>
  );
}

async function apiJson<T>(
  url: string,
  lang: Language,
  t: (key: TranslationKey) => string,
  init?: RequestInit
): Promise<T> {
  let res: Response;
  try {
    res = await fetch(url, {
      ...init,
      credentials: "include",
      headers: {
        "Content-Type": "application/json",
        ...authPortalHeaders("accountant"),
        ...init?.headers,
      },
    });
  } catch {
    throw new Error(t("errServerConnection"));
  }

  let data: T & { error?: string };
  try {
    data = (await res.json()) as T & { error?: string };
  } catch {
    throw new Error(t("errUnexpectedResponse"));
  }

  if (!res.ok) {
    throw new Error(translateDbError(data.error ?? t("errOperationFailed"), lang));
  }
  return data;
}

export default function QueuePage() {
  const router = useRouter();
  const supabase = createClient();
  const { t, lang, bi, dateLocale } = useLanguage();
  const [clinicId, setClinicId] = useState<string | null>(null);
  const [queue, setQueue]     = useState<QueueEntry[]>([]);
  const [doctors, setDoctors] = useState<Doctor[]>([]);
  const [stats, setStats]     = useState<QueueStats>({
    waiting: 0,
    called: 0,
    in_progress: 0,
    ready_for_billing: 0,
    ready_for_payment: 0,
    done: 0,
    total: 0,
  });
  const [loading, setLoading] = useState(true);
  const [pageError, setPageError] = useState<string | null>(null);
  const [pageSuccess, setPageSuccess] = useState<string | null>(null);
  const [showAdd, setShowAdd] = useState(false);
  const [updating, setUpdating] = useState<string | null>(null);
  const [filterDoctor, setFilterDoctor] = useState<string>("all");
  const [cancelTransferEntry, setCancelTransferEntry] = useState<QueueEntry | null>(null);
  const [cancelTransferTargetId, setCancelTransferTargetId] = useState("");

  const fetchQueue = useCallback(async () => {
    setPageError(null);
    try {
      const data = await apiJson<{
        queue: QueueEntry[];
        doctors: Doctor[];
        clinicId: string;
      }>("/api/queue", lang, t);

      setClinicId(data.clinicId);
      const rows = data.queue ?? [];
      setQueue(rows);
      const doctorRows = data.doctors ?? [];
      setDoctors(doctorRows);
      if (data.clinicId && doctorRows.length > 0) {
        cacheOfflineDoctors(data.clinicId, doctorRows);
      }

      setStats({
        waiting:     rows.filter((r) => r.status === "waiting").length,
        called:      rows.filter((r) => r.status === "called").length,
        in_progress: rows.filter((r) => r.status === "in_progress").length,
        ready_for_billing: rows.filter((r) => r.status === "ready_for_billing").length,
        ready_for_payment: rows.filter((r) => r.status === "ready_for_payment").length,
        done:        rows.filter((r) => r.status === "done").length,
        total:       rows.length,
      });
    } catch (err) {
      setPageError(err instanceof Error ? err.message : t("errQueueLoad"));
    } finally {
      setLoading(false);
    }
  }, [lang, t]);

  useEffect(() => {
    fetchQueue();
  }, [fetchQueue]);

  useQueueListRefresh("clinic", clinicId, fetchQueue);

  const advanceStatus = async (entry: QueueEntry) => {
    setUpdating(entry.id);
    try {
      const data = await apiJson<{ status: QueueStatus }>(`/api/queue/${entry.id}`, lang, t, {
        method: "PATCH",
        body: JSON.stringify({ action: "advance" }),
      });

      if (data.status === "in_progress") {
        const name = resolvePatientSpeechName(entry);
        const doctorName = resolveDoctorSpeechName(entry.doctor);
        announcePatientCall(name, doctorName, "enter");
        if (clinicId) {
          notifyQueueRefresh({ scope: "clinic", clinicId });
          notifyQueueRefresh({ scope: "doctor", doctorId: entry.doctor_id });
        }
      }
      await fetchQueue();
    } catch (err) {
      setPageError(err instanceof Error ? err.message : t("errQueueUpdate"));
    } finally {
      setUpdating(null);
    }
  };

  const openPayment = async (entry: QueueEntry) => {
    if (!clinicId) return;
    setUpdating(entry.id);
    try {
      if (entry.status === "ready_for_billing") {
        await apiJson(`/api/queue/${entry.id}`, lang, t, {
          method: "PATCH",
          body: JSON.stringify({ action: "ready_for_payment" }),
        });
      }

      const href = await resolveAppointmentPaymentUrl({
        clinicId,
        appointmentId: entry.appointment_id,
        queueEntryId: entry.id,
        patientId: entry.patient_id,
        doctorId: entry.doctor_id,
        patientPhone: entry.patient_phone,
        patientNameAr: entry.patient_name,
      });
      router.push(href);
    } catch (err) {
      setPageError(err instanceof Error ? err.message : t("errOpenSession"));
    } finally {
      setUpdating(null);
    }
  };

  const finishExamination = async (entry: QueueEntry, openLedger = false) => {
    setUpdating(entry.id);
    try {
      const result = await apiJson<{ ledger_url?: string }>(`/api/queue/${entry.id}`, lang, t, {
        method: "PATCH",
        body: JSON.stringify({ action: "ready_for_payment" }),
      });
      if (clinicId) {
        notifyQueueRefresh({ scope: "clinic", clinicId });
        notifyQueueRefresh({ scope: "doctor", doctorId: entry.doctor_id });
      }
      if (openLedger && result.ledger_url) {
        router.push(result.ledger_url);
        return;
      }
      await fetchQueue();
    } catch (err) {
      setPageError(err instanceof Error ? err.message : t("errFinishExam"));
    } finally {
      setUpdating(null);
    }
  };

  const sendToDoctor = async (entry: QueueEntry) => {
    setUpdating(entry.id);
    try {
      await apiJson("/api/queue", lang, t, {
        method: "POST",
        body: JSON.stringify({ action: "send_to_doctor", queue_entry_id: entry.id }),
      });
      const name = resolvePatientSpeechName(entry);
      void broadcastPatientSentToDoctor(supabase, entry.doctor_id, {
        name,
        entryId: entry.id,
      });
      notifyQueueRefresh({ scope: "doctor", doctorId: entry.doctor_id });
      await fetchQueue();
    } catch (err) {
      setPageError(err instanceof Error ? err.message : t("errSendDoctor"));
    } finally {
      setUpdating(null);
    }
  };

  const recallPatient = async (entry: QueueEntry) => {
    setUpdating(entry.id);
    const name = resolvePatientSpeechName(entry);

    try {
      if (entry.status === "called" || entry.status === "in_progress") {
        await apiJson("/api/queue/screen/call", lang, t, {
          method: "POST",
          body: JSON.stringify({ entry_id: entry.id }),
        });
        return;
      }

      if (entry.status === "waiting" && entry.sent_to_doctor_at) {
        await apiJson("/api/queue", lang, t, {
          method: "POST",
          body: JSON.stringify({ action: "recall", queue_entry_id: entry.id }),
        });
        void broadcastPatientSentToDoctor(supabase, entry.doctor_id, {
          name,
          entryId: entry.id,
          recall: true,
        });
        notifyQueueRefresh({ scope: "doctor", doctorId: entry.doctor_id });
      }
    } catch (err) {
      setPageError(err instanceof Error ? err.message : t("errReCall"));
    } finally {
      setUpdating(null);
    }
  };

  const cancelEntry = async (entry: QueueEntry) => {
    const patient =
      entry.patient?.full_name_ar ?? entry.patient_name ?? `${bi("رقم", "Ticket #")} ${entry.ticket_number}`;
    const pendingCancel = Boolean(entry.cancellation_requested_at);
    if (
      !confirm(
        pendingCancel
          ? bi(
              `إلغاء حجز «${patient}» نهائياً؟`,
              `Permanently cancel booking for "${patient}"?`
            )
          : bi(
              `إلغاء دور «${patient}» نهائياً؟`,
              `Permanently cancel ticket for "${patient}"?`
            )
      )
    ) {
      return;
    }
    setUpdating(entry.id);
    try {
      await apiJson(`/api/queue/${entry.id}`, lang, t, {
        method: "PATCH",
        body: JSON.stringify({
          action: pendingCancel ? "finalize_cancel" : "cancel",
        }),
      });
      if (clinicId) {
        notifyQueueRefresh({ scope: "clinic", clinicId });
        notifyQueueRefresh({ scope: "doctor", doctorId: entry.doctor_id });
      }
      await fetchQueue();
    } catch (err) {
      setPageError(err instanceof Error ? err.message : t("errCancel"));
    } finally {
      setUpdating(null);
    }
  };

  const submitCancelTransfer = async () => {
    if (!cancelTransferEntry || !cancelTransferTargetId) return;
    const patient =
      cancelTransferEntry.patient?.full_name_ar ??
      cancelTransferEntry.patient_name ??
      t("queueUnnamedPatient");
    if (
      !confirm(
        bi(
          `تحويل «${patient}» إلى الطبيب المختار؟`,
          `Transfer "${patient}" to the selected doctor?`
        )
      )
    ) {
      return;
    }
    setUpdating(cancelTransferEntry.id);
    try {
      await apiJson(`/api/queue/${cancelTransferEntry.id}`, lang, t, {
        method: "PATCH",
        body: JSON.stringify({
          action: "transfer_after_cancel",
          target_doctor_id: cancelTransferTargetId,
        }),
      });
      if (clinicId) {
        notifyQueueRefresh({ scope: "clinic", clinicId });
        notifyQueueRefresh({ scope: "doctor", doctorId: cancelTransferTargetId });
        notifyQueueRefresh({ scope: "doctor", doctorId: cancelTransferEntry.doctor_id });
        void broadcastPatientSentToDoctor(supabase, cancelTransferTargetId, {
          name: patient,
          entryId: cancelTransferEntry.id,
        });
      }
      setCancelTransferEntry(null);
      setCancelTransferTargetId("");
      await fetchQueue();
    } catch (err) {
      setPageError(err instanceof Error ? err.message : t("errTransferConfirm"));
    } finally {
      setUpdating(null);
    }
  };

  const confirmTransfer = async (entry: QueueEntry) => {
    const target = entry.transfer_to_doctor?.full_name_ar ?? t("queueNewDoctor");
    const patient =
      entry.patient?.full_name_ar ?? entry.patient_name ?? `${bi("رقم", "Ticket #")} ${entry.ticket_number}`;
    if (
      !confirm(
        bi(
          `تأكيد تحويل «${patient}» إلى ${target}؟`,
          `Confirm transfer of "${patient}" to ${target}?`
        )
      )
    )
      return;

    setUpdating(entry.id);
    try {
      await apiJson(`/api/queue/${entry.id}`, lang, t, {
        method: "PATCH",
        body: JSON.stringify({ action: "confirm_transfer" }),
      });
      const targetDoctorId = entry.transfer_to_doctor_id;
      if (targetDoctorId) {
        notifyQueueRefresh({ scope: "doctor", doctorId: targetDoctorId });
        void broadcastPatientSentToDoctor(supabase, targetDoctorId, {
          name: patient,
          entryId: entry.id,
        });
      }
      if (clinicId) {
        notifyQueueRefresh({ scope: "clinic", clinicId });
        notifyQueueRefresh({ scope: "doctor", doctorId: entry.doctor_id });
      }
      await fetchQueue();
    } catch (err) {
      setPageError(err instanceof Error ? err.message : t("errTransferConfirm"));
    } finally {
      setUpdating(null);
    }
  };

  const dismissTransfer = async (entry: QueueEntry) => {
    setUpdating(entry.id);
    try {
      await apiJson(`/api/queue/${entry.id}`, lang, t, {
        method: "PATCH",
        body: JSON.stringify({ action: "dismiss_transfer" }),
      });
      if (clinicId) {
        notifyQueueRefresh({ scope: "clinic", clinicId });
        notifyQueueRefresh({ scope: "doctor", doctorId: entry.doctor_id });
      }
      await fetchQueue();
    } catch (err) {
      setPageError(err instanceof Error ? err.message : t("errTransferCancel"));
    } finally {
      setUpdating(null);
    }
  };

  const addToQueue = async (data: {
    doctor_id: string;
    patient_name: string;
    patient_phone: string;
    patient_id?: string | null;
    send_to_doctor: boolean;
    notes?: string;
  }): Promise<boolean> => {
    setPageSuccess(null);
    const offlineAttempt = await tryEnqueueQueueAddOffline({
      clinicId,
      doctorId: data.doctor_id,
      patientName: data.patient_name,
      patientPhone: data.patient_phone,
      patientId: data.patient_id,
      sendToDoctor: data.send_to_doctor !== false,
      notes: data.notes,
    });
    if (offlineAttempt.handled) {
      if (offlineAttempt.ok) {
        setPageSuccess(offlineAttempt.message);
        setShowAdd(false);
        setPageError(null);
        return true;
      }
      setPageError(offlineAttempt.message);
      return false;
    }

    try {
      const result = await apiJson<{ id: string; doctor_id?: string }>("/api/queue", lang, t, {
        method: "POST",
        body: JSON.stringify({
          doctor_id: data.doctor_id,
          patient_name: data.patient_name,
          patient_phone: data.patient_phone,
          patient_id: data.patient_id ?? undefined,
          send_to_doctor: data.send_to_doctor !== false,
          notes: data.notes?.trim() || undefined,
        }),
      });
      setShowAdd(false);
      setPageError(null);
      setPageSuccess(
        bi(
          `✓ تمت إضافة «${data.patient_name.trim()}» للطابور`,
          `✓ Added "${data.patient_name.trim()}" to the queue`
        )
      );
      const targetDoctorId = result.doctor_id ?? data.doctor_id;
      const name = data.patient_name.trim() || t("queueDefaultPatient");
      void broadcastPatientSentToDoctor(supabase, targetDoctorId, {
        name,
        entryId: result.id,
        notes: data.notes?.trim() || undefined,
      });
      notifyQueueRefresh({ scope: "doctor", doctorId: targetDoctorId });
      notifyQueueRefresh({ scope: "clinic", clinicId: clinicId ?? undefined });
      void fetchQueue();
      return true;
    } catch (err) {
      setPageError(err instanceof Error ? err.message : t("errAddQueue"));
      return false;
    }
  };

  const filtered = filterDoctor === "all"
    ? queue
    : queue.filter((e) => e.doctor_id === filterDoctor);

  const activeEntries = filtered.filter((e) => e.status !== "done");
  const doneEntries   = filtered.filter((e) => e.status === "done");
  const inProgressEntries = filtered.filter((e) => e.status === "in_progress");

  if (loading) {
    return (
      <div className="flex min-h-[60vh] items-center justify-center">
        <div className="h-8 w-8 animate-spin rounded-full border-4 border-primary/20 border-t-primary" />
      </div>
    );
  }

  if (!clinicId && pageError) {
    return (
      <Alert variant="error">
        {pageError}
        <p className="mt-2 text-sm">{t("queueClinicSetupHint")}</p>
      </Alert>
    );
  }

  return (
    <>
    <div className="mx-auto max-w-6xl space-y-6">

      {pageError && (
        <Alert variant="error">{pageError}</Alert>
      )}
      {pageSuccess && (
        <Alert variant="success">{pageSuccess}</Alert>
      )}

      <TodayAppointmentsPanel compact onApprovedToQueue={fetchQueue} />

      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-slate-800">{t("queueTitle")}</h1>
          <p className="text-sm text-slate-500">
            {new Date().toLocaleDateString(dateLocale, { weekday: "long", year: "numeric", month: "long", day: "numeric" })}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <QueueScreenSetupButton
            className="flex items-center gap-2 rounded-xl border border-primary/30 bg-primary/5 px-4 py-2 text-sm font-medium text-primary shadow-sm hover:bg-primary/10"
            label="ربط التلفاز"
          />
          <a
            href={clinicId ? `/queue-screen?clinic=${clinicId}` : "/queue-screen"}
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-4 py-2 text-sm font-medium text-slate-600 shadow-sm hover:bg-slate-50"
          >
            <Monitor className="h-4 w-4" />
            {t("queuePatientScreen")}
          </a>
          <button
            onClick={() => fetchQueue()}
            className="flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-4 py-2 text-sm font-medium text-slate-600 shadow-sm hover:bg-slate-50"
          >
            <RefreshCw className="h-4 w-4" />
            {t("queueRefresh")}
          </button>
          <button
            onClick={() => setShowAdd(true)}
            className="flex items-center gap-2 rounded-xl bg-primary px-4 py-2 text-sm font-bold text-white shadow-sm hover:bg-primary/90"
          >
            <Plus className="h-4 w-4" />
            {t("queueAddPatientBtn")}
          </button>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
        <StatCard label={t("waitingCount")}   value={stats.waiting}     icon={Clock}        color="bg-amber-100 text-amber-600"   />
        <StatCard label={t("calledStatus")}      value={stats.called}      icon={Volume2}      color="bg-blue-100 text-blue-600"     />
        <StatCard label={t("inProgressStatus")}    value={stats.in_progress} icon={UserCheck}    color="bg-emerald-100 text-emerald-600"/>
        <StatCard label={t("apptStatus_ready_for_billing")}   value={stats.ready_for_billing} icon={Receipt} color="bg-violet-100 text-violet-600"/>
        <StatCard label={t("apptStatus_ready_for_payment")}    value={stats.ready_for_payment} icon={Receipt} color="bg-violet-100 text-violet-600"/>
        <StatCard label={t("doneToday")}  value={stats.done}        icon={CheckCircle2} color="bg-slate-100 text-slate-600"   />
      </div>

      <div className="flex flex-col gap-6 lg:flex-row lg:items-start">
        <div className="w-full shrink-0 lg:sticky lg:top-4 lg:w-72">
          <InProgressOverridePanel
            entries={inProgressEntries}
            updatingId={updating}
            onOverride={(entry) => void finishExamination(entry as QueueEntry, true)}
          />
        </div>

        <div className="min-w-0 flex-1 space-y-6">

      {doctors.length > 1 && (
        <div className="flex flex-wrap gap-2">
          <button
            onClick={() => setFilterDoctor("all")}
            className={cn(
              "rounded-full px-4 py-1.5 text-sm font-medium transition-colors",
              filterDoctor === "all"
                ? "bg-primary text-white"
                : "bg-white border border-slate-200 text-slate-600 hover:bg-slate-50"
            )}
          >
            {t("queueAllDoctors")}
          </button>
          {doctors.map((d) => (
            <button
              key={d.id}
              onClick={() => setFilterDoctor(d.id)}
              className={cn(
                "rounded-full px-4 py-1.5 text-sm font-medium transition-colors",
                filterDoctor === d.id
                  ? "bg-primary text-white"
                  : "bg-white border border-slate-200 text-slate-600 hover:bg-slate-50"
              )}
            >
              {d.full_name_ar}
            </button>
          ))}
        </div>
      )}

      <div className="space-y-3">
        {activeEntries.length === 0 ? (
          <div className="flex flex-col items-center justify-center rounded-2xl border border-dashed border-slate-200 bg-white py-16 text-center">
            <Users className="mb-3 h-10 w-10 text-slate-300" />
            <p className="font-medium text-slate-500">{t("queueEmpty")}</p>
            <p className="text-sm text-slate-400">{t("queueEmptyHint")}</p>
          </div>
        ) : (
          activeEntries.map((entry) => {
            const style = STATUS_STYLE[entry.status];
            const statusLabel = getQueueStatusLabel(t, entry.status as QueueStatusKey);
            const cfg = { ...style, label: statusLabel };
            const patientDisplay = entry.patient?.full_name_ar ?? entry.patient_name ?? t("queueUnnamedPatient");
            const nextAction = NEXT_STATUS[entry.status];
            const nextLabel =
              entry.status === "waiting"
                ? t("callNext")
                : entry.status === "called"
                  ? t("queueEnterArrow")
                  : undefined;
            const canCheckout =
              entry.status === "ready_for_billing" ||
              entry.status === "ready_for_payment";
            const transferPending = Boolean(entry.transfer_to_doctor_id);
            const cancellationPending = Boolean(entry.cancellation_requested_at);
            const canSend =
              entry.status === "waiting" &&
              !entry.sent_to_doctor_at &&
              !transferPending &&
              !cancellationPending;
            const canRecall =
              !cancellationPending &&
              (entry.status === "called" ||
              entry.status === "in_progress" ||
              (entry.status === "waiting" && !!entry.sent_to_doctor_at));
            const recallLabel =
              entry.status === "waiting" && entry.sent_to_doctor_at
                ? t("queueReCallDoctorTitle")
                : t("queueReCallTitle");

            return (
              <div
                key={entry.id}
                className={cn(
                  "flex items-center gap-4 rounded-2xl border bg-white p-4 shadow-sm transition-all",
                  transferPending
                    ? "border-violet-300 ring-1 ring-violet-200"
                    : cancellationPending
                      ? "border-red-300 ring-1 ring-red-200"
                      : cfg.border
                )}
              >
                <div className={cn(
                  "flex h-12 w-12 flex-shrink-0 items-center justify-center rounded-xl text-xl font-black",
                  cfg.bg, cfg.color
                )}>
                  {entry.ticket_number}
                </div>

                <div className="min-w-0 flex-1">
                  <p className="truncate font-semibold text-slate-800">{patientDisplay}</p>
                  <div className="flex flex-wrap items-center gap-3 text-xs text-slate-500">
                    <span className={cn("font-medium", cfg.color)}>{cfg.label}</span>
                    {entry.sent_to_doctor_at && (
                      <>
                        <span>•</span>
                        <span className="text-emerald-600">{t("queueSentToDoctor")}</span>
                      </>
                    )}
                    {transferPending && (
                      <>
                        <span>•</span>
                        <span className="font-medium text-violet-700">
                          {t("queueTransferTo")} {entry.transfer_to_doctor?.full_name_ar ?? "—"}
                        </span>
                      </>
                    )}
                    {cancellationPending && (
                      <>
                        <span>•</span>
                        <span className="font-medium text-red-700">
                          {bi("طلب إلغاء", "Cancel request")}:{" "}
                          {entry.cancellation_actor_label ?? "—"}
                        </span>
                      </>
                    )}
                    <span>•</span>
                    <span>{entry.doctor?.full_name_ar ?? "—"}</span>
                    {entry.patient_phone && (
                      <>
                        <span>•</span>
                        <a
                          href={`https://wa.me/${entry.patient_phone.replace(/\D/g, "")}`}
                          target="_blank"
                          className="flex items-center gap-0.5 text-green-600 hover:underline"
                        >
                          <Phone className="h-3 w-3" />
                          {entry.patient_phone}
                        </a>
                      </>
                    )}
                    {entry.notes?.trim() && (
                      <>
                        <span>•</span>
                        <span className="text-slate-600">{entry.notes.trim()}</span>
                      </>
                    )}
                  </div>
                </div>

                <div className="flex flex-wrap items-center justify-end gap-2">
                  {cancellationPending && (
                    <>
                      <button
                        onClick={() => {
                          setCancelTransferEntry(entry);
                          setCancelTransferTargetId("");
                        }}
                        disabled={updating === entry.id}
                        className="flex items-center gap-1.5 rounded-xl bg-violet-600 px-3 py-2 text-sm font-bold text-white hover:bg-violet-700 disabled:opacity-60"
                      >
                        <ArrowRightLeft className="h-3.5 w-3.5" />
                        <span className="hidden sm:inline">
                          {bi("تحويل لطبيب", "Transfer doctor")}
                        </span>
                      </button>
                      <button
                        onClick={() => void cancelEntry(entry)}
                        disabled={updating === entry.id}
                        className="flex items-center gap-1.5 rounded-xl bg-red-600 px-3 py-2 text-sm font-bold text-white hover:bg-red-700 disabled:opacity-60"
                      >
                        <X className="h-3.5 w-3.5" />
                        <span className="hidden sm:inline">
                          {bi("إلغاء نهائي", "Cancel booking")}
                        </span>
                      </button>
                    </>
                  )}
                  {transferPending && !cancellationPending && (
                    <>
                      <button
                        onClick={() => void confirmTransfer(entry)}
                        disabled={updating === entry.id}
                        className="flex items-center gap-1.5 rounded-xl bg-violet-600 px-3 py-2 text-sm font-bold text-white hover:bg-violet-700 disabled:opacity-60"
                      >
                        {updating === entry.id ? (
                          <RefreshCw className="h-3.5 w-3.5 animate-spin" />
                        ) : (
                          <ArrowRightLeft className="h-3.5 w-3.5" />
                        )}
                        <span className="hidden sm:inline">{t("queueConfirmTransfer")}</span>
                      </button>
                      <button
                        onClick={() => void dismissTransfer(entry)}
                        disabled={updating === entry.id}
                        className="rounded-xl border border-slate-200 px-3 py-2 text-sm font-medium text-slate-600 hover:bg-slate-50 disabled:opacity-60"
                      >
                        {t("queueRejectTransferBtn")}
                      </button>
                    </>
                  )}
                  {canRecall && (
                    <button
                      onClick={() => recallPatient(entry)}
                      disabled={updating === entry.id}
                      className="flex items-center gap-1.5 rounded-xl border border-blue-200 bg-blue-50 px-3 py-2 text-sm font-bold text-blue-700 hover:bg-blue-100 disabled:opacity-60"
                      title={recallLabel}
                    >
                      {updating === entry.id
                        ? <RefreshCw className="h-3.5 w-3.5 animate-spin" />
                        : <RotateCcw className="h-3.5 w-3.5" />
                      }
                      <span className="hidden sm:inline">{recallLabel}</span>
                    </button>
                  )}
                  {canSend && (
                    <button
                      onClick={() => sendToDoctor(entry)}
                      disabled={updating === entry.id}
                      className="flex items-center gap-1.5 rounded-xl bg-violet-600 px-3 py-2 text-sm font-bold text-white hover:bg-violet-700 disabled:opacity-60"
                      title={t("queueSendDoctorTitle")}
                    >
                      {updating === entry.id
                        ? <RefreshCw className="h-3.5 w-3.5 animate-spin" />
                        : <Send className="h-3.5 w-3.5" />
                      }
                      <span className="hidden sm:inline">{t("queueSendDoctorTitle")}</span>
                    </button>
                  )}
                  {entry.status === "in_progress" && (
                    <button
                      onClick={() => finishExamination(entry, true)}
                      disabled={updating === entry.id}
                      className="flex items-center gap-1.5 rounded-xl bg-violet-600 px-3 py-2 text-sm font-bold text-white hover:bg-violet-700 disabled:opacity-60"
                      title={t("queueFinishTitle")}
                    >
                      {updating === entry.id
                        ? <RefreshCw className="h-3.5 w-3.5 animate-spin" />
                        : <LogOut className="h-3.5 w-3.5" />
                      }
                      <span className="hidden sm:inline">{t("queueFinishShort")}</span>
                    </button>
                  )}
                  {canCheckout && (
                    <button
                      onClick={() => openPayment(entry)}
                      disabled={updating === entry.id}
                      className="flex items-center gap-1.5 rounded-xl bg-violet-600 px-3 py-2 text-sm font-bold text-white hover:bg-violet-700 disabled:opacity-60"
                    >
                      {updating === entry.id ? (
                        <RefreshCw className="h-3.5 w-3.5 animate-spin" />
                      ) : (
                        <Receipt className="h-3.5 w-3.5" />
                      )}
                      <span className="hidden sm:inline">{t("apptPay")}</span>
                    </button>
                  )}
                  {nextAction && !transferPending && !cancellationPending && (
                    <button
                      onClick={() => advanceStatus(entry)}
                      disabled={updating === entry.id}
                      className={cn(
                        "flex items-center gap-1.5 rounded-xl px-3 py-2 text-sm font-bold transition-colors",
                        entry.status === "called"
                          ? "bg-blue-500 text-white hover:bg-blue-600"
                          : "bg-amber-500 text-white hover:bg-amber-600",
                        updating === entry.id && "opacity-60"
                      )}
                    >
                      {updating === entry.id
                        ? <RefreshCw className="h-3.5 w-3.5 animate-spin" />
                        : <ChevronRight className="h-3.5 w-3.5" />
                      }
                      <span className="hidden sm:inline">{nextLabel}</span>
                    </button>
                  )}
                  {!cancellationPending && (
                    <button
                      onClick={() => void cancelEntry(entry)}
                      className="rounded-xl p-2 text-slate-400 hover:bg-red-50 hover:text-red-500"
                      title={t("queueCancelTitle")}
                    >
                      <X className="h-4 w-4" />
                    </button>
                  )}
                </div>
              </div>
            );
          })
        )}
      </div>

      {doneEntries.length > 0 && (
        <details className="group rounded-2xl border border-slate-100 bg-white">
          <summary className="flex cursor-pointer list-none items-center justify-between px-4 py-3 text-sm font-medium text-slate-500 hover:text-slate-700">
            <span>{t("queueDoneTodaySection")} ({doneEntries.length})</span>
            <ChevronRight className="h-4 w-4 transition-transform group-open:rotate-90" />
          </summary>
          <div className="border-t border-slate-100 p-2 space-y-1">
            {doneEntries.map((entry) => (
              <div key={entry.id} className="flex items-center gap-3 rounded-xl px-3 py-2 text-sm text-slate-400">
                <span className="w-6 text-center font-bold">#{entry.ticket_number}</span>
                <span className="flex-1 truncate">
                  {entry.patient?.full_name_ar ?? entry.patient_name ?? "—"}
                </span>
                <span className="text-xs">{entry.doctor?.full_name_ar}</span>
                <CheckCircle2 className="h-4 w-4 text-emerald-400" />
              </div>
            ))}
          </div>
        </details>
      )}

        </div>
      </div>

      {cancelTransferEntry && (
        <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 sm:items-center">
          <div className="w-full max-w-md rounded-t-2xl bg-white p-6 shadow-2xl sm:rounded-2xl">
            <div className="mb-4 flex items-center justify-between">
              <h3 className="text-lg font-bold text-slate-800">
                {bi("تحويل المراجع لطبيب آخر", "Transfer patient to another doctor")}
              </h3>
              <button
                type="button"
                onClick={() => {
                  setCancelTransferEntry(null);
                  setCancelTransferTargetId("");
                }}
                className="rounded-lg p-1 hover:bg-slate-100"
              >
                <X className="h-5 w-5 text-slate-500" />
              </button>
            </div>
            <p className="mb-4 text-sm text-slate-600">
              {bi(
                "بعد طلب الإلغاء من الطبيب/المساعد — اختر الطبيب الجديد",
                "After doctor/assistant cancel request — choose the new doctor"
              )}
            </p>
            <select
              value={cancelTransferTargetId}
              onChange={(e) => setCancelTransferTargetId(e.target.value)}
              className="w-full rounded-xl border border-slate-200 bg-slate-50 px-4 py-2.5 text-sm focus:border-primary focus:outline-none"
            >
              <option value="">{t("selectDoctor")}</option>
              {doctors
                .filter((d) => d.id !== cancelTransferEntry.doctor_id)
                .map((d) => (
                  <option key={d.id} value={d.id}>
                    {d.full_name_ar}
                    {d.specialty_ar ? ` — ${d.specialty_ar}` : ""}
                  </option>
                ))}
            </select>
            <div className="mt-6 flex gap-3">
              <button
                type="button"
                onClick={() => {
                  setCancelTransferEntry(null);
                  setCancelTransferTargetId("");
                }}
                className="flex-1 rounded-xl border border-slate-200 py-2.5 text-sm font-medium text-slate-600"
              >
                {t("cancel")}
              </button>
              <button
                type="button"
                onClick={() => void submitCancelTransfer()}
                disabled={!cancelTransferTargetId || updating === cancelTransferEntry.id}
                className="flex-1 rounded-xl bg-violet-600 py-2.5 text-sm font-bold text-white disabled:opacity-60"
              >
                {bi("تأكيد التحويل", "Confirm transfer")}
              </button>
            </div>
          </div>
        </div>
      )}

      {showAdd && (
        <AddToQueueModal
          doctors={doctors}
          onClose={() => setShowAdd(false)}
          onAdd={addToQueue}
        />
      )}
    </div>
    </>
  );
}
