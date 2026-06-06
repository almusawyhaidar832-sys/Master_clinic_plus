import { NextRequest, NextResponse } from "next/server";
import { getApiCallerProfile } from "@/lib/auth/api-session";
import { getAdminClient } from "@/lib/supabase/admin";
import { createSessionRefund } from "@/lib/services/session-refunds";
import { translateDbError } from "@/lib/db-errors";

/** POST — تسجيل إرجاع مبلغ مرتبط بجلسة */
export async function POST(req: NextRequest) {
  try {
    const profile = await getApiCallerProfile();
    if (!profile?.clinic_id) {
      return NextResponse.json({ error: "غير مصرح" }, { status: 401 });
    }

    const role = String(profile.role ?? "").toLowerCase();
    if (role !== "accountant" && role !== "super_admin") {
      return NextResponse.json({ error: "غير مصرح" }, { status: 403 });
    }

    const body = (await req.json()) as {
      sessionId?: string;
      amount?: number;
      reason?: string;
    };

    const sessionId = String(body.sessionId ?? "").trim();
    const amount = Number(body.amount ?? 0);
    const reason = String(body.reason ?? "").trim();

    if (!sessionId) {
      return NextResponse.json({ error: "معرّف الجلسة مطلوب" }, { status: 400 });
    }

    const admin = getAdminClient();
    const result = await createSessionRefund(admin, {
      clinicId: profile.clinic_id,
      sessionId,
      amount,
      reason,
      createdBy: profile.id,
    });

    if (result.error) {
      return NextResponse.json(
        { error: translateDbError(result.error) },
        { status: 400 }
      );
    }

    return NextResponse.json({ success: true, refund: result.refund });
  } catch (err) {
    console.error("[api/refunds]", err);
    const msg = err instanceof Error ? err.message : "تعذر تسجيل الإرجاع";
    return NextResponse.json({ error: translateDbError(msg) }, { status: 500 });
  }
}
