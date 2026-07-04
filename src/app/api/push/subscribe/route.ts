import { NextRequest, NextResponse } from "next/server";
import {
  getApiCallerProfile,
  isApiAssistantRole,
  isApiDoctorRole,
  isApiStaffRole,
} from "@/lib/auth/api-session";
import { getAdminClient } from "@/lib/supabase/admin";
import { isWebPushConfigured } from "@/lib/push/server";

interface PushSubscriptionJson {
  endpoint?: string;
  keys?: { p256dh?: string; auth?: string };
}

/** POST — حفظ اشتراك Web Push للطبيب أو المساعد أو المحاسب */
export async function POST(req: NextRequest) {
  try {
    if (!isWebPushConfigured()) {
      return NextResponse.json(
        { error: "Web Push غير مفعّل على السيرفر" },
        { status: 503 }
      );
    }

    const profile = await getApiCallerProfile(req);
    const role = profile?.role ?? "";
    if (
      !profile ||
      (!isApiDoctorRole(role) &&
        !isApiAssistantRole(role) &&
        !isApiStaffRole(role))
    ) {
      return NextResponse.json({ error: "غير مصرح" }, { status: 403 });
    }
    if (!profile.clinic_id) {
      return NextResponse.json({ error: "العيادة غير محددة" }, { status: 400 });
    }

    const body = (await req.json()) as { subscription?: PushSubscriptionJson };
    const sub = body.subscription;
    const endpoint = sub?.endpoint?.trim();
    const p256dh = sub?.keys?.p256dh?.trim();
    const auth = sub?.keys?.auth?.trim();

    if (!endpoint || !p256dh || !auth) {
      return NextResponse.json(
        { error: "اشتراك Push غير صالح" },
        { status: 400 }
      );
    }

    const admin = getAdminClient();
    const userAgent = req.headers.get("user-agent");

    const { error } = await admin.from("push_subscriptions").upsert(
      {
        profile_id: profile.id,
        clinic_id: profile.clinic_id,
        endpoint,
        p256dh,
        auth,
        user_agent: userAgent,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "profile_id,endpoint" }
    );

    if (error) {
      if (error.message.includes("push_subscriptions")) {
        return NextResponse.json(
          {
            error:
              "جدول push_subscriptions غير موجود — شغّل سكربت 40-push-subscriptions.sql",
          },
          { status: 503 }
        );
      }
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    const { data: linkedDoctor } = await admin
      .from("doctors")
      .select("id")
      .eq("profile_id", profile.id)
      .eq("clinic_id", profile.clinic_id)
      .maybeSingle();

    if (isApiDoctorRole(role) && !linkedDoctor) {
      const { data: unlinkedDoctors } = await admin
        .from("doctors")
        .select("id")
        .eq("clinic_id", profile.clinic_id)
        .is("profile_id", null)
        .eq("is_active", true);

      if (unlinkedDoctors?.length === 1) {
        await admin
          .from("doctors")
          .update({ profile_id: profile.id })
          .eq("id", unlinkedDoctors[0]!.id);
      }
    }

    return NextResponse.json({ success: true });
  } catch (err) {
    console.error("[push/subscribe]", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "خطأ" },
      { status: 500 }
    );
  }
}
