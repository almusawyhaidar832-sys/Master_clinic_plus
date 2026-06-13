import { NextRequest, NextResponse } from "next/server";
import { getApiCallerProfile, isApiAssistantRole, isApiDoctorRole } from "@/lib/auth/api-session";
import { getAdminClient } from "@/lib/supabase/admin";
import { isWebPushConfigured } from "@/lib/push/server";

/** GET — هل اشتراك Push محفوظ على السيرفر؟ (للتحقق من التنبيهات خارج التطبيق) */
export async function GET(req: NextRequest) {
  try {
    const configured = isWebPushConfigured();
    const profile = await getApiCallerProfile(req);

    if (
      !profile ||
      (!isApiDoctorRole(profile.role) && !isApiAssistantRole(profile.role))
    ) {
      return NextResponse.json({ error: "غير مصرح" }, { status: 403 });
    }

    if (!configured) {
      return NextResponse.json({
        configured: false,
        subscriptionCount: 0,
        profileId: profile.id,
      });
    }

    const admin = getAdminClient();
    const { count, error } = await admin
      .from("push_subscriptions")
      .select("id", { count: "exact", head: true })
      .eq("profile_id", profile.id);

    if (error) {
      if (error.message.includes("push_subscriptions")) {
        return NextResponse.json({
          configured: true,
          subscriptionCount: 0,
          profileId: profile.id,
          tableMissing: true,
        });
      }
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json({
      configured: true,
      subscriptionCount: count ?? 0,
      profileId: profile.id,
    });
  } catch (err) {
    console.error("[push/status]", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "خطأ" },
      { status: 500 }
    );
  }
}
