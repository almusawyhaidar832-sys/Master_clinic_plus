"use client";

import { useCallback, useEffect, useMemo, useState, Suspense } from "react";
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
import { broadcastAdmitRequest } from "@/lib/queue/broadcast";
import {
  fetchClinicDoctorsFromSupabase,
  fetchTodayQueueFromSupabase,
} from "@/lib/queue/queue-client-fetch";
import {
  resolveDoctorSpeechName,
  resolvePatientSpeechName,
} from "@/lib/queue/utils";
import { resolvePatientGender } from "@/lib/queue/patient-gender";
import { useQueueRealtimeSync } from "@/hooks/useQueueRealtimeSync";
import { useLanguage } from "@/contexts/LanguageContext";
import { getQueueStatusLabel, type QueueStatusKey } from "@/i18n/localized-labels";
import type { Language, TranslationKey } from "@/i18n/translations";
import { useClinicProfile } from "@/contexts/ClinicProfileContext";
import { getDoctorForCurrentUser } from "@/lib/clinic-context";
import { VisitSessionClinicalPanel } from "@/components/clinical/VisitSessionClinicalPanel.lazy";
import {
  cachePortalQueue,
  getCachedPortalQueue,
  isBrowserOffline,
} from "@/lib/offline-cache";
import { prefetchTodayQueuePatientProfiles } from "@/lib/offline/patient-profile-prefetch";
import {
  Clock, UserCheck, RefreshCw, LogIn, Send, Users, RotateCcw,
  UserX, ArrowRightLeft, X, ListOrdered, Stethoscope, StickyNote, Sparkles, FileText,
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
  created_at: string;
  sent_to_doctor_at: string | null;
  transfer_to_doctor_id: string | null;
  transfer_requested_at: string | null;
  transfer_to_doctor?: { full_name_ar: string } | null;
  notes: string | null;
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
        <div className="space-y-4">
          <div className="mc-skeleton h-24 rounded-3xl" />
          <div className="grid grid-cols-2 gap-3">
            <div className="mc-skeleton h-[76px] rounded-2xl" />
            <div className="mc-skeleton h-[76px] rounded-2xl" />
          </div>
          <div className="mc-skeleton h-36 rounded-2xl" />
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

  const waiting = useMemo(
    () => queue.filter((e) => e.status === "waiting"),
    [queue]
  );
  const active = useMemo(
    () => queue.filter((e) => e.status === "called" || e.status === "in_progress"),
    [queue]
  );
  const displayedEntries = useMemo(
    () =>
      [...waiting, ...active].sort((a, b) => a.ticket_number - b.ticket_number),
    [waiting, active]
  );
  const firstWaitingTicket = useMemo(
    () =>
      waiting.length > 0
        ? Math.min(...waiting.map((e) => e.ticket_number))
        : null,
    [waiting]
  );
  const clinicalEntry = useMemo(
    () =>
      clinicalEntryId != null
        ? queue.find((e) => e.id === clinicalEntryId) ??
          ([...waiting, ...active].find((e) => e.id === clinicalEntryId) ?? null)
        : queue.find((e) => e.status === "in_progress") ?? null,
    [queue, waiting, active, clinicalEntryId]
  );

  const fetchQueue = useCallback(async () => {
    if (!clinicId) return;
    setPageError(null);
    try {
      const doc = await getDoctorForCurrentUser(supabase);
      const did = doc?.id ?? doctorId;
      if (!did) {
        setPageError(t("errQueueLoad"));
        return;
      }
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
          e.status !== "ready_for_payment"
      );
      setClinicDoctors(doctors);
      setQueue(rows);
      cachePortalQueue("doctor", did, rows);
      void prefetchTodayQueuePatientProfiles({
        portal: "doctor",
        clinicId,
        doctorId: did,
        patientIds: rows.map((e) => e.patient_id),
      });

      setClinicalEntryId((prev) =>
        prev && !rows.some((e) => e.id === prev) ? null : prev
      );
    } catch (err) {
      if (isBrowserOffline()) {
        const cached = getCachedPortalQueue<QueueEntry>("doctor", doctorId);
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
  }, [clinicId, supabase, doctorId, t]);

  useEffect(() => {
    if (clinicId) void fetchQueue();
  }, [clinicId, fetchQueue]);

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
      }
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
      if (clinicId) {
        void broadcastAdmitRequest(supabase, clinicId, {
          name,
          entryId: entry.id,
          recall: true,
          sentAt: new Date().toISOString(),
        });
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
          `رفض المراجع «${name}»؟\nسيُبلَّغ المحاسب — يحوّله أو يلغي الحجز نهائياً.`,
          `Reject patient "${name}"?\nThe accountant will be notified — they can transfer or cancel the booking permanently.`
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

  if (loading) {
    return (
      <div className="space-y-4">
        <div className="mc-skeleton h-24 rounded-3xl" />
        <div className="grid grid-cols-2 gap-3">
          <div className="mc-skeleton h-[76px] rounded-2xl" />
          <div className="mc-skeleton h-[76px] rounded-2xl" />
        </div>
        <div className="mc-skeleton h-36 rounded-2xl" />
        <div className="mc-skeleton h-36 rounded-2xl" />
      </div>
    );
  }

  return (
    <>
      <div className="space-y-4 animate-fade-in sm:space-y-5">
        <PageHeader
          className="mb-0"
          title={t("docQueueTitle")}
          subtitle={t("docQueueSubtitle")}
          eyebrow={bi("بوابة الطبيب", "Doctor portal")}
          icon={ListOrdered}
        />

        {pageError && <Alert variant="error">{pageError}</Alert>}

        <div className="grid grid-cols-2 gap-3">
          <StatTile label={t("waitingCount")} value={waiting.length} icon={Clock} tone="warning" />
          <StatTile label={t("docQueueActiveNow")} value={active.length} icon={UserCheck} tone="success" />
        </div>

        {clinicalEntry && (clinicalEntry.status === "in_progress" || clinicalEntryId === clinicalEntry.id) && (
          <div
            id={CLINICAL_EXAM_ANCHOR}
            className="mc-exam-shell"
          >
            <div className="mc-exam-shell-header">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="flex min-w-0 items-center gap-3">
                  <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-white/10 text-premium-300 ring-1 ring-inset ring-premium-300/40">
                    <Stethoscope className="h-5 w-5" />
                  </span>
                  <div className="min-w-0">
                    <p className="text-lg font-bold text-white">
                      {t("docExamPrefix")}{" "}
                      {clinicalEntry.patient?.full_name_ar ??
                        clinicalEntry.patient_name ??
                        `${t("docTicketNumber")} ${clinicalEntry.ticket_number}`}
                      <span className="ms-2 text-sm font-semibold text-premium-200">
                        · {t("ticketNumber")} {clinicalEntry.ticket_number}
                      </span>
                    </p>
                    <p className="mt-0.5 text-xs text-white/70">{t("docExamChartHint")}</p>
                  </div>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                {clinicalEntry.patient_id && (
                  <Link
                    href={buildDoctorPatientUrl(clinicalEntry.patient_id)}
                    className="inline-flex items-center gap-1.5 rounded-xl bg-mc-pearl px-3 py-1.5 text-xs font-bold text-[#0b1f3a] shadow-gold ring-1 ring-inset ring-premium-300/60 transition-all hover:-translate-y-px"
                  >
                    <FileText className="h-3.5 w-3.5" />
                    {t("docFullPatientFile")}
                  </Link>
                )}
                <button
                  type="button"
                  onClick={() => void recallAdmit(clinicalEntry)}
                  disabled={updating === clinicalEntry.id}
                  className="flex items-center gap-1.5 rounded-xl border border-white/20 bg-white/10 px-3 py-1.5 text-xs font-bold text-white transition-colors hover:bg-white/20 disabled:opacity-60"
                  title={t("queueReCallTitle")}
                >
                  {updating === clinicalEntry.id ? (
                    <RefreshCw className="h-3.5 w-3.5 animate-spin" />
                  ) : (
                    <RotateCcw className="h-3.5 w-3.5" />
                  )}
                  {t("queueReCallTitle")}
                </button>
                </div>
              </div>
            </div>

            <div className="mc-exam-shell-body">
            <VisitSessionClinicalPanel
              patientId={clinicalEntry.patient_id}
              queueEntryId={clinicalEntry.id}
              queueStatusOverride={clinicalEntry.status}
              portal="doctor"
              defaultOpen
              hideHeader
            />
            </div>
          </div>
        )}

        {waiting.length === 0 && active.length === 0 ? (
          <EmptyState
            icon={Users}
            title={t("docQueueEmpty")}
            message={t("docQueueEmptyHint")}
            className="rounded-2xl py-14"
          />
        ) : (
          <div className="space-y-3">
            <h3 className="flex items-center gap-2 px-1 text-sm font-bold text-slate-text">
              <Users className="h-4 w-4 text-premium-500" />
              {bi("قائمة المراجعين", "Patient list")}
              <span className="rounded-full border border-premium-200 bg-premium-50 px-2 py-0.5 text-[11px] font-bold tabular-nums text-premium-700">
                {displayedEntries.length}
              </span>
            </h3>
            {displayedEntries.map((entry) => {
              const style = STATUS_STYLE[entry.status];
              const statusLabel = doctorQueueStatusLabel(t, entry.status);
              const cfg = { ...style, label: statusLabel };
              const name =
                entry.patient?.full_name_ar ?? entry.patient_name ?? `${t("docTicketNumber")} ${entry.ticket_number}`;
              const isClinicalOpen = clinicalEntryId === entry.id;
              const isFirstWaiting =
                entry.status === "waiting" &&
                firstWaitingTicket != null &&
                entry.ticket_number === firstWaitingTicket;

              return (
                <div
                  key={entry.id}
                  className={cn(
                    "relative overflow-hidden rounded-2xl border bg-surface-card p-4 ps-5 shadow-card transition-all duration-200",
                    isClinicalOpen
                      ? "border-premium-300 shadow-gold ring-1 ring-premium-200"
                      : "border-slate-border hover:border-primary-200 hover:shadow-soft"
                  )}
                >
                  <span aria-hidden className={cn("absolute inset-y-3 start-0 w-1 rounded-full", cfg.bar)} />
                  <div className="flex items-start gap-3.5">
                    <div
                      className={cn(
                        "flex h-14 w-14 flex-shrink-0 flex-col items-center justify-center rounded-xl",
                        cfg.active ? "mc-icon-tile rounded-xl" : cn(cfg.bg, cfg.color)
                      )}
                    >
                      <span className="text-[10px] font-bold leading-none opacity-80">
                        {t("ticketNumber")}
                      </span>
                      <span className="mt-0.5 text-2xl font-black leading-none tabular-nums">
                        {entry.ticket_number}
                      </span>
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-base font-bold text-slate-text">{name}</p>
                      <div className="mt-1 flex flex-wrap items-center gap-1.5">
                        <span className={cn("inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] font-bold", cfg.pill)}>
                          <span className={cn("h-1.5 w-1.5 rounded-full", cfg.bar)} />
                          {cfg.label}
                        </span>
                        {isFirstWaiting && (
                          <span className="inline-flex items-center gap-1 rounded-full border border-premium-200 bg-premium-50 px-2 py-0.5 text-[10px] font-bold text-premium-700">
                            <Sparkles className="h-3 w-3" />
                            {bi("الأول بالانتظار", "First in line")}
                          </span>
                        )}
                        {!entry.sent_to_doctor_at && entry.status === "waiting" && (
                          <span className="rounded-full border border-warning-border bg-warning px-2 py-0.5 text-[10px] font-semibold text-warning-text">
                            {t("docQueueNewEntry")}
                          </span>
                        )}
                      </div>
                      {entry.transfer_to_doctor_id && (
                        <p className="mt-2 flex items-start gap-1.5 rounded-lg border border-royal-200 bg-royal-50 px-2.5 py-1.5 text-[11px] font-medium text-royal-700">
                          <ArrowRightLeft className="mt-0.5 h-3 w-3 shrink-0" />
                          <span>
                            {t("docQueueTransferLine")}{" "}
                            {entry.transfer_to_doctor?.full_name_ar ?? t("docQueueOtherDoctor")} — {t("docQueueAwaitAccountant")}
                          </span>
                        </p>
                      )}
                      {entry.notes?.trim() && (
                        <div className="mt-2 flex items-start gap-2 rounded-xl border border-premium-200 bg-premium-50 px-3 py-2 text-xs text-slate-text">
                          <StickyNote className="mt-0.5 h-3.5 w-3.5 shrink-0 text-premium-600" />
                          <div>
                            <span className="font-semibold text-premium-700">{t("docQueueAccountantNotes")}: </span>
                            {entry.notes.trim()}
                          </div>
                        </div>
                      )}
                    </div>
                  </div>

                  <div className="mt-4 flex flex-col gap-2 border-t border-slate-border pt-3">
                    {entry.status === "waiting" && (
                      <>
                        {!entry.transfer_to_doctor_id ? (
                          <div className="flex gap-2">
                            <button
                              onClick={() => admitPatient(entry)}
                              disabled={updating === entry.id}
                              className="mc-btn-navy flex-1 py-3"
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
                              className="mc-btn-soft w-12 px-0 py-3 text-primary-700"
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
                              className="mc-btn-soft flex-1 py-2.5 text-royal-700"
                            >
                              <ArrowRightLeft className="h-4 w-4" />
                              {t("docTransferToOther")}
                            </button>
                            <button
                              type="button"
                              onClick={() => void rejectPatient(entry)}
                              disabled={updating === entry.id}
                              className="mc-btn-soft flex-1 py-2.5 text-debt-text hover:border-debt-border hover:bg-debt"
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
                            className="mc-btn-navy flex-1 py-3"
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
                              className="mc-btn-soft px-3 py-3 text-primary-700"
                              title={t("queueReCallTitle")}
                            >
                              <RotateCcw className="h-4 w-4" />
                              <span className="hidden sm:inline">{t("queueReCallTitle")}</span>
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
                            className="mc-btn-soft flex-1 py-2.5 text-royal-700"
                          >
                            <ArrowRightLeft className="h-4 w-4" />
                            {t("docTransferShort")}
                          </button>
                          <button
                            type="button"
                            onClick={() => void rejectPatient(entry)}
                            disabled={updating === entry.id}
                            className="mc-btn-soft flex-1 py-2.5 text-debt-text hover:border-debt-border hover:bg-debt"
                          >
                            <UserX className="h-4 w-4" />
                            {t("apptReject")}
                          </button>
                        </div>
                      </>
                    )}
                    {entry.status === "in_progress" && (
                      <div className="flex gap-2">
                        <button
                          type="button"
                          onClick={() => openClinicalExam(entry)}
                          className="mc-btn-pearl flex-1 py-3"
                        >
                          <UserCheck className="h-4 w-4" />
                          {isClinicalOpen ? t("docExamOpen") : t("docOpenChartXray")}
                        </button>
                        <button
                          onClick={() => recallAdmit(entry)}
                          disabled={updating === entry.id}
                          className="mc-btn-soft px-3 py-3 text-primary-700"
                          title={t("queueReCallTitle")}
                        >
                          {updating === entry.id ? (
                            <RefreshCw className="h-4 w-4 animate-spin" />
                          ) : (
                            <RotateCcw className="h-4 w-4" />
                          )}
                          <span className="hidden sm:inline">{t("queueReCallTitle")}</span>
                        </button>
                      </div>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
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
    </>
  );
}
