"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { translateDbError } from "@/lib/db-errors";
import { cn } from "@/lib/utils";
import { Alert } from "@/components/ui/Alert";
import { authPortalHeaders } from "@/lib/auth/api-portal";
import { broadcastPatientSentToDoctor } from "@/lib/queue/broadcast";
import { notifyQueueRefresh } from "@/lib/queue/queue-refresh";
import { useQueueListRefresh } from "@/hooks/useQueueListRefresh";
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
import { VisitSessionClinicalPanel } from "@/components/clinical/VisitSessionClinicalPanel";
import {
  cachePortalQueue,
  getCachedPortalQueue,
  isBrowserOffline,
} from "@/lib/offline-cache";
import { PatientSearchField } from "@/components/patients/PatientSearchField";
import { getPatientDisplayPhone } from "@/lib/phone";
import type { PatientSearchResult } from "@/lib/services/patient-search";
import type { Assistant } from "@/types";
import {
  Users, Clock, UserCheck, Plus, RefreshCw, Send, RotateCcw,
  ChevronRight, X, LogIn,
} from "lucide-react";

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
  patient: { full_name_ar: string; speech_name_ar?: string | null } | null;
  doctor?: { full_name_ar: string } | null;
}

const STATUS_STYLE: Record<QueueStatus, { color: string; bg: string }> = {
  waiting:     { color: "text-amber-600",  bg: "bg-amber-50"   },
  called:      { color: "text-blue-600",   bg: "bg-blue-50"    },
  in_progress: { color: "text-emerald-600",bg: "bg-emerald-50" },
  ready_for_billing: { color: "text-violet-600", bg: "bg-violet-50" },
  ready_for_payment: { color: "text-violet-600", bg: "bg-violet-50" },
  done:        { color: "text-slate-500",  bg: "bg-slate-50"   },
  cancelled:   { color: "text-red-500",    bg: "bg-red-50"     },
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
  }) => void;
}) {
  const { t } = useLanguage();
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [selectedPatientId, setSelectedPatientId] = useState<string | null>(null);
  const [sendNow, setSendNow] = useState(true);

  const handlePatientSelect = (patient: PatientSearchResult) => {
    setSelectedPatientId(patient.id);
    setName(patient.full_name_ar);
    setPhone(getPatientDisplayPhone(patient) ?? "");
  };

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 sm:items-center">
      <div className="w-full max-w-md rounded-t-2xl bg-white p-6 shadow-2xl sm:rounded-2xl">
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-lg font-bold text-slate-800">{t("addToQueue")}</h2>
          <button onClick={onClose} className="rounded-lg p-1 hover:bg-slate-100">
            <X className="h-5 w-5 text-slate-500" />
          </button>
        </div>

        <p className="mb-4 text-sm text-slate-500">
          {t("selectDoctor")}: <span className="font-semibold text-slate-700">{doctorName}</span>
        </p>

        <div className="space-y-4">
          <div>
            <label className="mb-1 block text-sm font-medium text-slate-600">{t("patientName")}</label>
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
              inputClassName="w-full rounded-xl border border-slate-200 bg-slate-50 py-2.5 pr-10 pl-4 text-sm focus:border-primary focus:outline-none"
            />
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
          <label className="flex cursor-pointer items-center gap-2 text-sm text-slate-600">
            <input
              type="checkbox"
              checked={sendNow}
              onChange={(e) => setSendNow(e.target.checked)}
              className="h-4 w-4 rounded border-slate-300 text-primary"
            />
            {t("queueNotifyDoctor")}
          </label>
        </div>

        <div className="mt-6 flex gap-3">
          <button
            onClick={onClose}
            className="flex-1 rounded-xl border border-slate-200 py-2.5 text-sm font-medium text-slate-600 hover:bg-slate-50"
          >
            {t("cancel")}
          </button>
          <button
            onClick={() => {
              onAdd({
                doctor_id: doctorId,
                patient_name: name,
                patient_phone: phone,
                patient_id: selectedPatientId,
                send_to_doctor: sendNow,
              });
            }}
            className="flex-1 rounded-xl bg-teal-600 py-2.5 text-sm font-bold text-white hover:bg-teal-700"
          >
            {t("queueAddPatientBtn")}
          </button>
        </div>
      </div>
    </div>
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
    if (!assistant?.doctor_id) return;
    setPageError(null);
    try {
      const data = await apiJson<{
        queue: QueueEntry[];
        doctorId: string | null;
      }>("/api/queue", lang, t);

      setDoctorId(data.doctorId);
      const rows = (data.queue ?? []).filter(
        (e) =>
          e.status !== "done" &&
          e.status !== "ready_for_billing" &&
          e.status !== "ready_for_payment" &&
          e.status !== "cancelled"
      );
      setQueue(rows);
      cachePortalQueue("assistant", data.doctorId ?? assistant?.doctor_id ?? null, rows);
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
  }, [assistant?.doctor_id, doctorId, lang, t]);

  useEffect(() => {
    if (assistant?.doctor_id) void fetchQueue();
  }, [assistant?.doctor_id, fetchQueue]);

  useQueueListRefresh("doctor", doctorId, fetchQueue);

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
      notifyQueueRefresh({ scope: "doctor", doctorId: entry.doctor_id });
      notifyQueueRefresh({ scope: "clinic", clinicId: clinicId ?? undefined });
      await fetchQueue();
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
      notifyQueueRefresh({ scope: "doctor", doctorId: entry.doctor_id });
      notifyQueueRefresh({ scope: "clinic", clinicId: clinicId ?? undefined });
      await fetchQueue();
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
      notifyQueueRefresh({ scope: "doctor", doctorId: entry.doctor_id });
      notifyQueueRefresh({ scope: "clinic", clinicId: clinicId ?? undefined });
      await fetchQueue();
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
      notifyQueueRefresh({ scope: "doctor", doctorId: entry.doctor_id });
      notifyQueueRefresh({ scope: "clinic", clinicId: clinicId ?? undefined });
      await fetchQueue();
    } catch (err) {
      setPageError(err instanceof Error ? err.message : t("errOperationFailed"));
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
  }) => {
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
          }),
        }
      );
      const targetDoctorId = result.doctor_id ?? data.doctor_id;
      const name = data.patient_name.trim() || t("queueDefaultPatient");
      void broadcastPatientSentToDoctor(supabase, targetDoctorId, {
        name,
        entryId: result.id,
      });
      notifyQueueRefresh({ scope: "doctor", doctorId: targetDoctorId });
      notifyQueueRefresh({ scope: "clinic", clinicId: clinicId ?? undefined });
      setShowAdd(false);
      await fetchQueue();
    } catch (err) {
      setPageError(err instanceof Error ? err.message : t("errAddQueue"));
    }
  };

  if (loading && !assistant) {
    return (
      <div className="flex min-h-[40vh] items-center justify-center">
        <div className="h-8 w-8 animate-spin rounded-full border-4 border-teal-200 border-t-teal-600" />
      </div>
    );
  }

  if (!assistant?.doctor_id) {
    return (
      <div className="rounded-2xl border border-amber-200 bg-amber-50 p-6 text-center text-sm text-amber-800">
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
    <div className="mc-exam-page">
      {pageError && <Alert variant="error">{pageError}</Alert>}

      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold text-slate-800">{t("queueTitle")}</h1>
          <p className="text-xs text-slate-500">
            {doctorName ? `د. ${doctorName}` : t("navWaitingRoom")}
          </p>
        </div>
        <div className="flex gap-2">
          <button
            onClick={() => void fetchQueue()}
            className="flex items-center gap-1.5 rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs font-medium text-slate-600"
          >
            <RefreshCw className="h-3.5 w-3.5" />
            {t("queueRefresh")}
          </button>
          <button
            onClick={() => setShowAdd(true)}
            className="flex items-center gap-1.5 rounded-xl bg-teal-600 px-3 py-2 text-xs font-bold text-white"
          >
            <Plus className="h-3.5 w-3.5" />
            {t("queueAddPatientBtn")}
          </button>
        </div>
      </div>

      <div className="grid grid-cols-3 gap-2">
        <div className="rounded-xl border border-amber-100 bg-white p-3 text-center shadow-sm">
          <Clock className="mx-auto mb-1 h-4 w-4 text-amber-600" />
          <p className="text-lg font-bold text-amber-700">{stats.waiting}</p>
          <p className="text-[10px] text-amber-600">{t("waitingCount")}</p>
        </div>
        <div className="rounded-xl border border-blue-100 bg-white p-3 text-center shadow-sm">
          <UserCheck className="mx-auto mb-1 h-4 w-4 text-blue-600" />
          <p className="text-lg font-bold text-blue-700">{stats.called}</p>
          <p className="text-[10px] text-blue-600">{t("calledStatus")}</p>
        </div>
        <div className="rounded-xl border border-emerald-100 bg-white p-3 text-center shadow-sm">
          <LogIn className="mx-auto mb-1 h-4 w-4 text-emerald-600" />
          <p className="text-lg font-bold text-emerald-700">{stats.in_progress}</p>
          <p className="text-[10px] text-emerald-600">{t("inProgressStatus")}</p>
        </div>
      </div>

      {clinicalEntry?.patient_id && (
        <div
          id={CLINICAL_EXAM_ANCHOR}
          className="mc-exam-shell"
        >
          <div className="mc-exam-shell-header">
            <p className="text-lg font-bold text-white">
              {clinicalEntry.patient?.full_name_ar ??
                clinicalEntry.patient_name ??
                t("queueUnnamedPatient")}
            </p>
            <p className="mt-1 text-xs text-blue-100">{t("docVisualMedicalRecordHint")}</p>
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
        <div className="flex flex-col items-center justify-center rounded-2xl border border-dashed border-slate-200 bg-white py-12 text-center">
          <Users className="mb-2 h-8 w-8 text-slate-300" />
          <p className="text-sm font-medium text-slate-500">{t("queueEmpty")}</p>
        </div>
      ) : (
        <div className="space-y-3">
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

            return (
              <div
                key={entry.id}
                className="flex flex-col gap-3 rounded-2xl border bg-white p-4 shadow-sm"
              >
                <div className="flex items-center gap-3">
                  <div
                    className={cn(
                      "flex h-11 w-11 shrink-0 items-center justify-center rounded-xl text-lg font-black",
                      style.bg,
                      style.color
                    )}
                  >
                    {entry.ticket_number}
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="truncate font-semibold text-slate-800">{patientDisplay}</p>
                    <p className={cn("text-xs font-medium", style.color)}>{statusLabel}</p>
                  </div>
                </div>

                <div className="flex flex-wrap gap-2">
                  {canSend && (
                    <button
                      onClick={() => void sendToDoctor(entry)}
                      disabled={updating === entry.id}
                      className="flex items-center gap-1 rounded-xl bg-violet-600 px-3 py-2 text-xs font-bold text-white disabled:opacity-60"
                    >
                      <Send className="h-3.5 w-3.5" />
                      {t("queueSendDoctorTitle")}
                    </button>
                  )}
                  {canRecall && (
                    <button
                      onClick={() => void recallPatient(entry)}
                      disabled={updating === entry.id}
                      className="flex items-center gap-1 rounded-xl border border-blue-200 bg-blue-50 px-3 py-2 text-xs font-bold text-blue-700 disabled:opacity-60"
                    >
                      <RotateCcw className="h-3.5 w-3.5" />
                      {t("queueReCallTitle")}
                    </button>
                  )}
                  {nextAction && nextLabel && (
                    <button
                      onClick={() => void advanceStatus(entry)}
                      disabled={updating === entry.id}
                      className="flex items-center gap-1 rounded-xl bg-teal-600 px-3 py-2 text-xs font-bold text-white disabled:opacity-60"
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
                      className="rounded-xl border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs font-bold text-emerald-700"
                    >
                      {t("navPatientCare")}
                    </button>
                  )}
                  {entry.status !== "in_progress" && (
                    <button
                      onClick={() => void cancelEntry(entry)}
                      disabled={updating === entry.id}
                      className="rounded-xl border border-red-200 px-3 py-2 text-xs font-medium text-red-600 disabled:opacity-60"
                    >
                      {t("cancel")}
                    </button>
                  )}
                </div>
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
          onAdd={(data) => void addToQueue(data)}
        />
      )}
    </div>
  );
}
