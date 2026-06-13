"use client";

import { useEffect, useRef } from "react";
import { createClient } from "@/lib/supabase/client";
import { triggerQueueAlert } from "@/lib/queue/audio-alerts";
import { shouldFireQueueAlert } from "@/lib/queue/alert-dedupe";
import { notifyQueueRefresh } from "@/lib/queue/queue-refresh";
import {
  clinicQueueChannelName,
  doctorQueueChannelName,
} from "@/lib/queue/realtime-client";
import { buildDoctorPatientUrl } from "@/lib/queue/navigation";
import {
  resolvePatientSpeechName,
} from "@/lib/queue/utils";
import { formatNameForSpeech } from "@/lib/queue/arabic-speech-text";

interface QueuePayload {
  id: string;
  doctor_id: string;
  clinic_id: string;
  status: string;
  patient_name: string | null;
  patient_id: string | null;
  ticket_number: number;
  sent_to_doctor_at: string | null;
  patient?: { full_name_ar: string; speech_name_ar?: string | null } | null;
}

function parseQueueRow(row: Record<string, unknown>): QueuePayload | null {
  if (!row?.id || !row?.doctor_id) return null;
  return row as unknown as QueuePayload;
}

function alertDoctorNewPatient(
  row: QueuePayload,
  dedupeKey: string,
  seen: Set<string>,
  options?: { recall?: boolean }
) {
  if (seen.has(dedupeKey)) return;
  const recall = options?.recall === true;
  const dedupeId = recall
    ? `doctor-recall-${row.id}-${row.sent_to_doctor_at ?? "0"}`
    : `doctor-new-${row.id}`;
  if (!shouldFireQueueAlert(dedupeId)) return;
  seen.add(dedupeKey);

  const name = resolvePatientSpeechName(row);
  const msg = recall
    ? `تذكير: المراجع ${name} بانتظارك — يرجى استقباله`
    : `لديك مراجع جديد في الانتظار: ${name}`;
  void triggerQueueAlert({
    kind: "doctor_new",
    title: recall ? "تذكير — مراجع 🔔" : "مراجع جديد 🔔",
    message: msg,
    linkPath: "/doctor/queue",
    patientName: name,
  });
}

function alertAccountantAdmit(row: QueuePayload, dedupeKey: string, seen: Set<string>) {
  if (seen.has(dedupeKey)) return;
  if (!shouldFireQueueAlert(`accountant-called-${row.id}`)) return;
  seen.add(dedupeKey);

  const name = resolvePatientSpeechName(row);
  const msg = `المراجع ${name} — يُرجى دخوله للعيادة الآن`;
  void triggerQueueAlert({
    kind: "accountant_admit",
    title: "طلب دخول مراجع 🔔",
    message: msg,
    linkPath: "/dashboard/queue",
    patientName: name,
  });
}

function alertDoctorExamStart(row: QueuePayload, dedupeKey: string, seen: Set<string>) {
  if (seen.has(dedupeKey)) return;
  if (!shouldFireQueueAlert(`doctor-exam-${row.id}`)) return;
  seen.add(dedupeKey);

  const name = resolvePatientSpeechName(row);
  const linkPath = row.patient_id
    ? buildDoctorPatientUrl(row.patient_id)
    : "/doctor/queue";

  void triggerQueueAlert({
    kind: "doctor_exam",
    title: "بدء الكشف",
    message: `${name} داخل العيادة — افتح ملف المريض`,
    linkPath,
    patientName: name,
  });

  if (
    row.patient_id &&
    typeof window !== "undefined" &&
    window.location.pathname.startsWith("/doctor/queue")
  ) {
    window.location.href = linkPath;
  }
}

function alertDoctorFromBroadcast(
  payload: { name?: string; entryId?: string; recall?: boolean },
  seen: Set<string>
) {
  const entryId = payload.entryId;
  const recall = payload.recall === true;
  const key = entryId
    ? recall
      ? `broadcast-recall-${entryId}-${payload.sentAt ?? "0"}`
      : `broadcast-new-${entryId}`
    : `broadcast-${payload.name ?? "x"}`;
  if (seen.has(key)) return;
  const dedupeId = entryId
    ? recall
      ? `doctor-recall-${entryId}-${payload.sentAt ?? "0"}`
      : `doctor-new-${entryId}`
    : `doctor-broadcast-${payload.name ?? Date.now()}`;
  if (!shouldFireQueueAlert(dedupeId)) return;
  seen.add(key);

  const name = formatNameForSpeech(payload.name?.trim() || "مراجع");
  void triggerQueueAlert({
    kind: "doctor_new",
    title: recall ? "تذكير — مراجع 🔔" : "مراجع جديد 🔔",
    message: recall
      ? `تذكير: المراجع ${name} بانتظارك — يرجى استقباله`
      : `لديك مراجع جديد في الانتظار: ${name}`,
    linkPath: "/doctor/queue",
    patientName: name,
  });
}

