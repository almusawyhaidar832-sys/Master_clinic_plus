import { NextRequest, NextResponse } from "next/server";
import {
  getApiCallerProfile,
  isApiAssistantRole,
  isApiDoctorRole,
  isApiStaffRole,
} from "@/lib/auth/api-session";
import {
  ARABIC_SPEECH_RATE,
  joinPatientCallSpeech,
  prepareArabicSpeechPlainText,
  type PatientCallSpeechParts,
} from "@/lib/queue/arabic-speech-text";
import { synthesizeArabicSpeech, isTtsSpeakDisabled } from "@/lib/queue/edge-tts-server";

export const runtime = "nodejs";
export const maxDuration = 30;

function isQueueScreenCaller(req: NextRequest): boolean {
  // ترويسة مخصّصة يضبطها العميل صراحةً — تعمل حتى إذا لم يُرسل متصفح
  // شاشة التلفاز ترويسة Referer (شائع في متصفحات Tizen/webOS القديمة).
  if (req.headers.get("x-queue-screen-request") === "1") return true;

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

function ttsErrorStatus(message: string): number {
  const lower = message.toLowerCase();
  if (
    lower.includes("websocket") ||
    lower.includes("timeout") ||
    lower.includes("مهلة") ||
    lower.includes("غير متاح") ||
    lower.includes("لم تُرجع") ||
    lower.includes("لم يُرجع")
  ) {
    return 503;
  }
  return 500;
}

export async function POST(req: NextRequest) {
  if (isTtsSpeakDisabled()) {
    return NextResponse.json(
      { error: "خدمة تحويل النص إلى صوت معطّلة مؤقتاً" },
      { status: 503 }
    );
  }

  try {
    const profile = await getApiCallerProfile(req);
    if (!profile && !isQueueScreenCaller(req)) {
      return NextResponse.json({ error: "غير مصرح" }, { status: 401 });
    }
    if (profile && !callerMayUseTts(profile.role) && !isQueueScreenCaller(req)) {
      return NextResponse.json({ error: "صلاحيات غير كافية" }, { status: 403 });
    }

    let body: { text?: string; parts?: PatientCallSpeechParts };
    try {
      body = (await req.json()) as { text?: string; parts?: PatientCallSpeechParts };
    } catch {
      return NextResponse.json({ error: "جسم الطلب غير صالح (JSON)" }, { status: 400 });
    }

    let plain = "";
    if (body.parts?.intro != null && body.parts?.patientName != null) {
      plain = prepareArabicSpeechPlainText(joinPatientCallSpeech(body.parts));
    } else {
      plain = prepareArabicSpeechPlainText(String(body.text ?? ""));
    }

    if (!plain) {
      return NextResponse.json({ error: "النص مطلوب" }, { status: 400 });
    }

    const audio = await synthesizeArabicSpeech(plain, { rate: ARABIC_SPEECH_RATE });
    return new NextResponse(new Uint8Array(audio), {
      headers: {
        "Content-Type": "audio/mpeg",
        "Cache-Control": "no-store",
      },
    });
  } catch (err) {
    const message =
      err instanceof Error ? err.message : "تعذر توليد الصوت";
    console.error("[api/tts/speak]", message, err);
    return NextResponse.json(
      { error: message },
      { status: ttsErrorStatus(message) }
    );
  }
}
