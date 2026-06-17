import { NextRequest, NextResponse } from "next/server";
import { getApiCallerProfile } from "@/lib/auth/api-session";
import { getAdminClient } from "@/lib/supabase/admin";
import { processPrescriptionOfflinePayload } from "@/lib/offline/server/prescription-processor";
import type { PrescriptionOfflinePayload } from "@/lib/offline/types";

/** POST — رفع وصفة محفوظة محلياً */
export async function POST(req: NextRequest) {
  try {
    const profile = await getApiCallerProfile(req);
    if (!profile?.clinic_id) {
      return NextResponse.json({ error: "غير مصرح" }, { status: 401 });
    }

    const role = String(profile?.role ?? "").toLowerCase();
    if (
      role !== "doctor" &&
      role !== "accountant" &&
      role !== "super_admin" &&
      role !== "admin" &&
      role !== "assistant"
    ) {
      return NextResponse.json({ error: "غير مصرح" }, { status: 403 });
    }

    const body = (await req.json()) as {
      queueId?: string;
      payload?: PrescriptionOfflinePayload;
    };

    if (!body.payload || body.payload.version !== 1) {
      return NextResponse.json(
        { error: "بيانات المزامنة غير صالحة" },
        { status: 400 }
      );
    }

    const admin = getAdminClient();
    const result = await processPrescriptionOfflinePayload(
      admin,
      profile.clinic_id as string,
      profile.id as string,
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
      prescriptionId: result.prescriptionId,
    });
  } catch (err) {
    console.error("[api/offline/sync/prescription]", err);
    return NextResponse.json(
      {
        ok: false,
        error: err instanceof Error ? err.message : "خطأ أثناء المزامنة",
      },
      { status: 500 }
    );
  }
}