function alertAccountantFromBroadcast(
  payload: { name?: string; entryId?: string },
  seen: Set<string>
) {
  const entryId = payload.entryId;
  const key = entryId ? `called-${entryId}` : `broadcast-${payload.name ?? Date.now()}`;
  if (seen.has(key)) return;
  if (entryId && !shouldFireQueueAlert(`accountant-called-${entryId}`)) return;
  seen.add(key);

  const name = formatNameForSpeech(payload.name?.trim() || "مراجع");
  void triggerQueueAlert({
    kind: "accountant_admit",
    title: "طلب دخول مراجع 🔔",
    message: `المراجع ${name} — يُرجى دخوله للعيادة الآن`,
    linkPath: "/dashboard/queue",
    patientName: name,
  });
}

/**
 * Doctor-side: realtime alerts + signals queue pages to refetch.
 */
export function useDoctorQueueRealtime(doctorId: string | null | undefined) {
  const seenRef = useRef<Set<string>>(new Set());

  useEffect(() => {
    if (!doctorId) return;

    const supabase = createClient();
    const channelName = doctorQueueChannelName(doctorId);

    const channel = supabase
      .channel(channelName, { config: { broadcast: { self: false } } })
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "patient_queue",
          filter: `doctor_id=eq.${doctorId}`,
        },
        (payload) => {
          notifyQueueRefresh({ scope: "doctor", doctorId });

          const row =
            payload.eventType === "DELETE"
              ? null
              : parseQueueRow(
                  (payload.new ?? payload.old) as Record<string, unknown>
                );
          if (!row) return;

          if (
            payload.eventType === "INSERT" &&
            row.status === "waiting" &&
            row.sent_to_doctor_at
          ) {
            alertDoctorNewPatient(row, `new-${row.id}`, seenRef.current);
          }

          if (
            payload.eventType === "UPDATE" &&
            row.sent_to_doctor_at &&
            !(payload.old as { sent_to_doctor_at?: string | null })
              ?.sent_to_doctor_at
          ) {
            alertDoctorNewPatient(
              row,
              `sent-${row.id}-${row.sent_to_doctor_at}`,
              seenRef.current
            );
          }

          if (
            payload.eventType === "UPDATE" &&
            row.sent_to_doctor_at &&
            (payload.old as { sent_to_doctor_at?: string | null })
              ?.sent_to_doctor_at &&
            row.sent_to_doctor_at !==
              (payload.old as { sent_to_doctor_at?: string | null })
                ?.sent_to_doctor_at
          ) {
            alertDoctorNewPatient(
              row,
              `recall-${row.id}-${row.sent_to_doctor_at}`,
              seenRef.current,
              { recall: true }
            );
          }

          const oldStatus = (payload.old as { status?: string } | undefined)
            ?.status;
          if (
            payload.eventType === "UPDATE" &&
            row.status === "in_progress" &&
            oldStatus === "called"
          ) {
            alertDoctorExamStart(
              row,
              `exam-${row.id}`,
              seenRef.current
            );
          }
        }
      )
      .on(
        "broadcast",
        { event: "queue_patient_sent" },
        ({ payload }) => {
          const p = payload as { name?: string; entryId?: string };
          notifyQueueRefresh({ scope: "doctor", doctorId });
          alertDoctorFromBroadcast(p, seenRef.current);
        }
      )
      .subscribe((status) => {
        if (status === "CHANNEL_ERROR") {
          console.warn("[queue] doctor realtime channel error", doctorId);
        }
      });

    return () => {
      supabase.removeChannel(channel);
    };
  }, [doctorId]);
}

/**
 * Accountant-side: realtime alerts + signals queue pages to refetch.
 */
export function useAccountantQueueRealtime(clinicId: string | null | undefined) {
  const seenRef = useRef<Set<string>>(new Set());

  useEffect(() => {
    if (!clinicId) return;

    const supabase = createClient();
    const channelName = clinicQueueChannelName(clinicId);

    const channel = supabase
      .channel(channelName, { config: { broadcast: { self: false } } })
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "patient_queue",
          filter: `clinic_id=eq.${clinicId}`,
        },
        (payload) => {
          notifyQueueRefresh({ scope: "clinic", clinicId });

          if (payload.eventType !== "UPDATE") return;

          const row = parseQueueRow(payload.new as Record<string, unknown>);
          const old = payload.old as { status?: string } | undefined;
          if (!row || row.status !== "called" || old?.status === "called") return;
          alertAccountantAdmit(row, `called-${row.id}`, seenRef.current);
        }
      )
      .on(
        "broadcast",
        { event: "queue_admit_request" },
        ({ payload }) => {
          const p = payload as { name?: string; entryId?: string };
          notifyQueueRefresh({ scope: "clinic", clinicId });
          alertAccountantFromBroadcast(p, seenRef.current);
        }
      )
      .subscribe((status) => {
        if (status === "CHANNEL_ERROR") {
          console.warn("[queue] clinic realtime channel error", clinicId);
        }
      });

    return () => {
      supabase.removeChannel(channel);
    };
  }, [clinicId]);
}
