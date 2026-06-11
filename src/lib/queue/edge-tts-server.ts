import "server-only";

import { EdgeTTS } from "@travisvn/edge-tts";
import { ARABIC_SPEECH_RATE } from "@/lib/queue/arabic-speech-text";
import {
  ARABIC_TTS_MAX_CHARS,
  ARABIC_TTS_VOICE,
} from "@/lib/queue/tts-config";

export async function synthesizeArabicSpeech(
  text: string,
  options?: { rate?: string; pitch?: string }
): Promise<Buffer> {
  const trimmed = text.trim();
  if (!trimmed) {
    throw new Error("النص فارغ");
  }
  if (trimmed.length > ARABIC_TTS_MAX_CHARS) {
    throw new Error("النص طويل جداً");
  }

  const tts = new EdgeTTS(trimmed, ARABIC_TTS_VOICE, {
    rate: options?.rate ?? ARABIC_SPEECH_RATE,
    volume: "+0%",
    pitch: options?.pitch ?? "+0Hz",
    timeout: 8000,
  });

  const result = await tts.synthesize();
  return Buffer.from(await result.audio.arrayBuffer());
}
