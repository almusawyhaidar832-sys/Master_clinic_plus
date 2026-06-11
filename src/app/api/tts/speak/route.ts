import { NextRequest, NextResponse } from "next/server";
import {
  ARABIC_SPEECH_RATE,
  buildPatientCallSsml,
  buildPlainArabicSsml,
  type PatientCallSpeechParts,
} from "@/lib/queue/arabic-speech-text";
import { synthesizeArabicSpeech } from "@/lib/queue/edge-tts-server";

export async function POST(req: NextRequest) {
  try {
    const body = (await req.json()) as {
      text?: string;
      parts?: PatientCallSpeechParts;
    };

    if (body.parts?.intro != null && body.parts?.patientName != null) {
      const ssml = buildPatientCallSsml(body.parts);
      const audio = await synthesizeArabicSpeech(ssml, { rate: ARABIC_SPEECH_RATE });
      return new NextResponse(new Uint8Array(audio), {
        headers: {
          "Content-Type": "audio/mpeg",
          "Cache-Control": "no-store",
        },
      });
    }

    const text = String(body.text ?? "").trim();
    if (!text) {
      return NextResponse.json({ error: "النص مطلوب" }, { status: 400 });
    }

    const ssml = buildPlainArabicSsml(text);
    const audio = await synthesizeArabicSpeech(ssml, { rate: ARABIC_SPEECH_RATE });
    return new NextResponse(new Uint8Array(audio), {
      headers: {
        "Content-Type": "audio/mpeg",
        "Cache-Control": "no-store",
      },
    });
  } catch (err) {
    const message =
      err instanceof Error ? err.message : "تعذر توليد الصوت";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
