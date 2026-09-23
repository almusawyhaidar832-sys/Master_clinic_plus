"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { translateDbError } from "@/lib/db-errors";
import { cn } from "@/lib/utils";
import { Alert } from "@/components/ui/Alert";
import { authPortalHeaders } from "@/lib/auth/api-portal";
import { broadcastPatientSentToDoctor } from "@/lib/queue/broadcast";
import { tryEnqueueQueueAddOffline } from "@/lib/offline/queue-add/enqueue";
import { cacheOfflineDoctors } from "@/lib/offline/reference-cache";
import { useQueueRealtimeSync } from "@/hooks/useQueueRealtimeSync";
import {
  fetchClinicDoctorsFromSupabase,
  fetchTodayQueueFromSupabase,
} from "@/lib/queue/queue-client-fetch";
import { announcePatientCall } from "@/lib/queue/realtime-client";
import {
  resolveDoctorSpeechName,
  resolvePatientDisplayName,
  resolvePatientSpeechName,
} from "@/lib/queue/utils";
import { resolvePatientGender } from "@/lib/queue/patient-gender";
import { TodayAppointmentsPanel } from "@/components/operations/TodayAppointmentsPanel";
import { InProgressOverridePanel } from "@/components/queue/InProgressOverridePanel";
import { resolveAppointmentPaymentUrl } from "@/lib/ledger/open-appointment-payment";
import { PatientSearchField } from "@/components/patients/PatientSearchField";
import { getPatientDisplayPhone, validatePatientPhone } from "@/lib/phone";
import { useLanguage } from "@/contexts/LanguageContext";
import { useClinicProfile } from "@/contexts/ClinicProfileContext";
import { getQueueStatusLabel, type QueueStatusKey } from "@/i18n/localized-labels";
import type { Language, TranslationKey } from "@/i18n/translations";
import type { PatientSearchResult } from "@/lib/services/patient-search";
import {
  Users, Clock, CheckCircle2, UserCheck, Plus, Volume2,
  RefreshCw, Monitor, Phone, X, ChevronRight, Send, RotateCcw, Receipt, LogOut,
  ArrowRightLeft, ListOrdered, UserPlus, Stethoscope, StickyNote, Wallet,
  ChevronDown, AlertTriangle, MessageSquareText,
} from "lucide-react";
import { QueueScreenSetupButton } from "@/components/queue/QueueScreenSetupModal";
import { PageHeader } from "@/components/ui/PageHeader";
import { StatTile } from "@/components/ui/StatTile";
import { Modal } from "@/components/ui/Modal";
import { EmptyState } from "@/components/ui/EmptyState";

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
  doctor_notes: string | null;
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

const STATUS_STYLE: Record<
  QueueStatus,
  { color: string; bg: string; border: string; bar: string; pill: string; active: boolean }
