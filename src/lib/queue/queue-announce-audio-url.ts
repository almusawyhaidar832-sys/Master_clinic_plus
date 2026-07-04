import "server-only";

import crypto from "crypto";
import { getAdminClient } from "@/lib/supabase/admin";
import { resolveBookingPublicOrigin } from "@/lib/booking/public-origin";
import {
  buildQueueScreenAnnouncement,
  formatNameForSpeech,
  joinPatientCallSpeech,
  splitAccountantAdmitSpeech,
  splitAccountantBillingSpeech,
} from "@/lib/queue/arabic-speech-text";
import { synthesizeArabicSpeech } from "@/lib/queue/edge-tts-server";
import { resolvePatientGender } from "@/lib/queue/patient-gender";
import {
  resolveDoctorSpeechName,
  resolvePatientSpeechName,
} from "@/lib/queue/utils";

export type QueueAnnounceVariant =
  | "accountant_admit"
  | "accountant_billing"
  | "queue_screen";

const QUEUE_ENTRY_FOR_TTS = `
  id, clinic_id, patient_name, ticket_number, doctor_notes,
  doctor:doctors!doctor_id(full_name_ar, speech_name_ar),
  patient:patients(full_name_ar, speech_name_ar, gender)
`;

function signingSecret(): string {
  const key =
    process.env.VAPID_PRIVATE_KEY?.trim() ||
    process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();
  if (!key) throw new Error("missing signing secret for queue announce audio");
  return key;
}

export function signQueueAnnounceToken(
  entryId: string,
  variant: QueueAnnounceVariant,
  exp: number
): string {
  return crypto
    .createHmac("sha256", signingSecret())
    .update(`queue-announce:${entryId}:${variant}:${exp}`)
    .digest("hex")
    .slice(0, 40);
}

export function verifyQueueAnnounceToken(
  entryId: string,
  variant: QueueAnnounceVariant,
  exp: number,
  sig: string
): boolean {
  if (!Number.isFinite(exp) || exp < Math.floor(Date.now() / 1000)) {
    return false;
  }
  const expected = signQueueAnnounceToken(entryId, variant, exp);
  if (expected.length !== sig.length) return false;
  try {
    return crypto.timingSafeEqual(
      Buffer.from(expected, "utf8"),
      Buffer.from(sig, "utf8")
    );
  } catch {
    return expected === sig;
  }
}

/** رابط MP3 موقّع — يعمل على TV بدون جلسة وعلى المحاسب بدون POST TTS */
export function buildQueueAnnounceAudioUrl(
  entryId: string,
  variant: QueueAnnounceVariant
): string | undefined {
  if (!entryId.trim()) return undefined;
  try {
    const { origin } = resolveBookingPublicOrigin({});
    const exp = Math.floor(Date.now() / 1000) + 7200;
    const sig = signQueueAnnounceToken(entryId, variant, exp);
    const params = new URLSearchParams({
      entryId,
      variant,
      exp: String(exp),
      sig,
    });
    return `${origin}/api/tts/queue-announce?${params.toString()}`;
  } catch {
    return undefined;
  }
}

export async function synthesizeQueueAnnounceForEntry(
  entryId: string,
  variant: QueueAnnounceVariant
): Promise<Buffer> {
  const admin = getAdminClient();
  const { data: entry, error } = await admin
    .from("patient_queue")
    .select(QUEUE_ENTRY_FOR_TTS)
    .eq("id", entryId)
    .maybeSingle();

  if (error || !entry) {
    throw new Error("queue entry not found");
  }

  const patientRow = Array.isArray(entry.patient)
    ? entry.patient[0]
    : entry.patient;
  const doctorRow = Array.isArray(entry.doctor) ? entry.doctor[0] : entry.doctor;

  const speechName = resolvePatientSpeechName({
    patient: patientRow as {
      full_name_ar: string;
      speech_name_ar?: string | null;
    } | null,
    patient_name: entry.patient_name as string | null,
    ticket_number: entry.ticket_number as number,
  });
  const gender = resolvePatientGender({
    patient: patientRow as { gender?: string | null } | null,
    patient_name: entry.patient_name as string | null,
  });
  const formattedName = formatNameForSpeech(speechName) || speechName;

  let plain = "";
  if (variant === "accountant_admit") {
    plain = joinPatientCallSpeech(
      splitAccountantAdmitSpeech(formattedName, gender)
    );
  } else if (variant === "accountant_billing") {
    plain = joinPatientCallSpeech(
      splitAccountantBillingSpeech(formattedName, gender)
    );
  } else {
    const doctorName = resolveDoctorSpeechName(
      doctorRow as { full_name_ar: string; speech_name_ar?: string | null } | null
    );
    plain = buildQueueScreenAnnouncement(formattedName, doctorName, gender);
  }

  return synthesizeArabicSpeech(plain);
}
