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

/** يوحّد حقل الطبيب من join أو مصفوفة Supabase */
export function normalizeQueueDoctorJoin(
  doctor: unknown
): { full_name_ar: string; speech_name_ar?: string | null } | null {
  if (!doctor) return null;
  const row = Array.isArray(doctor) ? doctor[0] : doctor;
  if (!row || typeof row !== "object") return null;
  const name = (row as { full_name_ar?: string }).full_name_ar?.trim();
  if (!name) return null;
  return {
    full_name_ar: name,
    speech_name_ar: (row as { speech_name_ar?: string | null }).speech_name_ar ?? null,
  };
}

/** يحلّ اسم الطبيب من join أو doctor_id أو قائمة العيادة */
export function resolveQueueDoctorName(
  entry: {
    doctor?: unknown;
    doctor_id?: string | null;
  },
  doctorNames?: Map<string, string>,
  doctors?: { id: string; full_name_ar: string }[]
): { full_name_ar: string; speech_name_ar?: string | null } | null {
  const direct = normalizeQueueDoctorJoin(entry.doctor);
  if (direct) return direct;

  const doctorId = entry.doctor_id?.trim();
  if (!doctorId) return null;

  const cached = doctorNames?.get(doctorId);
  if (cached) return { full_name_ar: cached };

  const found = doctors?.find((d) => d.id === doctorId);
  if (found?.full_name_ar) return { full_name_ar: found.full_name_ar };

  return null;
}
