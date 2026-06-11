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
  patient?: { full_name_ar: string; speech_name_ar?: string | null } | null;
}

async function fetchQueueRows(portal: "doctor" | "accountant"): Promise<{
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
  const knownSentRef = useRef<Set<string>>(new Set());
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

          if (knownSentRef.current.has(entry.id)) continue;
          knownSentRef.current.add(entry.id);

          if (!readyRef.current) continue;

          const alertKey = `doctor-new-${entry.id}`;
          if (!shouldFireQueueAlert(alertKey)) continue;

          const name = resolvePatientSpeechName(entry);
          void triggerQueueAlert({
            kind: "doctor_new",
            title: "مراجع جديد 🔔",
            message: `لديك مراجع جديد في الانتظار: ${name}`,
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
  enabled = true
) {
  const readyRef = useRef(false);
  const statusRef = useRef<Map<string, string>>(new Map());
  const fingerprintRef = useRef("");

  useEffect(() => {
    if (!enabled || !clinicId) return;

    let active = true;

    async function poll() {
      try {
        const data = await fetchQueueRows("accountant");
        if (!active) return;

        const fingerprint = queueFingerprint(data.queue ?? []);
        if (fingerprint !== fingerprintRef.current) {
          fingerprintRef.current = fingerprint;
          notifyQueueRefresh({ scope: "clinic", clinicId: clinicId ?? undefined });
        }

        for (const entry of data.queue ?? []) {
          const prev = statusRef.current.get(entry.id);
          statusRef.current.set(entry.id, entry.status);

          if (!readyRef.current) continue;
          if (entry.status !== "called") continue;
          if (prev === "called") continue;

          const alertKey = `accountant-called-${entry.id}`;
          if (!shouldFireQueueAlert(alertKey)) continue;

          const name = resolvePatientSpeechName(entry);
          void triggerQueueAlert({
            kind: "accountant_admit",
            title: "طلب دخول مراجع 🔔",
            message: `المراجع ${name} — يُرجى دخوله للعيادة الآن`,
            linkPath: "/dashboard/queue",
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
  }, [clinicId, enabled]);
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
