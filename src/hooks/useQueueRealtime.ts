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
import { buildDoctorQueueClinicalUrl } from "@/lib/queue/navigation";
import {
  formatAccountantBillingAlertMessage,
  formatDoctorQueueAlertMessage,
} from "@/lib/queue/intake-notes";
import { resolvePatientSpeechName } from "@/lib/queue/utils";
import { resolvePatientGender, type PatientGender } from "@/lib/queue/patient-gender";
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
  notes?: string | null;
  doctor_notes?: string | null;
  patient?: {
    full_name_ar: string;
    speech_name_ar?: string | null;
    gender?: string | null;
  } | null;
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
  const gender = resolvePatientGender(row);
  const msg = formatDoctorQueueAlertMessage(name, {
    recall,
    notes: row.notes,
  });
  void triggerQueueAlert({
    kind: "doctor_new",
    title: recall ? "تذكير — مراجع 🔔" : "مراجع جديد 🔔",
    message: msg,
    linkPath: "/doctor/queue",
    patientName: name,
    patientGender: gender,
  });
}

function alertAccountantAdmit(
  row: QueuePayload,
  dedupeKey: string,
  seen: Set<string>,
  linkPath = "/dashboard/queue"
) {
  if (seen.has(dedupeKey)) return;
  if (!shouldFireQueueAlert(`accountant-called-${row.id}`)) return;
  seen.add(dedupeKey);

  const name = resolvePatientSpeechName(row);
  const gender = resolvePatientGender(row);
  const msg = `المراجع ${name} — يُرجى دخوله للعيادة الآن`;
  void triggerQueueAlert({
    kind: "accountant_admit",
    title: "طلب دخول مراجع 🔔",
    message: msg,
    linkPath,
    patientName: name,
    patientGender: gender,
  });
}

function alertAccountantBilling(
  payload: {
    name?: string;
    entryId?: string;
    linkPath?: string;
    gender?: PatientGender;
    doctorNotes?: string;
  },
  seen: Set<string>
) {
  const entryId = payload.entryId;
  const key = entryId ? `billing-${entryId}` : `billing-${payload.name ?? Date.now()}`;
  if (seen.has(key)) return;
  if (entryId && !shouldFireQueueAlert(`accountant-billing-${entryId}`)) return;
  seen.add(key);

  const name = formatNameForSpeech(payload.name?.trim() || "مراجع");
  const linkPath = payload.linkPath ?? "/dashboard/ledger";
  void triggerQueueAlert({
    kind: "accountant_billing",
    title: "جلسة جاهزة للمحاسبة 🔔",
    message: formatAccountantBillingAlertMessage(name, payload.doctorNotes),
    linkPath,
    patientName: name,
    patientGender: payload.gender ?? null,
  });
}

function alertAccountantBillingFromRow(
  row: QueuePayload,
  dedupeKey: string,
  seen: Set<string>
) {
  if (seen.has(dedupeKey)) return;
  if (!shouldFireQueueAlert(`accountant-billing-${row.id}`)) return;
  seen.add(dedupeKey);

  const name = resolvePatientSpeechName(row);
  const gender = resolvePatientGender(row);
  const linkPath = `/dashboard/ledger?queue_entry_id=${row.id}`;
  void triggerQueueAlert({
    kind: "accountant_billing",
    title: "جلسة جاهزة للمحاسبة 🔔",
    message: formatAccountantBillingAlertMessage(name, row.doctor_notes),
    linkPath,
    patientName: name,
    patientGender: gender,
  });
}

function alertAccountantFromBroadcast(
  payload: { name?: string; entryId?: string; gender?: PatientGender },
  seen: Set<string>,
  linkPath = "/dashboard/queue"
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
    linkPath,
    patientName: name,
    patientGender: payload.gender ?? null,
  });
}

