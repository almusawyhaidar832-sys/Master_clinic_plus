/** تجهيز النص العربي لـ TTS */

import {
  hasArabicDiacritics,
  vocalizeArabicName,
} from "@/lib/queue/arabic-name-pronunciation";
import type { PatientGender } from "@/lib/queue/patient-gender";
import { ARABIC_TTS_LANG, ARABIC_TTS_VOICE } from "@/lib/queue/tts-config";
const ALEF_VARIANTS = /[\u0622\u0623\u0625\u0671]/g;
const TATWEEL = /\u0640/g;

/** سرعة النطق — جملة واحدة متصلة */
export const ARABIC_SPEECH_RATE = "+8%";

export const SPEECH_INTRO_CALLED_MALE = "يُرْجَى مِنَ المُراجعِ";
export const SPEECH_INTRO_CALLED_FEMALE = "يُرْجَى مِنَ المُراجعةِ";
export const SPEECH_INTRO_ENTER_MALE = "يُرْجَى مِنَ المُراجعِ";
export const SPEECH_INTRO_ENTER_FEMALE = "يُرْجَى مِنَ المُراجعةِ";
/** @deprecated استخدم SPEECH_INTRO_CALLED_MALE */
export const SPEECH_INTRO_CALLED = SPEECH_INTRO_CALLED_MALE;
/** @deprecated استخدم SPEECH_INTRO_ENTER_MALE */
export const SPEECH_INTRO_ENTER = SPEECH_INTRO_ENTER_MALE;
export const SPEECH_MIDDLE_CALLED = "، التوجُّه إلى عِيادةِ الدكتورِ";
export const SPEECH_MIDDLE_ENTER = "، تَفَضَّلْ بالدُخول إلى عِيادةِ الدكتورِ";

export const SPEECH_DOCTOR_NEW_INTRO = "لَدَيْكَ مُراجعٌ جَدِيدٌ في الانتظار";
export const SPEECH_DOCTOR_EXAM_TAIL = "داخل العيادة، افتح ملف المريض";
export const SPEECH_ACCOUNTANT_ADMIT_TAIL = "، يُرْجَى دُخولُه إلى العيادة الآن";

export function normalizeArabicForSpeech(text: string): string {
  let s = String(text ?? "").trim();
  if (!s) return "";

  s = s.normalize("NFC");
  s = s.replace(TATWEEL, "");
  s = s.replace(ALEF_VARIANTS, "ا");
  s = s.replace(/\u0649/g, "ي");
  s = s.replace(/\u0629/g, "ه");
  s = s.replace(/[^\u0600-\u06FF\s\u0660-\u0669A-Za-z0-9\-]/g, " ");
  s = s.replace(/\s+/g, " ").trim();

  return s;
}

/** الاسم مشكّل للنطق الصحيح — مثل أَحْمَد */
export function formatNameForSpeech(name: string): string {
  const trimmed = String(name ?? "").trim();
  if (!trimmed) return "";
  if (hasArabicDiacritics(trimmed)) {
    return trimmed.replace(/\u0640/g, "").replace(/\s+/g, " ").trim();
  }
  return vocalizeArabicName(trimmed);
}
export function buildQueueScreenAnnouncement(
  patientName: string,
  doctorName: string,
  gender?: PatientGender | null
): string {
  const patient = formatNameForSpeech(patientName) || "المُراجع";
  const doctor = formatNameForSpeech(doctorName) || "الطبيب";
  const intro =
    gender === "female" ? SPEECH_INTRO_CALLED_FEMALE : SPEECH_INTRO_CALLED_MALE;
  return `${intro} ${patient}${SPEECH_MIDDLE_CALLED} ${doctor}`;
}

export function buildAccountantCallAnnouncement(
  patientName: string,
  doctorName: string
): string {
  return buildQueueScreenAnnouncement(patientName, doctorName);
}

export function buildDoctorEnterAnnouncement(
  patientName: string,
  doctorName: string
): string {
  const patient = formatNameForSpeech(patientName) || "المُراجع";
  const doctor = formatNameForSpeech(doctorName) || "الطبيب";
  return `${SPEECH_INTRO_ENTER} ${patient}${SPEECH_MIDDLE_ENTER} ${doctor}`;
}

export type PatientCallSpeechParts = {
  intro: string;
  patientName: string;
  tail: string;
};

