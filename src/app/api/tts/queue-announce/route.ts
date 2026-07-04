import { NextRequest, NextResponse } from "next/server";
import {
  synthesizeQueueAnnounceForEntry,
  verifyQueueAnnounceToken,
  type QueueAnnounceVariant,
} from "@/lib/queue/queue-announce-audio-url";

export const runtime = "nodejs";
export const maxDuration = 30;

const VARIANTS = new Set<QueueAnnounceVariant>([
  "accountant_admit",
  "accountant_billing",
  "queue_screen",
]);

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const entryId = searchParams.get("entryId")?.trim() ?? "";
    const variant = searchParams.get("variant")?.trim() as QueueAnnounceVariant;
    const exp = Number(searchParams.get("exp"));
    const sig = searchParams.get("sig")?.trim() ?? "";

    if (!entryId || !VARIANTS.has(variant)) {
      return NextResponse.json({ error: "طلب غير صالح" }, { status: 400 });
    }

    if (!verifyQueueAnnounceToken(entryId, variant, exp, sig)) {
      return NextResponse.json({ error: "غير مصرح" }, { status: 401 });
    }

    const audio = await synthesizeQueueAnnounceForEntry(entryId, variant);

    return new NextResponse(new Uint8Array(audio), {
      headers: {
        "Content-Type": "audio/mpeg",
        "Cache-Control": "public, max-age=7200",
      },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "تعذر توليد الصوت";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