function alertDoctorExamStart(row: QueuePayload, dedupeKey: string, seen: Set<string>) {
  if (seen.has(dedupeKey)) return;
  if (!shouldFireQueueAlert(`doctor-exam-${row.id}`)) return;
  seen.add(dedupeKey);

  const name = resolvePatientSpeechName(row);
  const gender = resolvePatientGender(row);
  const linkPath = buildDoctorQueueClinicalUrl({
    queueEntryId: row.id,
    patientId: row.patient_id,
  });

  void triggerQueueAlert({
    kind: "doctor_exam",
    title: "بدء الكشف",
    message: `${name} داخل العيادة — افتح السجل الطبي البصري`,
    linkPath,
    patientName: name,
    patientGender: gender,
  });
}

function alertDoctorFromBroadcast(
  payload: { name?: string; entryId?: string; recall?: boolean; sentAt?: string; notes?: string },
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
    message: formatDoctorQueueAlertMessage(name, {
      recall,
      notes: payload.notes,
    }),
    linkPath: "/doctor/queue",
    patientName: name,
  });
}

/**
 * Doctor-side: realtime alerts + signals queue pages to refetch.
 */
export function useDoctorQueueRealtime(
  doctorId: string | null | undefined,
  options?: { alerts?: boolean }
) {
  const seenRef = useRef<Set<string>>(new Set());
  const alertsEnabled = options?.alerts !== false;

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

          if (!alertsEnabled) return;

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
            alertDoctorExamStart(row, `exam-${row.id}`, seenRef.current);
          }
        }
      )
      .on(
        "broadcast",
        { event: "queue_patient_sent" },
        ({ payload }) => {
          const p = payload as {
            name?: string;
            entryId?: string;
            recall?: boolean;
            sentAt?: string;
          };
          notifyQueueRefresh({ scope: "doctor", doctorId });
          if (alertsEnabled) {
            alertDoctorFromBroadcast(p, seenRef.current);
          }
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
  }, [doctorId, alertsEnabled]);
}

/**
 * Accountant-side: realtime alerts + signals queue pages to refetch.
 */
export function useAccountantQueueRealtime(
  clinicId: string | null | undefined,
  options?: { admitLinkPath?: string; doctorId?: string }
) {
  const seenRef = useRef<Set<string>>(new Set());
  const admitLinkPath = options?.admitLinkPath ?? "/dashboard/queue";
  const filterDoctorId = options?.doctorId;

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
          if (filterDoctorId) {
            notifyQueueRefresh({ scope: "doctor", doctorId: filterDoctorId });
          }

          if (payload.eventType !== "UPDATE") return;

          const row = parseQueueRow(payload.new as Record<string, unknown>);
          const old = payload.old as { status?: string } | undefined;
          if (!row) return;

          if (
            row.status === "ready_for_billing" &&
            old?.status !== "ready_for_billing"
          ) {
            if (filterDoctorId && row.doctor_id !== filterDoctorId) return;
            alertAccountantBillingFromRow(
              row,
              `billing-row-${row.id}`,
              seenRef.current
            );
            return;
          }

          if (row.status !== "called" || old?.status === "called") return;
          if (filterDoctorId && row.doctor_id !== filterDoctorId) return;
          alertAccountantAdmit(row, `called-${row.id}`, seenRef.current, admitLinkPath);
        }
      )
      .on(
        "broadcast",
        { event: "queue_admit_request" },
        ({ payload }) => {
          const p = payload as {
            name?: string;
            entryId?: string;
            gender?: PatientGender;
          };
          notifyQueueRefresh({ scope: "clinic", clinicId });
          if (filterDoctorId) {
            notifyQueueRefresh({ scope: "doctor", doctorId: filterDoctorId });
          }
          alertAccountantFromBroadcast(p, seenRef.current, admitLinkPath);
        }
      )
      .on(
        "broadcast",
        { event: "queue_billing_ready" },
        ({ payload }) => {
          const p = payload as {
            name?: string;
            entryId?: string;
            linkPath?: string;
            gender?: PatientGender;
            doctorNotes?: string;
          };
          notifyQueueRefresh({ scope: "clinic", clinicId });
          alertAccountantBilling(p, seenRef.current);
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
  }, [clinicId, admitLinkPath, filterDoctorId]);
}
