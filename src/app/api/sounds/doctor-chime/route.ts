import { NextResponse } from "next/server";
import { synthesizeArabicSpeech } from "@/lib/queue/edge-tts-server";

export const runtime = "nodejs";

let cachedChime: Buffer | null = null;

/** Short cached chime — instant notification sound when app is closed */
export async function GET() {
  try {
    if (!cachedChime) {
      cachedChime = await synthesizeArabicSpeech("تنبيه");
    }

    return new NextResponse(new Uint8Array(cachedChime), {
      headers: {
        "Content-Type": "audio/mpeg",
        "Cache-Control": "public, max-age=31536000, immutable",
      },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "تعذر توليد الصوت";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
