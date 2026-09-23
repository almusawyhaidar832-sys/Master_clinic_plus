"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { translateDbError } from "@/lib/db-errors";
import { cn } from "@/lib/utils";
import { Alert } from "@/components/ui/Alert";
import { authPortalHeaders } from "@/lib/auth/api-portal";
import { broadcastPatientSentToDoctor } from "@/lib/queue/broadcast";
import { useQueueRealtimeSync } from "@/hooks/useQueueRealtimeSync";
import {
  fetchClinicDoctorsFromSupabase,
  fetchTodayQueueFromSupabase,
} from "@/lib/queue/queue-client-fetch";
import {
  resolvePatientSpeechName,
} from "@/lib/queue/utils";
import { useLanguage } from "@/contexts/LanguageContext";
import { getQueueStatusLabel, type QueueStatusKey } from "@/i18n/localized-labels";
import type { Language, TranslationKey } from "@/i18n/translations";
import { useClinicProfile } from "@/contexts/ClinicProfileContext";
import { getAssistantForCurrentUser } from "@/lib/clinic-context";
import {
  buildAssistantQueueClinicalUrl,
  CLINICAL_EXAM_ANCHOR,
  scrollToClinicalExamView,
} from "@/lib/queue/navigation";
import { VisitSessionClinicalPanel } from "@/components/clinical/VisitSessionClinicalPanel.lazy";
import {
  cachePortalQueue,
  getCachedPortalQueue,
  isBrowserOffline,
} from "@/lib/offline-cache";
import { PatientSearchField } from "@/components/patients/PatientSearchField";
import { getPatientDisplayPhone, validatePatientPhone } from "@/lib/phone";
import type { PatientSearchResult } from "@/lib/services/patient-search";
import type { Assistant } from "@/types";
import {
  Users, Clock, UserCheck, Plus, RefreshCw, Send, RotateCcw,
  ChevronRight, X, LogIn, ArrowRightLeft, ListOrdered, UserPlus, Stethoscope,
  StickyNote, Phone, HeartPulse, AlertTriangle,
} from "lucide-react";
import { PageHeader } from "@/components/ui/PageHeader";
import { StatTile } from "@/components/ui/StatTile";
import { Modal } from "@/components/ui/Modal";
import { EmptyState } from "@/components/ui/EmptyState";

interface ClinicDoctor {
  id: string;
  full_name_ar: string;
  specialty_ar: string | null;
}

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
  sent_to_doctor_at: string | null;
  transfer_to_doctor_id: string | null;
  transfer_requested_at: string | null;
  transfer_to_doctor?: { full_name_ar: string } | null;
  patient: { full_name_ar: string; speech_name_ar?: string | null } | null;
  doctor?: { full_name_ar: string } | null;
}

const STATUS_STYLE: Record<
  QueueStatus,
  { color: string; bg: string; bar: string; pill: string; active: boolean }
> = {
  waiting:           { color: "text-warning-text", bg: "border border-warning-border bg-warning", bar: "bg-amber-400",   pill: "border-warning-border bg-warning text-warning-text", active: false },
  called:            { color: "text-primary-700",  bg: "border border-primary-200 bg-primary-50", bar: "bg-primary-500", pill: "border-primary-200 bg-primary-50 text-primary-700", active: true },
  in_progress:       { color: "text-success-text", bg: "border border-success-border bg-success", bar: "bg-emerald-500", pill: "border-success-border bg-success text-success-text", active: true },
  ready_for_billing: { color: "text-royal-700",    bg: "border border-royal-200 bg-royal-50",     bar: "bg-royal-500",   pill: "border-royal-200 bg-royal-50 text-royal-700", active: false },
  ready_for_payment: { color: "text-royal-700",    bg: "border border-royal-200 bg-royal-50",     bar: "bg-royal-500",   pill: "border-royal-200 bg-royal-50 text-royal-700", active: false },
  done:              { color: "text-slate-muted",  bg: "border border-slate-border bg-surface",   bar: "bg-slate-300",   pill: "border-slate-border bg-surface text-slate-muted", active: false },
  cancelled:         { color: "text-debt-text",    bg: "border border-debt-border bg-debt",       bar: "bg-red-400",     pill: "border-debt-border bg-debt text-debt-text", active: false },
};