export function splitPatientCallSpeech(
  patientName: string,
  doctorName: string,
  variant: "called" | "enter" | "queue_screen" = "called",
  gender?: PatientGender | null
): PatientCallSpeechParts {
  const patient = formatNameForSpeech(patientName) || "المُراجع";
  const doctor = formatNameForSpeech(doctorName) || "الطبيب";
  const female = gender === "female";

  if (variant === "enter") {
    return {
      intro: female ? SPEECH_INTRO_ENTER_FEMALE : SPEECH_INTRO_ENTER_MALE,
      patientName: patient,
      tail: `${SPEECH_MIDDLE_ENTER} ${doctor}`,
    };
  }

  const intro =
    variant === "queue_screen" && female
      ? SPEECH_INTRO_CALLED_FEMALE
      : female
        ? SPEECH_INTRO_CALLED_FEMALE
        : SPEECH_INTRO_CALLED_MALE;

  return {
    intro,
    patientName: patient,
    tail: `${SPEECH_MIDDLE_CALLED} ${doctor}`,
  };
}

/** جملة نداء واحدة متصلة — بدون توقف بين الاسم الأول والثاني */
export function joinPatientCallSpeech(parts: PatientCallSpeechParts): string {
  const intro = parts.intro.trim();
  const name = parts.patientName.trim();
  const tail = parts.tail.trim();

  if (!name) return [intro, tail].filter(Boolean).join(" ");
  if (!tail) return [intro, name].filter(Boolean).join(" ");
  return `${intro} ${name}${tail}`;
}

export function buildPatientCallAnnouncement(
  patientName: string,
  doctorName: string,
  variant: "called" | "enter" | "queue_screen" = "called",
  gender?: PatientGender | null
): string {
  return joinPatientCallSpeech(
    splitPatientCallSpeech(patientName, doctorName, variant, gender)
  );
}

export function splitDoctorNewPatientSpeech(
  patientName: string,
  gender?: PatientGender | null
): PatientCallSpeechParts {
  return {
    intro: SPEECH_DOCTOR_NEW_INTRO,
    patientName: formatNameForSpeech(patientName) || (gender === "female" ? "مُراجعة" : "مُراجع"),
    tail: "",
  };
}

export function buildDoctorNewPatientAnnouncement(patientName: string): string {
  return joinPatientCallSpeech(splitDoctorNewPatientSpeech(patientName));
}

export function splitDoctorExamSpeech(
  patientName: string,
  gender?: PatientGender | null
): PatientCallSpeechParts {
  return {
    intro: gender === "female" ? "الْمُراجعةُ" : "الْمُراجعُ",
    patientName: formatNameForSpeech(patientName) || (gender === "female" ? "مُراجعة" : "مُراجع"),
    tail: SPEECH_DOCTOR_EXAM_TAIL,
  };
}

export function buildDoctorExamAnnouncement(patientName: string): string {
  return joinPatientCallSpeech(splitDoctorExamSpeech(patientName));
}

export function splitAccountantAdmitSpeech(
  patientName: string,
  gender?: PatientGender | null
): PatientCallSpeechParts {
  return {
    intro: gender === "female" ? "الْمُراجعةُ" : "الْمُراجعُ",
    patientName: formatNameForSpeech(patientName) || (gender === "female" ? "مُراجعة" : "مُراجع"),
    tail: SPEECH_ACCOUNTANT_ADMIT_TAIL,
  };
}

export function buildAccountantAdmitAnnouncement(patientName: string): string {
  return joinPatientCallSpeech(splitAccountantAdmitSpeech(patientName));
}

function escapeSsml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

/** نص عادي للـ TTS — مشكّل بدون SSML (EdgeTTS يتوقع نصاً وليس XML) */
export function prepareArabicSpeechPlainText(text: string): string {
  const trimmed = String(text ?? "").trim();
  if (!trimmed) return "";
  if (trimmed.startsWith("<speak")) {
    return trimmed
      .replace(/<[^>]+>/g, " ")
      .replace(/\s+/g, " ")
      .trim();
  }
  if (hasArabicDiacritics(trimmed)) {
    return trimmed.replace(/\u0640/g, "").replace(/\s+/g, " ").trim();
  }
  return vocalizeArabicName(trimmed);
}

export function buildPlainArabicSsml(
  text: string,
  rate: string = ARABIC_SPEECH_RATE
): string {
  const prepared = hasArabicDiacritics(text)
    ? text.replace(/\u0640/g, "").replace(/\s+/g, " ").trim()
    : vocalizeArabicName(text);
  const safe = escapeSsml(prepared);
  return `<speak version="1.0" xmlns="http://www.w3.org/2001/10/synthesis" xml:lang="${ARABIC_TTS_LANG}"><voice name="${ARABIC_TTS_VOICE}"><prosody rate="${rate}">${safe}</prosody></voice></speak>`;
}
/** SSML لنداء مراجع — جملة واحدة سريعة ومتصلة */
export function buildPatientCallSsml(parts: PatientCallSpeechParts): string {
  return buildPlainArabicSsml(joinPatientCallSpeech(parts));
}
