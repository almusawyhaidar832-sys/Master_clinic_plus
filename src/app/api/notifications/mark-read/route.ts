import { NextRequest, NextResponse } from "next/server";
import { getApiCallerProfile } from "@/lib/auth/api-session";
import { getAdminClient } from "@/lib/supabase/admin";

/** POST — تعليم إشعار أو كل الإشعارات كمقروءة */
export async function POST(req: NextRequest) {
  try {
    const profile = await getApiCallerProfile(req);
    if (!profile) {
      return NextResponse.json({ error: "يجب تسجيل الدخول" }, { status: 401 });
    }

    const body = (await req.json()) as { id?: string; all?: boolean };
    const admin = getAdminClient();

    if (body.all) {
      const { error } = await admin
        .from("notifications")
        .update({ is_read: true })
        .eq("recipient_profile_id", profile.id)
        .eq("is_read", false);

      if (error) {
        return NextResponse.json({ error: error.message }, { status: 500 });
      }

      return NextResponse.json({ success: true, marked: "all" });
    }

    const id = body.id?.trim();
    if (!id) {
      return NextResponse.json(
        { error: "حدد id أو all: true" },
        { status: 400 }
      );
    }

    const { error } = await admin
      .from("notifications")
      .update({ is_read: true })
      .eq("id", id)
      .eq("recipient_profile_id", profile.id);

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json({ success: true, marked: id });
  } catch (err) {
    console.error("[notifications/mark-read]", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "خطأ" },
      { status: 500 }
    );
  }
}