const NEXT_STATUS: Partial<Record<QueueStatus, QueueStatus>> = {
  waiting: "called",
  called: "in_progress",
};

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
        ...authPortalHeaders("assistant"),
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

function AddToQueueModal({
  doctorId,
  doctorName,
  onClose,
  onAdd,
}: {
  doctorId: string;
  doctorName: string;
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
  const [name, setName] = useState("");
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
    if (submitting) return;
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
            disabled={submitting}
            onClick={() => void handleSubmit()}
            className="mc-btn-navy flex-1 py-2.5"
          >
            <Plus className="h-4 w-4" />
            {submitting ? t("queueAddingPatient") : t("queueAddPatientBtn")}
          </button>
        </>
      }
    >
        <p className="mb-4 flex items-center gap-2 rounded-xl border border-slate-border bg-surface px-3.5 py-2.5 text-sm text-slate-muted">
          <Stethoscope className="h-4 w-4 text-premium-500" />
          {t("selectDoctor")}: <span className="font-semibold text-slate-text">{doctorName}</span>
        </p>

        <div className="space-y-4">
          <div>
            <label className="mb-1.5 flex items-center gap-1.5 text-xs font-bold text-slate-muted">
              <Users className="h-3.5 w-3.5 text-premium-500" />
              {t("patientName")}
            </label>
            <PatientSearchField
              portal="assistant"
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
          {formError && <Alert variant="error">{formError}</Alert>}
        </div>
    </Modal>
  );
}

