import { NextRequest, NextResponse } from "next/server";
import { getApiCallerProfile, isApiStaffRole } from "@/lib/auth/api-session";
import { getAdminClient } from "@/lib/supabase/admin";
import { fetchSessionCheckoutSummary } from "@/lib/services/session-checkout";

/** GET — ملخص إجراءات الطبيب والمبلغ المستحق للحساب النهائي */
export async function GET(req: NextRequest) {
  try {
    const profile = await getApiCallerProfile(req);
    if (!profile?.clinic_id || !isApiStaffRole(String(profile.role))) {
      return NextResponse.json({ error: "غير مصرح" }, { status: 403 });
    }

    const appointmentId = req.nextUrl.searchParams.get("appointment_id");
    const queueEntryId = req.nextUrl.searchParams.get("queue_entry_id");

    if (!appointmentId && !queueEntryId) {
      return NextResponse.json(
        { error: "appointment_id أو queue_entry_id مطلوب" },
        { status: 400 }
      );
    }

    const admin = getAdminClient();
    const summary = await fetchSessionCheckoutSummary(
      admin,
      profile.clinic_id as string,
      { appointmentId, queueEntryId }
    );

    return NextResponse.json({ summary });
  } catch (err) {
    console.error("[checkout-summary]", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "تعذر تحميل الحساب" },
      { status: 500 }
    );
  }
}
