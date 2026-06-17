import { NextRequest, NextResponse } from "next/server";
import { getApiCallerProfile, isApiAssistantRole } from "@/lib/auth/api-session";
import { getAdminClient } from "@/lib/supabase/admin";
import { processQueueAddOfflinePayload } from "@/lib/offline/server/queue-add-processor";
import type { QueueAddOfflinePayload } from "@/lib/offline/types";

/** POST — رفع إضافة طابور محفوظة محلياً إلى السيرفر */
export async function POST(req: NextRequest) {
  try {
    const profile = await getApiCallerProfile(req);
    const role = String(profile?.role ?? "").toLowerCase();
    if (!profile?.clinic_id) {
      return NextResponse.json({ error: "غير مصرح" }, { status: 401 });
    }
    if (
      role !== "accountant" &&
      role !== "super_admin" &&
      role !== "admin" &&
      role !== "assistant"
    ) {
      return NextResponse.json({ error: "غير مصرح" }, { status: 403 });
    }

    const body = (await req.json()) as {
      queueId?: string;
      payload?: QueueAddOfflinePayload;
    };

    if (!body.payload || body.payload.version !== 1) {
      return NextResponse.json(
        { error: "بيانات المزامنة غير صالحة" },
        { status: 400 }
      );
    }

    if (isApiAssistantRole(role)) {
      const { resolveAssistantApiContext } = await import(
        "@/lib/auth/resolve-assistant-api"
      );
      const ctx = await resolveAssistantApiContext(profile);
      if (!ctx || ctx.doctorId !== body.payload.doctorId) {
        return NextResponse.json({ error: "غير مصرح" }, { status: 403 });
      }
    }

    const admin = getAdminClient();
    const result = await processQueueAddOfflinePayload(
      admin,
      profile.clinic_id as string,
      body.payload
    );

    if (!result.ok) {
      return NextResponse.json(
        { ok: false, error: result.error ?? "تعذر المزامنة" },
        { status: 500 }
      );
    }

    return NextResponse.json({
      ok: true,
      queueId: body.queueId ?? null,
      queueEntryId: result.queueEntryId,
    });
  } catch (err) {
    console.error("[api/offline/sync/queue-add]", err);
    return NextResponse.json(
      {
        ok: false,
        error: err instanceof Error ? err.message : "خطأ أثناء المزامنة",
      },
      { status: 500 }
    );
  }
}
