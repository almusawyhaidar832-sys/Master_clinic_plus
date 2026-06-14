import "server-only";

import { EdgeTTS } from "@travisvn/edge-tts";
import { prepareArabicSpeechPlainText } from "@/lib/queue/arabic-speech-text";
import {
  ARABIC_TTS_MAX_CHARS,
  ARABIC_TTS_VOICE,
  ARABIC_TTS_VOICE_FEMALE,
} from "@/lib/queue/tts-config";
import type { PatientGender } from "@/lib/queue/patient-gender";

export async function synthesizeArabicSpeech(
  text: string,
  options?: { rate?: string; pitch?: string; gender?: PatientGender | null }
): Promise<Buffer> {
  const plain = prepareArabicSpeechPlainText(text);
  if (!plain) {
    throw new Error("النص فارغ");
  }
  if (plain.length > ARABIC_TTS_MAX_CHARS) {
    throw new Error("النص طويل جداً");
  }

  const voice =
    options?.gender === "female" ? ARABIC_TTS_VOICE_FEMALE : ARABIC_TTS_VOICE;

  const tts = new EdgeTTS(plain, voice, {
    rate: options?.rate ?? "+8%",
    volume: "+0%",
    pitch: options?.pitch ?? "+0Hz",
  });

  const result = await tts.synthesize();
  return Buffer.from(await result.audio.arrayBuffer());
}
