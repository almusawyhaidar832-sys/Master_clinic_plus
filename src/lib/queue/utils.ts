/** Shared queue helpers (safe for client + server) */

import { formatNameForSpeech } from "@/lib/queue/arabic-speech-text";

export function resolvePatientDisplayName(entry: {
  patient?: { full_name_ar: string; speech_name_ar?: string | null } | null;
  patient_name?: string | null;
  ticket_number?: number;
}): string {
  return (
    entry.patient?.full_name_ar ??
    entry.patient_name?.trim() ??
    (entry.ticket_number ? `رقم ${entry.ticket_number}` : "مراجع")
  );
}

/** اسم للنداء الصوتي — يفضّل speech_name_ar ثم التشكيل التلقائي */
export function resolvePatientSpeechName(entry: {
  patient?: { full_name_ar: string; speech_name_ar?: string | null } | null;
  patient_name?: string | null;
  ticket_number?: number;
}): string {
  const custom = entry.patient?.speech_name_ar?.trim();
  if (custom) return formatNameForSpeech(custom);

  const display = resolvePatientDisplayName(entry);
  return formatNameForSpeech(display);
}

export function resolveDoctorSpeechName(
  doctor?: { full_name_ar: string; speech_name_ar?: string | null } | null,
  fallback = "الطبيب"
): string {
  const name = doctor?.speech_name_ar?.trim() || doctor?.full_name_ar?.trim();
  if (!name) return fallback;
  return formatNameForSpeech(name);
}
