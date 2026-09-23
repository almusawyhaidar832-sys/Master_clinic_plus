import { NextRequest, NextResponse } from "next/server";
import { getApiCallerProfile } from "@/lib/auth/api-session";
import {
  fetchNotificationsForRecipient,
  fetchUnreadNotificationCountForRecipient,
} from "@/lib/notifications/server";

/** GET — قائمة الإشعارات + العدد غير المقروء */
export async function GET(req: NextRequest) {
  try {
    const profile = await getApiCallerProfile(req);
    if (!profile) {
      return NextResponse.json({ error: "يجب تسجيل الدخول" }, { status: 401 });
    }

    if (req.nextUrl.searchParams.get("count_only") === "1") {
      const unreadCount = await fetchUnreadNotificationCountForRecipient(profile.id);
      return NextResponse.json({ unread_count: unreadCount });
    }

    const [items, unreadCount] = await Promise.all([
      fetchNotificationsForRecipient(profile.id),
      fetchUnreadNotificationCountForRecipient(profile.id),
    ]);

    return NextResponse.json({ items, unread_count: unreadCount });
  } catch (err) {
    console.error("[notifications/inbox]", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "خطأ" },
      { status: 500 }
    );
  }
}