> = {
  waiting: {
    color: "text-warning-text",
    bg: "bg-warning",
    border: "border-warning-border",
    bar: "bg-amber-400",
    pill: "border-warning-border bg-warning text-warning-text",
    active: false,
  },
  called: {
    color: "text-primary-700",
    bg: "bg-primary-50",
    border: "border-primary-200",
    bar: "bg-primary-500",
    pill: "border-primary-200 bg-primary-50 text-primary-700",
    active: true,
  },
  in_progress: {
    color: "text-success-text",
    bg: "bg-success",
    border: "border-success-border",
    bar: "bg-emerald-500",
    pill: "border-success-border bg-success text-success-text",
    active: true,
  },
  ready_for_billing: {
    color: "text-royal-700",
    bg: "bg-royal-50",
    border: "border-royal-200",
    bar: "bg-royal-500",
    pill: "border-royal-200 bg-royal-50 text-royal-700",
    active: true,
  },
  ready_for_payment: {
    color: "text-royal-700",
    bg: "bg-royal-50",
    border: "border-royal-200",
    bar: "bg-royal-500",
    pill: "border-royal-200 bg-royal-50 text-royal-700",
    active: true,
  },
  done: {
    color: "text-slate-muted",
    bg: "bg-surface",
    border: "border-slate-border",
    bar: "bg-slate-300",
    pill: "border-slate-border bg-surface text-slate-muted",
    active: false,
  },
  cancelled: {
    color: "text-debt-text",
    bg: "bg-debt",
    border: "border-debt-border",
    bar: "bg-red-400",
    pill: "border-debt-border bg-debt text-debt-text",
    active: false,
  },
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
  const { t, bi } = useLanguage();
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
      const trimmedPhone = phone.trim();
      let normalizedPhone = "";
      if (trimmedPhone) {
        const phoneCheck = validatePatientPhone(trimmedPhone);
        if (!phoneCheck.ok) {
          setFormError(phoneCheck.message);
          return;
        }
        normalizedPhone = phoneCheck.normalized;
      }

      const ok = await onAdd({
        doctor_id: doctorId,
        patient_name: trimmedName,
        patient_phone: normalizedPhone,
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
    <Modal
      onClose={onClose}
      title={t("addToQueue")}
      subtitle={bi("تسجيل مراجع جديد في غرفة الانتظار", "Register a new patient in the waiting room")}
      icon={UserPlus}
      size="md"
      footer={
        <>
          <button
            type="button"
            onClick={onClose}
            disabled={submitting}
            className="mc-btn-soft flex-1 py-2.5"
          >
            {t("cancel")}
          </button>
          <button
            type="button"
            disabled={submitting || !doctorId}
            onClick={() => void handleSubmit()}
            className="mc-btn-navy flex-1 py-2.5"
          >
            {sendNow ? <Send className="h-4 w-4" /> : <Plus className="h-4 w-4" />}
            {submitting
              ? t("queueAddingPatient")
              : sendNow
                ? t("queueAddAndSend")
                : t("queueAddOnly")}
          </button>
        </>
      }
    >
      <div className="space-y-4">
        <div>
          <label className="mb-1.5 flex items-center gap-1.5 text-xs font-bold text-slate-muted">
            <Stethoscope className="h-3.5 w-3.5 text-premium-500" />
            {t("selectDoctor")}
          </label>
          <select
            value={doctorId}
            onChange={(e) => setDoctorId(e.target.value)}
            className="mc-field"
          >
            {doctors.map((d) => (
              <option key={d.id} value={d.id}>{d.full_name_ar}</option>
            ))}
          </select>
        </div>
        <div>
          <label className="mb-1.5 flex items-center gap-1.5 text-xs font-bold text-slate-muted">
            <Users className="h-3.5 w-3.5 text-premium-500" />
            {t("patientName")}
          </label>
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
            inputClassName="mc-field pr-10 pl-4"
          />
          {selectedPatientId && (
            <p className="mt-1.5 inline-flex items-center gap-1 rounded-full border border-success-border bg-success px-2.5 py-0.5 text-[11px] font-semibold text-success-text">
              <CheckCircle2 className="h-3 w-3" />
              {t("queueLinkedPatient")}
            </p>
          )}
        </div>
        <div>
          <label className="mb-1.5 flex items-center gap-1.5 text-xs font-bold text-slate-muted">
            <Phone className="h-3.5 w-3.5 text-premium-500" />
            {t("patientPhone")}
          </label>
          <input
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
            placeholder={t("queuePhonePlaceholder")}
            dir="ltr"
            inputMode="tel"
            className="mc-field"
          />
          <p className="mt-1 text-[11px] text-slate-muted">{t("queuePhoneHint")}</p>
        </div>
        <div>
          <label className="mb-1.5 flex items-center gap-1.5 text-xs font-bold text-slate-muted">
            <StickyNote className="h-3.5 w-3.5 text-premium-500" />
            {t("queueIntakeNotes")}
          </label>
          <textarea
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            placeholder={t("queueIntakeNotesPlaceholder")}
            rows={3}
            className="mc-field resize-none"
          />
          <p className="mt-1 text-[11px] text-slate-muted">{t("queueIntakeNotesHint")}</p>
        </div>
        <label className="flex cursor-pointer items-center gap-3 rounded-xl border border-slate-border bg-surface px-3.5 py-3 text-sm font-medium text-slate-text transition-colors hover:border-primary-200">
          <input
            type="checkbox"
            checked={sendNow}
            onChange={(e) => setSendNow(e.target.checked)}
            className="h-4 w-4 rounded border-slate-300 text-primary"
          />
          <Send className="h-4 w-4 text-premium-500" />
          {t("queueNotifyDoctor")}
        </label>
        {formError && (
          <Alert variant="error">{formError}</Alert>
        )}
      </div>
    </Modal>
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

function computeQueueStats(rows: QueueEntry[]): QueueStats {
  return {
    waiting: rows.filter((r) => r.status === "waiting").length,
    called: rows.filter((r) => r.status === "called").length,
    in_progress: rows.filter((r) => r.status === "in_progress").length,
    ready_for_billing: rows.filter((r) => r.status === "ready_for_billing").length,
    ready_for_payment: rows.filter((r) => r.status === "ready_for_payment").length,
    done: rows.filter((r) => r.status === "done").length,
    total: rows.length,
  };
}

export default function QueuePage() {
  const router = useRouter();
  const supabase = createClient();
  const { t, lang, bi, dateLocale } = useLanguage();
  const { profile: clinicProfile } = useClinicProfile();
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
  const [transferEntry, setTransferEntry] = useState<QueueEntry | null>(null);
  const [transferTargetId, setTransferTargetId] = useState("");

  const fetchQueue = useCallback(async () => {
    setPageError(null);
    const cid = clinicId ?? clinicProfile?.id;
    if (!cid) return;
    try {
      const [rows, doctorRows] = await Promise.all([
        fetchTodayQueueFromSupabase<QueueEntry>(supabase, {
          clinicId: cid,
          includeDone: true,
        }),
        fetchClinicDoctorsFromSupabase(supabase, cid),
      ]);

      setClinicId(cid);
      setQueue(rows);
      setDoctors(doctorRows);
      if (doctorRows.length > 0) {
        cacheOfflineDoctors(cid, doctorRows);
      }

      setStats(computeQueueStats(rows));
    } catch (err) {
      setPageError(err instanceof Error ? err.message : t("errQueueLoad"));
    } finally {
      setLoading(false);
    }
  }, [clinicId, clinicProfile?.id, supabase, t]);

  useEffect(() => {
    if (clinicProfile?.id || clinicId) void fetchQueue();
  }, [fetchQueue, clinicProfile?.id, clinicId]);

  useQueueRealtimeSync("clinic", clinicId ?? clinicProfile?.id ?? null, setQueue, {
    doctors,
    includeRow: (row) => String(row.status) !== "cancelled",
    onChange: (_payload, nextQueue) => setStats(computeQueueStats(nextQueue)),
  });

  const effectiveClinicId = clinicId ?? clinicProfile?.id ?? null;

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
      }
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
        patientNameAr: resolvePatientDisplayName(entry),
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
      if (openLedger && result.ledger_url) {
        router.push(result.ledger_url);
        return;
      }
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
    } catch (err) {
      setPageError(err instanceof Error ? err.message : t("errSendDoctor"));
    } finally {
      setUpdating(null);
    }
  };

  const recallPatient = async (entry: QueueEntry) => {
    setUpdating(entry.id);
    const name = resolvePatientSpeechName(entry);
    const doctorName = resolveDoctorSpeechName(entry.doctor);

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
        void broadcastPatientSentToDoctor(supabase, cancelTransferTargetId, {
          name: patient,
          entryId: cancelTransferEntry.id,
        });
      }
      setCancelTransferEntry(null);
      setCancelTransferTargetId("");
    } catch (err) {
      setPageError(err instanceof Error ? err.message : t("errTransferConfirm"));
    } finally {
      setUpdating(null);
    }
  };

  const submitTransfer = async () => {
    if (!transferEntry || !transferTargetId) return;
    const patient =
      transferEntry.patient?.full_name_ar ??
      transferEntry.patient_name ??
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
    setUpdating(transferEntry.id);
    try {
      await apiJson(`/api/queue/${transferEntry.id}`, lang, t, {
        method: "PATCH",
        body: JSON.stringify({
          action: "accountant_transfer",
          target_doctor_id: transferTargetId,
        }),
      });
      if (clinicId) {
        void broadcastPatientSentToDoctor(supabase, transferTargetId, {
          name: patient,
          entryId: transferEntry.id,
        });
      }
      setTransferEntry(null);
      setTransferTargetId("");
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
        void broadcastPatientSentToDoctor(supabase, targetDoctorId, {
          name: patient,
          entryId: entry.id,
        });
      }
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
      return true;
    } catch (err) {
      setPageError(err instanceof Error ? err.message : t("errAddQueue"));
      return false;
    }
  };

  const filtered = useMemo(
    () =>
      filterDoctor === "all"
        ? queue
        : queue.filter((e) => e.doctor_id === filterDoctor),
    [queue, filterDoctor]
  );

  const activeEntries = useMemo(
    () => filtered.filter((e) => e.status !== "done"),
    [filtered]
  );
  const doneEntries = useMemo(
    () => filtered.filter((e) => e.status === "done"),
    [filtered]
  );
  const inProgressEntries = useMemo(
    () => filtered.filter((e) => e.status === "in_progress"),
    [filtered]
  );

  if (loading) {
    return (
      <div className="mx-auto max-w-6xl space-y-6">
        <div className="mc-skeleton h-24 rounded-3xl" />
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
          {Array.from({ length: 6 }).map((_, i) => (
            <div key={i} className="mc-skeleton h-[76px] rounded-2xl" />
          ))}
        </div>
        <div className="space-y-3">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="mc-skeleton h-20 rounded-2xl" />
          ))}
        </div>
      </div>
    );
  }

  return (
    <>
    <div className="mx-auto max-w-6xl space-y-6 animate-fade-in">

      <PageHeader
        className="mb-0"
        title={t("queueTitle")}
        eyebrow={bi("العمليات اليومية", "Daily operations")}
        icon={ListOrdered}
        subtitle={new Date().toLocaleDateString(dateLocale, { weekday: "long", year: "numeric", month: "long", day: "numeric" })}
        actions={
          <>
            <QueueScreenSetupButton
              className="mc-btn-soft [&>svg]:text-premium-500"
              label="ربط التلفاز"
            />
            <a
              href={effectiveClinicId ? `/queue-screen?clinic=${effectiveClinicId}` : "/queue-screen"}
              target="_blank"
              rel="noopener noreferrer"
              className="mc-btn-soft"
            >
              <Monitor className="h-4 w-4 text-premium-500" />
              {t("queuePatientScreen")}
            </a>
            <button
              onClick={() => fetchQueue()}
              className="mc-btn-soft"
              title={t("queueRefresh")}
            >
              <RefreshCw className="h-4 w-4 text-premium-500" />
              <span className="hidden sm:inline">{t("queueRefresh")}</span>
            </button>
            <button
              onClick={() => setShowAdd(true)}
              className="mc-btn-navy"
            >
              <Plus className="h-4 w-4" />
              {t("queueAddPatientBtn")}
            </button>
          </>
        }
      />

      {pageError && (
        <Alert variant="error">
          {pageError}
          {pageError.includes("تسجيل الدخول") && (
            <p className="mt-2 text-sm">{t("queueClinicSetupHint")}</p>
          )}
        </Alert>
      )}
      {pageSuccess && (
        <Alert variant="success">{pageSuccess}</Alert>
      )}

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
        <StatTile label={t("waitingCount")} value={stats.waiting} icon={Clock} tone="warning" />
        <StatTile label={t("calledStatus")} value={stats.called} icon={Volume2} tone="navy" />
        <StatTile label={t("inProgressStatus")} value={stats.in_progress} icon={UserCheck} tone="success" />
        <StatTile label={t("apptStatus_ready_for_billing")} value={stats.ready_for_billing} icon={Receipt} tone="royal" />
        <StatTile label={t("apptStatus_ready_for_payment")} value={stats.ready_for_payment} icon={Wallet} tone="gold" />
        <StatTile label={t("doneToday")} value={stats.done} icon={CheckCircle2} tone="muted" />
      </div>

      <TodayAppointmentsPanel compact />

      <div className="flex flex-col gap-6 lg:flex-row lg:items-start">
        <div className="w-full shrink-0 lg:sticky lg:top-4 lg:w-72">
          <InProgressOverridePanel
            entries={inProgressEntries}
            updatingId={updating}
            onOverride={(entry) => void finishExamination(entry as QueueEntry, true)}
          />
        </div>

        <div className="min-w-0 flex-1 space-y-4">

      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="flex items-center gap-2.5 text-[15px] font-bold text-slate-text">
          <span className="mc-icon-tile h-8 w-8 rounded-lg">
            <Users className="h-4 w-4" />
          </span>
          {bi("المراجعون الحاليون", "Active patients")}
          <span className="rounded-full border border-premium-200 bg-premium-50 px-2 py-0.5 text-xs font-bold tabular-nums text-premium-700">
            {activeEntries.length}
          </span>
        </h2>
      </div>

      {doctors.length > 1 && (
        <div className="-mx-1 flex gap-2 overflow-x-auto px-1 pb-1 sm:flex-wrap sm:overflow-visible">
          <button
            onClick={() => setFilterDoctor("all")}
            className={cn(
              "mc-chip shrink-0",
              filterDoctor === "all" && "mc-chip--active"
            )}
          >
            <Users className="h-3.5 w-3.5" />
            {t("queueAllDoctors")}
          </button>
          {doctors.map((d) => (
            <button
              key={d.id}
              onClick={() => setFilterDoctor(d.id)}
              className={cn(
                "mc-chip shrink-0",
                filterDoctor === d.id && "mc-chip--active"
              )}
            >
              <Stethoscope className="h-3.5 w-3.5" />
              {d.full_name_ar}
            </button>
          ))}
        </div>
      )}

      <div className="space-y-3">
        {activeEntries.length === 0 ? (
          <EmptyState
            icon={Users}
            title={t("queueEmpty")}
            message={t("queueEmptyHint")}
            className="rounded-2xl py-16"
          />
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
            const canTransfer =
              !transferPending &&
              !cancellationPending &&
              (entry.status === "waiting" || entry.status === "called");
            const recallLabel =
              entry.status === "waiting" && entry.sent_to_doctor_at
                ? t("queueReCallDoctorTitle")
                : t("queueReCallTitle");

            return (
              <div
                key={entry.id}
                className={cn(
                  "mc-list-row flex-col items-stretch gap-3 overflow-hidden ps-5 sm:flex-row sm:items-center sm:gap-4",
                  transferPending
                    ? "border-royal-300 ring-1 ring-royal-200"
                    : cancellationPending
                      ? "border-debt-border ring-1 ring-red-200"
                      : undefined
                )}
              >
                <span
                  aria-hidden
                  className={cn(
                    "absolute inset-y-3 start-0 w-1 rounded-full",
                    transferPending ? "bg-royal-500" : cancellationPending ? "bg-red-400" : cfg.bar
                  )}
                />

                <div className="flex min-w-0 flex-1 items-start gap-3.5 sm:items-center">
                  <div className={cn(
                    "flex h-12 w-12 flex-shrink-0 items-center justify-center rounded-xl text-xl font-black tabular-nums",
                    cfg.active
                      ? "mc-icon-tile"
                      : cn("border", cfg.bg, cfg.color, cfg.border)
                  )}>
                    {entry.ticket_number}
                  </div>

                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <p className="truncate text-[15px] font-bold text-slate-text">{patientDisplay}</p>
                      <span className={cn("inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] font-bold", cfg.pill)}>
                        <span className={cn("h-1.5 w-1.5 rounded-full", cfg.bar)} />
                        {cfg.label}
                      </span>
                    </div>
                    <div className="mt-1.5 flex flex-wrap items-center gap-1.5 text-xs text-slate-muted">
                      <span className="inline-flex items-center gap-1 rounded-full bg-surface px-2 py-0.5 font-medium text-slate-text">
                        <Stethoscope className="h-3 w-3 text-premium-500" />
                        {entry.doctor?.full_name_ar ?? "—"}
                      </span>
                      {entry.sent_to_doctor_at && (
                        <span className="inline-flex items-center gap-1 rounded-full border border-success-border bg-success px-2 py-0.5 font-medium text-success-text">
                          <Send className="h-3 w-3" />
                          {t("queueSentToDoctor")}
                        </span>
                      )}
                      {transferPending && (
                        <span className="inline-flex items-center gap-1 rounded-full border border-royal-200 bg-royal-50 px-2 py-0.5 font-semibold text-royal-700">
                          <ArrowRightLeft className="h-3 w-3" />
                          {t("queueTransferTo")} {entry.transfer_to_doctor?.full_name_ar ?? "—"}
                        </span>
                      )}
                      {cancellationPending && (
                        <span className="inline-flex items-center gap-1 rounded-full border border-debt-border bg-debt px-2 py-0.5 font-semibold text-debt-text">
                          <AlertTriangle className="h-3 w-3" />
                          {bi("طلب إلغاء", "Cancel request")}:{" "}
                          {entry.cancellation_actor_label ?? "—"}
                        </span>
                      )}
                      {entry.patient_phone && (
                        <a
                          href={`https://wa.me/${entry.patient_phone.replace(/\D/g, "")}`}
                          target="_blank"
                          dir="ltr"
                          className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 font-medium text-success-text hover:bg-success"
                        >
                          <Phone className="h-3 w-3" />
                          {entry.patient_phone}
                        </a>
                      )}
                    </div>
                    {entry.notes?.trim() && (
                      <p className="mt-1.5 flex items-start gap-1.5 text-xs text-slate-muted">
                        <StickyNote className="mt-0.5 h-3 w-3 shrink-0 text-premium-500" />
                        <span className="text-slate-text">{entry.notes.trim()}</span>
                      </p>
                    )}
                    {entry.doctor_notes?.trim() && (
                      <div className="mt-2 flex items-start gap-2 rounded-xl border border-royal-200 bg-royal-50 px-3 py-2 text-xs text-royal-800">
                        <MessageSquareText className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                        <div>
                          <span className="font-semibold">{t("queueDoctorNotes")}: </span>
                          {entry.doctor_notes.trim()}
                        </div>
                      </div>
                    )}
                  </div>
                </div>

                <div className="flex flex-wrap items-center justify-end gap-2 border-t border-slate-border pt-3 sm:border-t-0 sm:pt-0">
                  {cancellationPending && (
                    <>
                      <button
                        onClick={() => {
                          setCancelTransferEntry(entry);
                          setCancelTransferTargetId("");
                        }}
                        disabled={updating === entry.id}
                        className="mc-btn-navy px-3"
                      >
                        <ArrowRightLeft className="h-3.5 w-3.5" />
                        <span className="hidden sm:inline">
                          {bi("تحويل لطبيب", "Transfer doctor")}
                        </span>
                      </button>
                      <button
                        onClick={() => void cancelEntry(entry)}
                        disabled={updating === entry.id}
                        className="inline-flex items-center gap-1.5 rounded-xl border border-debt-border bg-debt px-3 py-2 text-sm font-bold text-debt-text transition-colors hover:bg-red-600 hover:text-white disabled:pointer-events-none disabled:opacity-60"
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
                        className="mc-btn-navy px-3"
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
                        className="mc-btn-soft px-3"
                      >
                        {t("queueRejectTransferBtn")}
                      </button>
                    </>
                  )}
                  {canRecall && (
                    <button
                      onClick={() => recallPatient(entry)}
                      disabled={updating === entry.id}
                      className="mc-btn-soft px-3 text-primary-700"
                      title={recallLabel}
                    >
                      {updating === entry.id
                        ? <RefreshCw className="h-3.5 w-3.5 animate-spin" />
                        : <RotateCcw className="h-3.5 w-3.5" />
                      }
                      <span className="hidden sm:inline">{recallLabel}</span>
                    </button>
                  )}
                  {canTransfer && (
                    <button
                      onClick={() => {
                        setTransferEntry(entry);
                        setTransferTargetId("");
                      }}
                      disabled={updating === entry.id}
                      className="mc-btn-soft px-3 text-royal-700"
                      title={t("docTransferToOther")}
                    >
                      <ArrowRightLeft className="h-3.5 w-3.5" />
                      <span className="hidden sm:inline">{t("docTransferToOther")}</span>
                    </button>
                  )}
                  {canSend && (
                    <button
                      onClick={() => sendToDoctor(entry)}
                      disabled={updating === entry.id}
                      className="mc-btn-navy px-3"
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
                      className="mc-btn-soft px-3 text-royal-700"
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
                      className="mc-btn-pearl px-5 py-2.5 font-extrabold"
                    >
                      {updating === entry.id ? (
                        <RefreshCw className="h-4 w-4 animate-spin" />
                      ) : (
                        <Receipt className="h-4 w-4" />
                      )}
                      {t("apptPay")}
                    </button>
                  )}
                  {nextAction && !transferPending && !cancellationPending && (
                    <button
                      onClick={() => advanceStatus(entry)}
                      disabled={updating === entry.id}
                      className={cn(
                        "mc-btn-navy px-3",
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
                      className="inline-flex h-9 w-9 items-center justify-center rounded-xl border border-transparent text-slate-muted transition-colors hover:border-debt-border hover:bg-debt hover:text-debt-text"
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
        <details className="mc-panel group">
          <summary className="flex cursor-pointer list-none items-center justify-between gap-3 px-5 py-3.5 transition-colors hover:bg-surface">
            <span className="mc-panel-title">
              <CheckCircle2 />
              {t("queueDoneTodaySection")}
              <span className="rounded-full border border-success-border bg-success px-2 py-0.5 text-xs font-bold tabular-nums text-success-text">
                {doneEntries.length}
              </span>
            </span>
            <ChevronDown className="h-4 w-4 text-slate-muted transition-transform group-open:rotate-180" />
          </summary>
          <div className="divide-y divide-slate-border border-t border-slate-border">
            {doneEntries.map((entry) => (
              <div key={entry.id} className="flex items-center gap-3 px-5 py-2.5 text-sm">
                <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-slate-border bg-surface text-xs font-bold tabular-nums text-slate-muted">
                  {entry.ticket_number}
                </span>
                <span className="flex-1 truncate font-medium text-slate-text">
                  {entry.patient?.full_name_ar ?? entry.patient_name ?? "—"}
                </span>
                <span className="hidden items-center gap-1 text-xs text-slate-muted sm:inline-flex">
                  <Stethoscope className="h-3 w-3 text-premium-500" />
                  {entry.doctor?.full_name_ar}
                </span>
                <CheckCircle2 className="h-4 w-4 shrink-0 text-emerald-500" />
              </div>
            ))}
          </div>
        </details>
      )}

        </div>
      </div>

      {cancelTransferEntry && (
        <Modal
          onClose={() => {
            setCancelTransferEntry(null);
            setCancelTransferTargetId("");
          }}
          title={bi("تحويل المراجع لطبيب آخر", "Transfer patient to another doctor")}
          subtitle={cancelTransferEntry.patient?.full_name_ar ?? cancelTransferEntry.patient_name ?? undefined}
          icon={ArrowRightLeft}
          size="md"
          footer={
            <>
              <button
                type="button"
                onClick={() => {
                  setCancelTransferEntry(null);
                  setCancelTransferTargetId("");
                }}
                className="mc-btn-soft flex-1 py-2.5"
              >
                {t("cancel")}
              </button>
              <button
                type="button"
                onClick={() => void submitCancelTransfer()}
                disabled={!cancelTransferTargetId || updating === cancelTransferEntry.id}
                className="mc-btn-navy flex-1 py-2.5"
              >
                <ArrowRightLeft className="h-4 w-4" />
                {bi("تأكيد التحويل", "Confirm transfer")}
              </button>
            </>
          }
        >
          <div className="mb-4 flex items-start gap-2.5 rounded-xl border border-warning-border bg-warning px-3.5 py-3 text-sm text-warning-text">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
            {bi(
              "بعد طلب الإلغاء من الطبيب/المساعد — اختر الطبيب الجديد",
              "After doctor/assistant cancel request — choose the new doctor"
            )}
          </div>
          <label className="mb-1.5 flex items-center gap-1.5 text-xs font-bold text-slate-muted">
            <Stethoscope className="h-3.5 w-3.5 text-premium-500" />
            {t("selectDoctor")}
          </label>
          <select
            value={cancelTransferTargetId}
            onChange={(e) => setCancelTransferTargetId(e.target.value)}
            className="mc-field"
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
        </Modal>
      )}

      {transferEntry && (
        <Modal
          onClose={() => {
            setTransferEntry(null);
            setTransferTargetId("");
          }}
          title={t("docTransferModalTitle")}
          subtitle={transferEntry.patient?.full_name_ar ?? transferEntry.patient_name ?? undefined}
          icon={ArrowRightLeft}
          size="md"
          footer={
            <>
              <button
                type="button"
                onClick={() => {
                  setTransferEntry(null);
                  setTransferTargetId("");
                }}
                className="mc-btn-soft flex-1 py-2.5"
              >
                {t("cancel")}
              </button>
              <button
                type="button"
                onClick={() => void submitTransfer()}
                disabled={!transferTargetId || updating === transferEntry.id}
                className="mc-btn-navy flex-1 py-2.5"
              >
                <ArrowRightLeft className="h-4 w-4" />
                {bi("تأكيد التحويل", "Confirm transfer")}
              </button>
            </>
          }
        >
          <p className="mb-4 text-sm text-slate-muted">
            {bi(
              "سيتم تحويل المراجع مباشرة وإشعار الطبيب الجديد",
              "The patient will be transferred immediately and the new doctor will be notified"
            )}
          </p>
          <label className="mb-1.5 flex items-center gap-1.5 text-xs font-bold text-slate-muted">
            <Stethoscope className="h-3.5 w-3.5 text-premium-500" />
            {t("selectDoctor")}
          </label>
          <select
            value={transferTargetId}
            onChange={(e) => setTransferTargetId(e.target.value)}
            className="mc-field"
          >
            <option value="">{t("selectDoctor")}</option>
            {doctors
              .filter((d) => d.id !== transferEntry.doctor_id)
              .map((d) => (
                <option key={d.id} value={d.id}>
                  {d.full_name_ar}
                  {d.specialty_ar ? ` — ${d.specialty_ar}` : ""}
                </option>
              ))}
          </select>
        </Modal>
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
