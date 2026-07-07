import "server-only";

import {
  EdgeTTS,
  NoAudioReceived,
  WebSocketError,
} from "edge-tts-universal";
import { prepareArabicSpeechPlainText } from "@/lib/queue/arabic-speech-text";
import {
  ARABIC_TTS_MAX_CHARS,
  ARABIC_TTS_VOICE,
  ARABIC_TTS_VOICE_FEMALE,
} from "@/lib/queue/tts-config";
import type { PatientGender } from "@/lib/queue/patient-gender";

/** مهلة اتصال Microsoft Edge TTS — أقل من maxDuration للمسار */
const TTS_SYNTHESIS_TIMEOUT_MS = 25_000;
const MIN_AUDIO_BYTES = 128;

/** تعطيل طارئ عبر متغير بيئة على Vercel: TTS_SPEAK_DISABLED=1 */
export function isTtsSpeakDisabled(): boolean {
  return process.env.TTS_SPEAK_DISABLED === "1";
}

function mapTtsProviderError(err: unknown): Error {
  if (err instanceof WebSocketError) {
    return new Error("تعذّر الاتصال بخدمة تحويل النص إلى صوت (WebSocket)");
  }
  if (err instanceof NoAudioReceived) {
    return new Error("لم تُرجع خدمة الصوت أي بيانات صوتية");
  }
  if (err instanceof Error) {
    if (err.message.includes("timeout") || err.message.includes("مهلة")) {
      return new Error("انتهت مهلة خدمة تحويل النص إلى صوت — جرّب لاحقاً");
    }
    return err;
  }
  return new Error("تعذر توليد الصوت");
}

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

  try {
    const result = await Promise.race([
      tts.synthesize(),
      new Promise<never>((_, reject) => {
        setTimeout(() => {
          reject(new Error("TTS synthesis timeout"));
        }, TTS_SYNTHESIS_TIMEOUT_MS);
      }),
    ]);

    if (!result?.audio) {
      throw new Error("لم يُرجع المزود أي ملف صوتي");
    }

    const buffer = Buffer.from(await result.audio.arrayBuffer());
    if (buffer.length < MIN_AUDIO_BYTES) {
      throw new Error("ملف الصوت فارغ أو تالف");
    }

    return buffer;
  } catch (err) {
    throw mapTtsProviderError(err);
  }
}
