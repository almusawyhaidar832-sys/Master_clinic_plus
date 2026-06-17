import { NextRequest, NextResponse } from "next/server";
import { getApiCallerProfile } from "@/lib/auth/api-session";
import { getAdminClient } from "@/lib/supabase/admin";
import { processQuickEntryOfflinePayload } from "@/lib/offline/server/quick-entry-processor";
import type { QuickEntryOfflinePayload } from "@/lib/offline/types";

/** POST — رفع إدخال محاسب محفوظ محلياً (IndexedDB) إلى السيرفر */
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
      role !== "admin"
    ) {
      return NextResponse.json({ error: "غير مصرح" }, { status: 403 });
    }

    const body = (await req.json()) as {
      queueId?: string;
      payload?: QuickEntryOfflinePayload;
    };

    if (!body.payload || body.payload.version !== 1) {
      return NextResponse.json(
        { error: "بيانات المزامنة غير صالحة" },
        { status: 400 }
      );
    }

    const admin = getAdminClient();
    const result = await processQuickEntryOfflinePayload(
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
      operationId: result.operationId,
      patientId: result.patientId,
    });
  } catch (err) {
    console.error("[api/offline/sync/quick-entry]", err);
    return NextResponse.json(
      {
        ok: false,
        error: err instanceof Error ? err.message : "خطأ أثناء المزامنة",
      },
      { status: 500 }
    );
  }
}
