"use client";

import { useCallback, useEffect, useState, Suspense } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import {
  buildDoctorPatientUrl,
  buildDoctorQueueClinicalUrl,
  CLINICAL_EXAM_ANCHOR,
  scrollToClinicalExamView,
} from "@/lib/queue/navigation";
import { createClient } from "@/lib/supabase/client";
import { translateDbError } from "@/lib/db-errors";
import { cn } from "@/lib/utils";
import { Alert } from "@/components/ui/Alert";
import { authPortalHeaders } from "@/lib/auth/api-portal";
import { broadcastAdmitRequest, broadcastQueueScreenCall } from "@/lib/queue/broadcast";
import {
  resolveDoctorSpeechName,
  resolvePatientSpeechName,
} from "@/lib/queue/utils";
import { notifyQueueRefresh } from "@/lib/queue/queue-refresh";
import { useQueueListRefresh } from "@/hooks/useQueueListRefresh";
import { useLanguage } from "@/contexts/LanguageContext";
import { getQueueStatusLabel, type QueueStatusKey } from "@/i18n/localized-labels";
import type { Language, TranslationKey } from "@/i18n/translations";
import { useClinicProfile } from "@/contexts/ClinicProfileContext";
import { QueueRealtimeBridge } from "@/components/queue/QueueRealtimeBridge";
import { VisitSessionClinicalPanel } from "@/components/clinical/VisitSessionClinicalPanel";
import {
  Clock, UserCheck, RefreshCw, LogIn, Send, Users, RotateCcw,
  UserX, ArrowRightLeft, X,
} from "lucide-react";

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
  created_at: string;
  sent_to_doctor_at: string | null;
  transfer_to_doctor_id: string | null;
  transfer_requested_at: string | null;
  transfer_to_doctor?: { full_name_ar: string } | null;
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

