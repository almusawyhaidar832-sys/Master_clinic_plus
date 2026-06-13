import { NextRequest, NextResponse } from "next/server";
import {
  getApiCallerProfile,
  isApiAssistantRole,
  isApiDoctorRole,
  isApiStaffRole,
} from "@/lib/auth/api-session";
import {
  ARABIC_SPEECH_RATE,
  buildPatientCallSsml,
  buildPlainArabicSsml,
  type PatientCallSpeechParts,
} from "@/lib/queue/arabic-speech-text";
import { synthesizeArabicSpeech } from "@/lib/queue/edge-tts-server";

export const runtime = "nodejs";
export const maxDuration = 30;

function isQueueScreenCaller(req: NextRequest): boolean {
  const referer = req.headers.get("referer") ?? "";
  try {
    return new URL(referer).pathname.startsWith("/queue-screen");
  } catch {
    return false;
  }
}

function callerMayUseTts(role: string | null | undefined): boolean {
  return (
    isApiStaffRole(role) ||
    isApiDoctorRole(role) ||
    isApiAssistantRole(role)
  );
}

export async function POST(req: NextRequest) {
  try {
    const profile = await getApiCallerProfile(req);
    if (!profile && !isQueueScreenCaller(req)) {
      return NextResponse.json({ error: "غير مصرح" }, { status: 401 });
    }
    if (profile && !callerMayUseTts(profile.role) && !isQueueScreenCaller(req)) {
      return NextResponse.json({ error: "صلاحيات غير كافية" }, { status: 403 });
    }

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
