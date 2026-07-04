import { NextRequest, NextResponse } from "next/server";
import {
  isApiAssistantRole,
  isApiDoctorRole,
  isApiStaffRole,
} from "@/lib/auth/api-session";
import { resolveQueueApiAccess } from "@/lib/queue/api-access";
import {
  buildQueueAnnounceAudioUrl,
  type QueueAnnounceVariant,
} from "@/lib/queue/queue-announce-audio-url";

const VARIANTS = new Set<QueueAnnounceVariant>([
  "accountant_admit",
  "accountant_billing",
  "queue_screen",
]);

function staffOk(role: string) {
  return isApiStaffRole(role) || isApiAssistantRole(role);
}

/** POST — رابط MP3 موقّع لنداء مراجع (محاسب / شاشة انتظار) */
export async function POST(req: NextRequest) {
  try {
    const access = await resolveQueueApiAccess(req);
    if (!access.ok) {
      return NextResponse.json({ error: access.error }, { status: access.status });
    }

    const role = String(access.profile.role ?? "");
    if (!staffOk(role) && !isApiDoctorRole(role)) {
      return NextResponse.json({ error: "غير مصرح" }, { status: 403 });
    }

    const body = (await req.json()) as {
      entry_id?: string;
      variant?: QueueAnnounceVariant;
    };
    const entryId = String(body.entry_id ?? "").trim();
    const variant = body.variant;

    if (!entryId || !variant || !VARIANTS.has(variant)) {
      return NextResponse.json({ error: "معرّف الدور أو النوع غير صالح" }, { status: 400 });
    }

    const audioUrl = buildQueueAnnounceAudioUrl(entryId, variant);
    if (!audioUrl) {
      return NextResponse.json(
        { error: "تعذر إنشاء رابط الصوت" },
        { status: 500 }
      );
    }

    return NextResponse.json({ audioUrl });
  } catch (err) {
    console.error("[api/queue/announce-audio-url]", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "خطأ" },
      { status: 500 }
    );
  }
}