function doctorQueueStatusLabel(
  t: (key: TranslationKey) => string,
  status: QueueStatus
): string {
  if (status === "called") return t("docStatusCalled");
  return getQueueStatusLabel(t, status as QueueStatusKey);
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
        ...authPortalHeaders("doctor"),
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

export default function DoctorQueuePage() {
  return (
    <Suspense
      fallback={
        <div className="flex min-h-[50vh] items-center justify-center">
          <div className="h-8 w-8 animate-spin rounded-full border-4 border-primary/20 border-t-primary" />
        </div>
      }
    >
      <DoctorQueuePageContent />
    </Suspense>
  );
}

function DoctorQueuePageContent() {
  const supabase = createClient();
  const router = useRouter();
  const searchParams = useSearchParams();
  const examFromUrl = searchParams.get("exam");
  const { profile } = useClinicProfile();
  const { t, lang, bi } = useLanguage();
  const clinicId = profile?.id ?? null;
  const [queue, setQueue] = useState<QueueEntry[]>([]);
  const [doctorId, setDoctorId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [pageError, setPageError] = useState<string | null>(null);
  const [updating, setUpdating] = useState<string | null>(null);
  const [clinicalEntryId, setClinicalEntryId] = useState<string | null>(null);
  const [clinicDoctors, setClinicDoctors] = useState<ClinicDoctor[]>([]);
  const [transferEntry, setTransferEntry] = useState<QueueEntry | null>(null);
  const [transferTargetId, setTransferTargetId] = useState("");

  const fetchQueue = useCallback(async () => {
    setPageError(null);
    try {
      const data = await apiJson<{
        queue: QueueEntry[];
        doctorId: string | null;
        doctors?: ClinicDoctor[];
      }>("/api/queue", lang, t);

      setDoctorId(data.doctorId);
      setClinicDoctors(data.doctors ?? []);
      const rows = (data.queue ?? []).filter(
        (e) =>
          e.status !== "done" &&
          e.status !== "ready_for_billing" &&
          e.status !== "ready_for_payment"
      );
      setQueue(rows);

      setClinicalEntryId((prev) =>
        prev && !rows.some((e) => e.id === prev) ? null : prev
      );
    } catch (err) {
      setPageError(err instanceof Error ? err.message : t("errQueueLoad"));
    } finally {
      setLoading(false);
    }
  }, [lang, t]);

  useEffect(() => {
    fetchQueue();
  }, [fetchQueue]);

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
        buildDoctorQueueClinicalUrl({
          queueEntryId: entry.id,
          patientId: entry.patient_id,
        })
      );
      scrollToClinicalExamView();
    },
    [router]
  );

  const admitPatient = async (entry: QueueEntry) => {
    setUpdating(entry.id);
    try {
      await apiJson("/api/queue", lang, t, {
        method: "POST",
        body: JSON.stringify({ action: "admit", queue_entry_id: entry.id }),
      });
      const name = resolvePatientSpeechName(entry);
      const doctorName = resolveDoctorSpeechName(entry.doctor);
      if (clinicId) {
        void broadcastAdmitRequest(supabase, clinicId, {
          name,
          entryId: entry.id,
        });
        void broadcastQueueScreenCall(supabase, clinicId, {
          name,
          doctorName,
          entryId: entry.id,
        });
        notifyQueueRefresh({ scope: "clinic", clinicId });
      }
      await fetchQueue();
    } catch (err) {
      setPageError(err instanceof Error ? err.message : t("docErrAdmit"));
    } finally {
      setUpdating(null);
    }
  };

  const recallAdmit = async (entry: QueueEntry) => {
    setUpdating(entry.id);
    try {
      await apiJson("/api/queue", lang, t, {
        method: "POST",
        body: JSON.stringify({ action: "recall", queue_entry_id: entry.id }),
      });
      const name = resolvePatientSpeechName(entry);
      const doctorName = resolveDoctorSpeechName(entry.doctor);
      if (clinicId) {
        void broadcastAdmitRequest(supabase, clinicId, {
          name,
          entryId: entry.id,
        });
        void broadcastQueueScreenCall(supabase, clinicId, {
          name,
          doctorName,
          entryId: entry.id,
        });
        notifyQueueRefresh({ scope: "clinic", clinicId });
      }
    } catch (err) {
      setPageError(err instanceof Error ? err.message : t("docErrRecall"));
    } finally {
      setUpdating(null);
    }
  };

  const enterPatient = async (entry: QueueEntry) => {
    setUpdating(entry.id);
    setPageError(null);
    try {
      await apiJson(`/api/queue/${entry.id}`, lang, t, {
        method: "PATCH",
        body: JSON.stringify({ action: "enter" }),
      });
      openClinicalExam(entry);
      if (clinicId) {
        notifyQueueRefresh({ scope: "clinic", clinicId });
      }
      await fetchQueue();
    } catch (err) {
      setPageError(err instanceof Error ? err.message : t("docErrStartExam"));
    } finally {
      setUpdating(null);
    }
  };

  const rejectPatient = async (entry: QueueEntry) => {
    const name =
      entry.patient?.full_name_ar ?? entry.patient_name ?? `${t("docTicketNumber")} ${entry.ticket_number}`;
    if (
      !confirm(
        bi(
          `رفض المراجع «${name}»؟\nسيُلغى الدور ويُبلَّغ المحاسب — لن يظهر على شاشة النداء.`,
          `Reject patient "${name}"?\nThe ticket will be cancelled and the accountant notified — it won't appear on the call screen.`
        )
      )
    ) {
      return;
    }
    setUpdating(entry.id);
    try {
      await apiJson(`/api/queue/${entry.id}`, lang, t, {
        method: "PATCH",
        body: JSON.stringify({ action: "reject" }),
      });
      if (clinicId) {
        notifyQueueRefresh({ scope: "clinic", clinicId });
      }
      await fetchQueue();
    } catch (err) {
      setPageError(err instanceof Error ? err.message : t("docErrReject"));
    } finally {
      setUpdating(null);
    }
  };

  const submitTransfer = async () => {
    if (!transferEntry || !transferTargetId) return;
    setUpdating(transferEntry.id);
    try {
      await apiJson(`/api/queue/${transferEntry.id}`, {
        method: "PATCH",
        body: JSON.stringify({
          action: "request_transfer",
          target_doctor_id: transferTargetId,
        }),
      });
      if (clinicId) {
        notifyQueueRefresh({ scope: "clinic", clinicId });
      }
      setTransferEntry(null);
      setTransferTargetId("");
      await fetchQueue();
    } catch (err) {
      setPageError(err instanceof Error ? err.message : t("docErrTransfer"));
    } finally {
      setUpdating(null);
    }
  };

  if (loading) {
    return (
      <div className="flex min-h-[50vh] items-center justify-center">
        <div className="h-8 w-8 animate-spin rounded-full border-4 border-primary/20 border-t-primary" />
      </div>
    );
  }

  const waiting = queue.filter((e) => e.status === "waiting");
  const active = queue.filter((e) => e.status === "called" || e.status === "in_progress");
  const clinicalEntry =
    clinicalEntryId != null
      ? queue.find((e) => e.id === clinicalEntryId) ??
        ([...waiting, ...active].find((e) => e.id === clinicalEntryId) ?? null)
      : queue.find((e) => e.status === "in_progress") ?? null;

  return (
    <>
      <div className="mc-exam-page">
        <div>
          <h2 className="text-lg font-bold text-slate-800">{t("docQueueTitle")}</h2>
          <p className="text-sm text-slate-500">{t("docQueueSubtitle")}</p>
        </div>

        {pageError && <Alert variant="error">{pageError}</Alert>}

        <div className="grid grid-cols-2 gap-3">
          <div className="rounded-xl border border-amber-100 bg-white p-4 shadow-sm">
            <div className="flex items-center gap-2 text-amber-700">
              <Clock className="h-5 w-5" />
              <span className="text-sm font-medium">{t("waitingCount")}</span>
            </div>
            <p className="mt-1 text-2xl font-bold text-amber-800">{waiting.length}</p>
          </div>
          <div className="rounded-xl border border-emerald-100 bg-white p-4 shadow-sm">
            <div className="flex items-center gap-2 text-emerald-700">
              <UserCheck className="h-5 w-5" />
              <span className="text-sm font-medium">{t("docQueueActiveNow")}</span>
            </div>
            <p className="mt-1 text-2xl font-bold text-emerald-800">{active.length}</p>
          </div>
        </div>

        {clinicalEntry && (clinicalEntry.status === "in_progress" || clinicalEntryId === clinicalEntry.id) && (
          <div
            id={CLINICAL_EXAM_ANCHOR}
            className="mc-exam-shell"
          >
            <div className="mc-exam-shell-header">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div>
                  <p className="text-lg font-bold text-white">
                    {t("docExamPrefix")}{" "}
                    {clinicalEntry.patient?.full_name_ar ??
                      clinicalEntry.patient_name ??
                      `${t("docTicketNumber")} ${clinicalEntry.ticket_number}`}
                  </p>
                  <p className="mt-1 text-xs text-blue-100">{t("docExamChartHint")}</p>
                </div>
                {clinicalEntry.patient_id && (
                  <Link
                    href={buildDoctorPatientUrl(clinicalEntry.patient_id)}
                    className="rounded-lg border border-white/30 bg-white/15 px-3 py-1.5 text-xs font-medium text-white hover:bg-white/25"
                  >
                    {t("docFullPatientFile")}
                  </Link>
                )}
              </div>
            </div>

            <div className="mc-exam-shell-body">
            <VisitSessionClinicalPanel
              patientId={clinicalEntry.patient_id}
              queueEntryId={clinicalEntry.id}
              portal="doctor"
              defaultOpen
              hideHeader
            />
            </div>
          </div>
        )}

        {waiting.length === 0 && active.length === 0 ? (
          <div className="flex flex-col items-center rounded-2xl border border-dashed border-slate-200 bg-white py-12 text-center">
            <Users className="mb-2 h-10 w-10 text-slate-300" />
            <p className="font-medium text-slate-500">{t("docQueueEmpty")}</p>
            <p className="mt-1 text-xs text-slate-400">{t("docQueueEmptyHint")}</p>
          </div>
        ) : (
          <div className="space-y-3">
            {[...waiting, ...active].map((entry) => {
              const style = STATUS_STYLE[entry.status];
              const statusLabel = doctorQueueStatusLabel(t, entry.status);
              const cfg = { ...style, label: statusLabel };
              const name =
                entry.patient?.full_name_ar ?? entry.patient_name ?? `${t("docTicketNumber")} ${entry.ticket_number}`;
              const isClinicalOpen = clinicalEntryId === entry.id;

              return (
                <div
                  key={entry.id}
                  className={cn(
                    "rounded-2xl border bg-white p-4 shadow-sm",
                    isClinicalOpen ? "border-teal-300 ring-1 ring-teal-200" : "border-slate-100"
                  )}
                >
                  <div className="flex items-start gap-3">
                    <div
                      className={cn(
                        "flex h-11 w-11 flex-shrink-0 items-center justify-center rounded-xl text-lg font-black",
                        cfg.bg,
                        cfg.color
                      )}
                    >
                      {entry.ticket_number}
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="font-bold text-slate-800">{name}</p>
                      <p className={cn("text-xs font-medium", cfg.color)}>{cfg.label}</p>
                      {!entry.sent_to_doctor_at && entry.status === "waiting" && (
                        <p className="mt-0.5 text-[10px] text-amber-700">{t("docQueueNewEntry")}</p>
                      )}
                      {entry.transfer_to_doctor_id && (
                        <p className="mt-0.5 text-[10px] text-violet-700">
                          {t("docQueueTransferLine")}{" "}
                          {entry.transfer_to_doctor?.full_name_ar ?? t("docQueueOtherDoctor")} — {t("docQueueAwaitAccountant")}
                        </p>
                      )}
                    </div>
                  </div>

                  <div className="mt-3 flex flex-col gap-2">
                    {entry.status === "waiting" && (
                      <>
                        {!entry.transfer_to_doctor_id ? (
                          <div className="flex gap-2">
                            <button
                              onClick={() => admitPatient(entry)}
                              disabled={updating === entry.id}
                              className="flex flex-1 items-center justify-center gap-2 rounded-xl bg-primary py-2.5 text-sm font-bold text-white disabled:opacity-60"
                            >
                              {updating === entry.id ? (
                                <RefreshCw className="h-4 w-4 animate-spin" />
                              ) : (
                                <LogIn className="h-4 w-4" />
                              )}
                              {t("docAdmitPatient")}
                            </button>
                            <button
                              onClick={() => recallAdmit(entry)}
                              disabled={updating === entry.id}
                              className="flex items-center justify-center gap-1.5 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2.5 text-sm font-bold text-amber-700 disabled:opacity-60"
                              title={t("queueReCallTitle")}
                            >
                              <RotateCcw className="h-4 w-4" />
                            </button>
                          </div>
                        ) : null}
                        {!entry.transfer_to_doctor_id && (
                          <div className="flex gap-2">
                            <button
                              type="button"
                              onClick={() => {
                                setTransferEntry(entry);
                                setTransferTargetId("");
                              }}
                              disabled={updating === entry.id}
                              className="flex flex-1 items-center justify-center gap-2 rounded-xl border border-violet-200 bg-violet-50 py-2.5 text-sm font-bold text-violet-800 disabled:opacity-60"
                            >
                              <ArrowRightLeft className="h-4 w-4" />
                              {t("docTransferToOther")}
                            </button>
                            <button
                              type="button"
                              onClick={() => void rejectPatient(entry)}
                              disabled={updating === entry.id}
                              className="flex flex-1 items-center justify-center gap-2 rounded-xl border border-red-200 bg-red-50 py-2.5 text-sm font-bold text-red-700 disabled:opacity-60"
                            >
                              <UserX className="h-4 w-4" />
                              {t("apptReject")}
                            </button>
                          </div>
                        )}
                      </>
                    )}
                    {entry.status === "called" && !entry.transfer_to_doctor_id && (
                      <>
                        <div className="flex gap-2">
                          <button
                            onClick={() => enterPatient(entry)}
                            disabled={updating === entry.id}
                            className="flex flex-1 items-center justify-center gap-2 rounded-xl bg-blue-600 py-2.5 text-sm font-bold text-white disabled:opacity-60"
                          >
                            {updating === entry.id ? (
                              <RefreshCw className="h-4 w-4 animate-spin" />
                            ) : (
                              <UserCheck className="h-4 w-4" />
                            )}
                            {t("docStartExamChart")}
                          </button>
                          <button
                            onClick={() => recallAdmit(entry)}
                            disabled={updating === entry.id}
                            className="flex items-center justify-center gap-1.5 rounded-xl border border-blue-200 bg-blue-50 px-3 py-2.5 text-sm font-bold text-blue-700 disabled:opacity-60"
                            title={t("docReEnterRequest")}
                          >
                            <RotateCcw className="h-4 w-4" />
                          </button>
                        </div>
                        <div className="flex gap-2">
                          <button
                            type="button"
                            onClick={() => {
                              setTransferEntry(entry);
                              setTransferTargetId("");
                            }}
                            disabled={updating === entry.id}
                            className="flex flex-1 items-center justify-center gap-2 rounded-xl border border-violet-200 bg-violet-50 py-2.5 text-sm font-bold text-violet-800 disabled:opacity-60"
                          >
                            <ArrowRightLeft className="h-4 w-4" />
                            {t("docTransferShort")}
                          </button>
                          <button
                            type="button"
                            onClick={() => void rejectPatient(entry)}
                            disabled={updating === entry.id}
                            className="flex flex-1 items-center justify-center gap-2 rounded-xl border border-red-200 bg-red-50 py-2.5 text-sm font-bold text-red-700 disabled:opacity-60"
                          >
                            <UserX className="h-4 w-4" />
                            {t("apptReject")}
                          </button>
                        </div>
                      </>
                    )}
                    {entry.status === "in_progress" && (
                      <button
                        type="button"
                        onClick={() => openClinicalExam(entry)}
                        className="flex flex-1 items-center justify-center gap-2 rounded-xl border border-teal-200 bg-teal-50 py-2.5 text-sm font-bold text-teal-900 hover:bg-teal-100"
                      >
                        <UserCheck className="h-4 w-4" />
                        {isClinicalOpen ? t("docExamOpen") : t("docOpenChartXray")}
                      </button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}

        {transferEntry && (
          <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 sm:items-center">
            <div className="w-full max-w-md rounded-t-2xl bg-white p-6 shadow-2xl sm:rounded-2xl">
              <div className="mb-4 flex items-center justify-between">
                <h3 className="text-lg font-bold text-slate-800">{t("docTransferModalTitle")}</h3>
                <button
                  type="button"
                  onClick={() => {
                    setTransferEntry(null);
                    setTransferTargetId("");
                  }}
                  className="rounded-lg p-1 hover:bg-slate-100"
                >
                  <X className="h-5 w-5 text-slate-500" />
                </button>
              </div>
              <p className="mb-4 text-sm text-slate-600">{t("docTransferModalHint")}</p>
              <select
                value={transferTargetId}
                onChange={(e) => setTransferTargetId(e.target.value)}
                className="w-full rounded-xl border border-slate-200 bg-slate-50 px-4 py-2.5 text-sm focus:border-primary focus:outline-none"
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
              <div className="mt-6 flex gap-3">
                <button
                  type="button"
                  onClick={() => {
                    setTransferEntry(null);
                    setTransferTargetId("");
                  }}
                  className="flex-1 rounded-xl border border-slate-200 py-2.5 text-sm font-medium text-slate-600"
                >
                  {t("cancel")}
                </button>
                <button
                  type="button"
                  onClick={() => void submitTransfer()}
                  disabled={!transferTargetId || updating === transferEntry.id}
                  className="flex-1 rounded-xl bg-violet-600 py-2.5 text-sm font-bold text-white disabled:opacity-60"
                >
                  {t("docRequestTransfer")}
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </>
  );
}