/** غرفة انتظار المساعد — طبيب واحد فقط، بدون بيانات مالية */
export function AssistantQueuePanel() {
  const supabase = createClient();
  const router = useRouter();
  const searchParams = useSearchParams();
  const examFromUrl = searchParams.get("exam");
  const { profile } = useClinicProfile();
  const { t, lang, bi } = useLanguage();
  const clinicId = profile?.id ?? null;

  const [assistant, setAssistant] = useState<Assistant | null>(null);
  const [doctorName, setDoctorName] = useState("");
  const [queue, setQueue] = useState<QueueEntry[]>([]);
  const [doctorId, setDoctorId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [pageError, setPageError] = useState<string | null>(null);
  const [updating, setUpdating] = useState<string | null>(null);
  const [showAdd, setShowAdd] = useState(false);
  const [clinicalEntryId, setClinicalEntryId] = useState<string | null>(null);
  const [clinicDoctors, setClinicDoctors] = useState<ClinicDoctor[]>([]);
  const [transferEntry, setTransferEntry] = useState<QueueEntry | null>(null);
  const [transferTargetId, setTransferTargetId] = useState("");

  useEffect(() => {
    async function loadAssistant() {
      const asst = await getAssistantForCurrentUser(supabase);
      setAssistant(asst);
      if (asst?.doctor_id) {
        const { data: doctor } = await supabase
          .from("doctors")
          .select("full_name_ar")
          .eq("id", asst.doctor_id)
          .maybeSingle();
        setDoctorName((doctor as { full_name_ar?: string } | null)?.full_name_ar ?? "");
      }
    }
    void loadAssistant();
  }, [supabase]);

  const fetchQueue = useCallback(async () => {
    if (!assistant?.doctor_id || !clinicId) return;
    setPageError(null);
    try {
      const did = assistant.doctor_id;
      setDoctorId(did);

      const [allRows, doctors] = await Promise.all([
        fetchTodayQueueFromSupabase<QueueEntry>(supabase, {
          clinicId,
          doctorId: did,
          includeDone: false,
        }),
        fetchClinicDoctorsFromSupabase(supabase, clinicId),
      ]);

      const rows = allRows.filter(
        (e) =>
          e.status !== "done" &&
          e.status !== "ready_for_billing" &&
          e.status !== "ready_for_payment" &&
          e.status !== "cancelled"
      );
      setClinicDoctors(doctors);
      setQueue(rows);
      cachePortalQueue("assistant", did, rows);
      setClinicalEntryId((prev) =>
        prev && !rows.some((e) => e.id === prev) ? null : prev
      );
    } catch (err) {
      if (isBrowserOffline()) {
        const cached = getCachedPortalQueue<QueueEntry>(
          "assistant",
          assistant?.doctor_id ?? doctorId
        );
        if (cached && cached.length > 0) {
          setQueue(cached);
          setPageError(t("offlineModeHint"));
          return;
        }
      }
      setPageError(err instanceof Error ? err.message : t("errQueueLoad"));
    } finally {
      setLoading(false);
    }
  }, [assistant?.doctor_id, clinicId, doctorId, supabase, t]);

  useEffect(() => {
    if (assistant?.doctor_id && clinicId) void fetchQueue();
  }, [assistant?.doctor_id, clinicId, fetchQueue]);

  useQueueRealtimeSync("doctor", doctorId, setQueue, {
    doctors: clinicDoctors,
    doctorId: doctorId ?? undefined,
    includeRow: (row) =>
      !row.cancellation_requested_at &&
      !["done", "ready_for_billing", "ready_for_payment", "cancelled"].includes(
        String(row.status)
      ),
    onChange: (_payload, nextQueue) => {
      setClinicalEntryId((prev) =>
        prev && !nextQueue.some((e) => e.id === prev) ? null : prev
      );
    },
  });

  useEffect(() => {
    if (!examFromUrl) return;
    setClinicalEntryId(examFromUrl);
    scrollToClinicalExamView();
  }, [examFromUrl]);

  const openClinicalExam = useCallback(
    (entry: QueueEntry) => {
      setClinicalEntryId(entry.id);
      router.replace(
        buildAssistantQueueClinicalUrl({
          queueEntryId: entry.id,
          patientId: entry.patient_id,
        })
      );
      scrollToClinicalExamView();
    },
    [router]
  );

  const sendToDoctor = async (entry: QueueEntry) => {
    setUpdating(entry.id);
    try {
      await apiJson("/api/queue", lang, t, {
        method: "POST",
        body: JSON.stringify({
          action: "send_to_doctor",
          queue_entry_id: entry.id,
        }),
      });
      const name = resolvePatientSpeechName(entry);
      void broadcastPatientSentToDoctor(supabase, entry.doctor_id, {
        name,
        entryId: entry.id,
      });
    } catch (err) {
      setPageError(err instanceof Error ? err.message : t("errOperationFailed"));
    } finally {
      setUpdating(null);
    }
  };

  const recallPatient = async (entry: QueueEntry) => {
    setUpdating(entry.id);
    try {
      await apiJson("/api/queue", lang, t, {
        method: "POST",
        body: JSON.stringify({ action: "recall", queue_entry_id: entry.id }),
      });
    } catch (err) {
      setPageError(err instanceof Error ? err.message : t("errOperationFailed"));
    } finally {
      setUpdating(null);
    }
  };

  const advanceStatus = async (entry: QueueEntry) => {
    setUpdating(entry.id);
    try {
      if (entry.status === "called") {
        await apiJson(`/api/queue/${entry.id}`, lang, t, {
          method: "PATCH",
          body: JSON.stringify({ action: "enter" }),
        });
        openClinicalExam(entry);
      } else {
        await apiJson(`/api/queue/${entry.id}`, lang, t, {
          method: "PATCH",
          body: JSON.stringify({ action: "advance" }),
        });
      }
    } catch (err) {
      setPageError(err instanceof Error ? err.message : t("errOperationFailed"));
    } finally {
      setUpdating(null);
    }
  };

  const cancelEntry = async (entry: QueueEntry) => {
    const name =
      entry.patient?.full_name_ar ?? entry.patient_name ?? `${entry.ticket_number}`;
    if (
      !confirm(
        bi(
          `إلغاء دور «${name}»؟\nسيُبلَّغ المحاسب — يحوّلك أو يلغي الحجز نهائياً.`,
          `Cancel ticket for "${name}"?\nThe accountant will be notified — they can transfer you or cancel the booking.`
        )
      )
    ) {
      return;
    }
    setUpdating(entry.id);
    try {
      await apiJson(`/api/queue/${entry.id}`, lang, t, {
        method: "PATCH",
        body: JSON.stringify({ action: "cancel" }),
      });
    } catch (err) {
      setPageError(err instanceof Error ? err.message : t("errOperationFailed"));
    } finally {
      setUpdating(null);
    }
  };

  const submitTransfer = async () => {
    if (!transferEntry || !transferTargetId) return;
    setUpdating(transferEntry.id);
    try {
      await apiJson(`/api/queue/${transferEntry.id}`, lang, t, {
        method: "PATCH",
        body: JSON.stringify({
          action: "request_transfer",
          target_doctor_id: transferTargetId,
        }),
      });
      setTransferEntry(null);
      setTransferTargetId("");
    } catch (err) {
      setPageError(err instanceof Error ? err.message : t("docErrTransfer"));
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
    try {
      const result = await apiJson<{ id: string; doctor_id?: string }>(
        "/api/queue",
        lang,
        t,
        {
          method: "POST",
          body: JSON.stringify({
            patient_name: data.patient_name,
            patient_phone: data.patient_phone,
            patient_id: data.patient_id ?? undefined,
            doctor_id: data.doctor_id,
            send_to_doctor: data.send_to_doctor !== false,
            notes: data.notes?.trim() || undefined,
          }),
        }
      );
      setShowAdd(false);
      setPageError(null);
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

  if (loading && !assistant) {
    return (
      <div className="space-y-4">
        <div className="mc-skeleton h-24 rounded-3xl" />
        <div className="grid grid-cols-3 gap-3">
          <div className="mc-skeleton h-[76px] rounded-2xl" />
          <div className="mc-skeleton h-[76px] rounded-2xl" />
          <div className="mc-skeleton h-[76px] rounded-2xl" />
        </div>
        <div className="mc-skeleton h-32 rounded-2xl" />
      </div>
    );
  }

  if (!assistant?.doctor_id) {
    return (
      <div className="flex flex-col items-center gap-3 rounded-2xl border border-warning-border bg-warning p-8 text-center text-sm text-warning-text">
        <span className="flex h-12 w-12 items-center justify-center rounded-xl bg-surface-card shadow-card">
          <AlertTriangle className="h-6 w-6" />
        </span>
        لم يتم ربط حسابك بسجل مساعد — تواصل مع المحاسب لإعادة الربط.
      </div>
    );
  }

  const stats = {
    waiting: queue.filter((e) => e.status === "waiting").length,
    called: queue.filter((e) => e.status === "called").length,
    in_progress: queue.filter((e) => e.status === "in_progress").length,
  };

  const clinicalEntry = clinicalEntryId
    ? queue.find((e) => e.id === clinicalEntryId)
    : null;

  return (
    <div className="space-y-4 animate-fade-in sm:space-y-5">
      <PageHeader
        className="mb-0"
        title={t("queueTitle")}
        subtitle={doctorName ? `د. ${doctorName}` : t("navWaitingRoom")}
        eyebrow={bi("بوابة المساعد", "Assistant portal")}
        icon={ListOrdered}
        actions={
          <>
            <button
              onClick={() => void fetchQueue()}
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

      {pageError && <Alert variant="error">{pageError}</Alert>}

      <div className="grid grid-cols-1 gap-3 min-[420px]:grid-cols-3">
        <StatTile label={t("waitingCount")} value={stats.waiting} icon={Clock} tone="warning" />
        <StatTile label={t("calledStatus")} value={stats.called} icon={UserCheck} tone="navy" />
        <StatTile label={t("inProgressStatus")} value={stats.in_progress} icon={LogIn} tone="success" />
      </div>

      {clinicalEntry?.patient_id && (
        <div
          id={CLINICAL_EXAM_ANCHOR}
          className="mc-exam-shell"
        >
          <div className="mc-exam-shell-header flex items-center gap-3">
            <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-white/10 text-premium-300 ring-1 ring-inset ring-premium-300/40">
              <HeartPulse className="h-5 w-5" />
            </span>
            <div className="min-w-0">
              <p className="truncate text-lg font-bold text-white">
                {clinicalEntry.patient?.full_name_ar ??
                  clinicalEntry.patient_name ??
                  t("queueUnnamedPatient")}
              </p>
              <p className="mt-0.5 text-xs text-white/70">{t("docVisualMedicalRecordHint")}</p>
            </div>
          </div>
          <div className="mc-exam-shell-body">
          <VisitSessionClinicalPanel
            portal="assistant"
            patientId={clinicalEntry.patient_id}
            queueEntryId={clinicalEntry.id}
            queueStatusOverride={clinicalEntry.status}
            hideHeader
          />
          </div>
        </div>
      )}

      {queue.length === 0 ? (
        <EmptyState
          icon={Users}
          message={t("queueEmpty")}
          className="rounded-2xl py-14"
        />
      ) : (
        <div className="space-y-3">
          <h3 className="flex items-center gap-2 px-1 text-sm font-bold text-slate-text">
            <Users className="h-4 w-4 text-premium-500" />
            {bi("قائمة المراجعين", "Patient list")}
            <span className="rounded-full border border-premium-200 bg-premium-50 px-2 py-0.5 text-[11px] font-bold tabular-nums text-premium-700">
              {queue.length}
            </span>
          </h3>
          {queue.map((entry) => {
            const style = STATUS_STYLE[entry.status];
            const statusLabel = getQueueStatusLabel(t, entry.status as QueueStatusKey);
            const patientDisplay =
              entry.patient?.full_name_ar ?? entry.patient_name ?? t("queueUnnamedPatient");
            const nextAction = NEXT_STATUS[entry.status];
            const nextLabel =
              entry.status === "waiting"
                ? t("callNext")
                : entry.status === "called"
                  ? t("queueEnterArrow")
                  : undefined;
            const canSend =
              entry.status === "waiting" && !entry.sent_to_doctor_at;
            const canRecall =
              entry.status === "called" ||
              entry.status === "in_progress" ||
              (entry.status === "waiting" && !!entry.sent_to_doctor_at);
            const transferPending = Boolean(entry.transfer_to_doctor_id);
            const canTransfer =
              !transferPending &&
              (entry.status === "waiting" || entry.status === "called");

            return (
              <div
                key={entry.id}
                className={cn(
                  "mc-list-row flex-col items-stretch gap-3 overflow-hidden ps-5",
                  transferPending && "border-royal-300 ring-1 ring-royal-200"
                )}
              >
                <span
                  aria-hidden
                  className={cn(
                    "absolute inset-y-3 start-0 w-1 rounded-full",
                    transferPending ? "bg-royal-500" : style.bar
                  )}
                />
                <div className="flex items-center gap-3">
                  <div
                    className={cn(
                      "flex h-12 w-12 shrink-0 items-center justify-center rounded-xl text-xl font-black tabular-nums",
                      style.active ? "mc-icon-tile rounded-xl" : cn(style.bg, style.color)
                    )}
                  >
                    {entry.ticket_number}
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-[15px] font-bold text-slate-text">{patientDisplay}</p>
                    <span className={cn("mt-1 inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] font-bold", style.pill)}>
                      <span className={cn("h-1.5 w-1.5 rounded-full", style.bar)} />
                      {statusLabel}
                    </span>
                    {transferPending && (
                      <p className="mt-2 flex items-start gap-1.5 rounded-lg border border-royal-200 bg-royal-50 px-2.5 py-1.5 text-[11px] font-medium text-royal-700">
                        <ArrowRightLeft className="mt-0.5 h-3 w-3 shrink-0" />
                        <span>
                          {t("docQueueTransferLine")}{" "}
                          {entry.transfer_to_doctor?.full_name_ar ?? t("docQueueOtherDoctor")} —{" "}
                          {t("docQueueAwaitAccountant")}
                        </span>
                      </p>
                    )}
                  </div>
                </div>

                {!transferPending && (
                <div className="flex flex-wrap items-center gap-2 border-t border-slate-border pt-3">
                  {canSend && (
                    <button
                      onClick={() => void sendToDoctor(entry)}
                      disabled={updating === entry.id}
                      className="mc-btn-navy px-3 text-xs"
                    >
                      <Send className="h-3.5 w-3.5" />
                      {t("queueSendDoctorTitle")}
                    </button>
                  )}
                  {canRecall && (
                    <button
                      onClick={() => void recallPatient(entry)}
                      disabled={updating === entry.id}
                      className="mc-btn-soft px-3 text-xs text-primary-700"
                    >
                      <RotateCcw className="h-3.5 w-3.5" />
                      {t("queueReCallTitle")}
                    </button>
                  )}
                  {nextAction && nextLabel && (
                    <button
                      onClick={() => void advanceStatus(entry)}
                      disabled={updating === entry.id}
                      className="mc-btn-navy px-3 text-xs"
                    >
                      {updating === entry.id ? (
                        <RefreshCw className="h-3.5 w-3.5 animate-spin" />
                      ) : (
                        <ChevronRight className="h-3.5 w-3.5" />
                      )}
                      {nextLabel}
                    </button>
                  )}
                  {entry.status === "in_progress" && entry.patient_id && (
                    <button
                      onClick={() => openClinicalExam(entry)}
                      className="mc-btn-pearl px-3 text-xs"
                    >
                      <HeartPulse className="h-3.5 w-3.5" />
                      {t("navPatientCare")}
                    </button>
                  )}
                  {canTransfer && (
                    <button
                      type="button"
                      onClick={() => {
                        setTransferEntry(entry);
                        setTransferTargetId("");
                      }}
                      disabled={updating === entry.id}
                      className="mc-btn-soft px-3 text-xs text-royal-700"
                    >
                      <ArrowRightLeft className="h-3.5 w-3.5" />
                      {t("docTransferShort")}
                    </button>
                  )}
                  {entry.status !== "in_progress" && (
                    <button
                      onClick={() => void cancelEntry(entry)}
                      disabled={updating === entry.id}
                      className="ms-auto inline-flex items-center gap-1 rounded-xl border border-transparent px-3 py-2 text-xs font-semibold text-slate-muted transition-colors hover:border-debt-border hover:bg-debt hover:text-debt-text disabled:pointer-events-none disabled:opacity-60"
                    >
                      <X className="h-3.5 w-3.5" />
                      {t("cancel")}
                    </button>
                  )}
                </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {showAdd && assistant.doctor_id && (
        <AddToQueueModal
          doctorId={assistant.doctor_id}
          doctorName={doctorName}
          onClose={() => setShowAdd(false)}
          onAdd={(data) => addToQueue(data)}
        />
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
                {t("docRequestTransfer")}
              </button>
            </>
          }
        >
          <p className="mb-4 text-sm text-slate-muted">{t("docTransferModalHint")}</p>
          <label className="mb-1.5 flex items-center gap-1.5 text-xs font-bold text-slate-muted">
            <Stethoscope className="h-3.5 w-3.5 text-premium-500" />
            {t("docSelectDoctor")}
          </label>
          <select
            value={transferTargetId}
            onChange={(e) => setTransferTargetId(e.target.value)}
            className="mc-field"
          >
            <option value="">{t("docSelectDoctor")}</option>
            {clinicDoctors
              .filter((d) => d.id !== doctorId)
              .map((d) => (
                <option key={d.id} value={d.id}>
                  {d.full_name_ar}
                  {d.specialty_ar ? ` — ${d.specialty_ar}` : ""}
                </option>
              ))}
          </select>
        </Modal>
      )}
    </div>
  );
}
