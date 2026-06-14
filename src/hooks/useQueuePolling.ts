"use client";

import { useEffect, useRef } from "react";
import { authPortalHeaders } from "@/lib/auth/api-portal";
import { shouldFireQueueAlert } from "@/lib/queue/alert-dedupe";
import { triggerQueueAlert } from "@/lib/queue/audio-alerts";
import { notifyQueueRefresh } from "@/lib/queue/queue-refresh";
import { resolvePatientSpeechName } from "@/lib/queue/utils";

const POLL_MS = 3_000;

function queueFingerprint(queue: QueueRow[]): string {
  return (queue ?? [])
    .map(
      (e) =>
        `${e.id}:${e.status}:${e.sent_to_doctor_at ?? ""}:${e.ticket_number}`
    )
    .join("|");
}

interface QueueRow {
  id: string;
  status: string;
  sent_to_doctor_at: string | null;
  patient_name: string | null;
  ticket_number: number;
  doctor_id?: string;
  patient?: { full_name_ar: string; speech_name_ar?: string | null } | null;
}

async function fetchQueueRows(portal: "doctor" | "accountant" | "assistant"): Promise<{
  queue: QueueRow[];
  doctorId?: string | null;
  clinicId?: string;
}> {
  try {
    const res = await fetch("/api/queue", {
      credentials: "include",
      cache: "no-store",
      headers: authPortalHeaders(portal),
    });
    if (!res.ok) return { queue: [] };
    return res.json();
  } catch {
    return { queue: [] };
  }
}

/**
 * Polls /api/queue every 3s — works even when Supabase Realtime is off.
 * Doctor: alert when new patient is sent to their queue.
 */
export function useDoctorQueuePolling(
  doctorId: string | null | undefined,
  enabled = true
) {
  const readyRef = useRef(false);
  const sentAtRef = useRef<Map<string, string>>(new Map());
  const fingerprintRef = useRef("");

  useEffect(() => {
    if (!enabled || !doctorId) return;

    let active = true;

    async function poll() {
      try {
        const data = await fetchQueueRows("doctor");
        if (!active) return;

        const fingerprint = queueFingerprint(data.queue ?? []);
        if (fingerprint !== fingerprintRef.current) {
          fingerprintRef.current = fingerprint;
          notifyQueueRefresh({ scope: "doctor", doctorId: doctorId ?? undefined });
        }

        for (const entry of data.queue ?? []) {
          if (!entry.sent_to_doctor_at) continue;
          if (entry.status !== "waiting" && entry.status !== "called") continue;

          const prevSent = sentAtRef.current.get(entry.id);
          sentAtRef.current.set(entry.id, entry.sent_to_doctor_at);

          const isRecall =
            Boolean(prevSent) && prevSent !== entry.sent_to_doctor_at;
          const isFirstSend = !prevSent;

          if (!isFirstSend && !isRecall) continue;
          if (!readyRef.current) continue;
          // داخل التطبيق — Realtime يكفي؛ polling للتبويب بالخلفية فقط
          if (
            typeof document !== "undefined" &&
            document.visibilityState === "visible"
          ) {
            continue;
          }

          const alertKey = isRecall
            ? `doctor-recall-${entry.id}-${entry.sent_to_doctor_at}`
            : `doctor-new-${entry.id}`;
          if (!shouldFireQueueAlert(alertKey)) continue;

          const name = resolvePatientSpeechName(entry);
          void triggerQueueAlert({
            kind: "doctor_new",
            title: isRecall ? "تذكير — مراجع 🔔" : "مراجع جديد 🔔",
            message: isRecall
              ? `تذكير: المراجع ${name} بانتظارك — يرجى استقباله`
              : `لديك مراجع جديد في الانتظار: ${name}`,
            linkPath: "/doctor/queue",
            patientName: name,
          });
        }

        readyRef.current = true;
      } catch {
        // network blip — retry next interval
      }
    }

    void poll();
    const timer = setInterval(poll, POLL_MS);
    return () => {
      active = false;
      clearInterval(timer);
    };
  }, [doctorId, enabled]);
}

/**
 * Accountant: alert when doctor requests patient entry (status = called).
 */
export function useAccountantQueuePolling(
  clinicId: string | null | undefined,
  enabled = true,
  options?: {
    admitLinkPath?: string;
    doctorId?: string;
    portal?: "accountant" | "assistant";
  }
) {
  const readyRef = useRef(false);
  const statusRef = useRef<Map<string, string>>(new Map());
  const fingerprintRef = useRef("");
  const admitLinkPath = options?.admitLinkPath ?? "/dashboard/queue";
  const filterDoctorId = options?.doctorId;
  const portal = options?.portal ?? "accountant";

  useEffect(() => {
    if (!enabled || !clinicId) return;

    let active = true;

    async function poll() {
      try {
        const data = await fetchQueueRows(portal);
        if (!active) return;

        const fingerprint = queueFingerprint(data.queue ?? []);
        if (fingerprint !== fingerprintRef.current) {
          fingerprintRef.current = fingerprint;
          notifyQueueRefresh({ scope: "clinic", clinicId: clinicId ?? undefined });
          if (filterDoctorId) {
            notifyQueueRefresh({ scope: "doctor", doctorId: filterDoctorId });
          }
        }

        for (const entry of data.queue ?? []) {
          if (filterDoctorId && entry.doctor_id && entry.doctor_id !== filterDoctorId) {
            continue;
          }
          const prev = statusRef.current.get(entry.id);
          statusRef.current.set(entry.id, entry.status);

          if (!readyRef.current) continue;

          if (
            entry.status === "ready_for_billing" &&
            prev !== "ready_for_billing"
          ) {
            const billingKey = `accountant-billing-${entry.id}`;
            if (shouldFireQueueAlert(billingKey)) {
              const name = resolvePatientSpeechName(entry);
              void triggerQueueAlert({
                kind: "accountant_billing",
                title: "جلسة جاهزة للمحاسبة 🔔",
                message: `تم إكمال جلسة المراجع ${name} — أكمل الفاتورة الآن`,
                linkPath: `/dashboard/ledger?queue_entry_id=${entry.id}`,
                patientName: name,
              });
            }
          }

          if (entry.status !== "called") continue;
          if (prev === "called") continue;

          const alertKey = `accountant-called-${entry.id}`;
          if (!shouldFireQueueAlert(alertKey)) continue;

          const name = resolvePatientSpeechName(entry);
          void triggerQueueAlert({
            kind: "accountant_admit",
            title: "طلب دخول مراجع 🔔",
            message: `المراجع ${name} — يُرجى دخوله للعيادة الآن`,
            linkPath: admitLinkPath,
            patientName: name,
          });
        }

        readyRef.current = true;
      } catch {
        // retry next interval
      }
    }

    void poll();
    const timer = setInterval(poll, POLL_MS);
    return () => {
      active = false;
      clearInterval(timer);
    };
  }, [clinicId, enabled, admitLinkPath, filterDoctorId, portal]);
}

/** Load doctor id via API (more reliable than client-side doctor lookup) */
export async function fetchDoctorIdForPolling(): Promise<string | null> {
  try {
    const data = await fetchQueueRows("doctor");
    return data.doctorId ?? null;
  } catch {
    return null;
  }
}
