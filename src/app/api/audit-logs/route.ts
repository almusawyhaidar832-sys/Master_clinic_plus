import { NextRequest, NextResponse } from "next/server";
import {
  createApiSessionClient,
  getApiCallerProfile,
} from "@/lib/auth/api-session";
import { isApiStaffRole } from "@/lib/auth/api-portal";
import {
  fetchAuditActors,
  fetchAuditFeed,
} from "@/lib/audit/audit-feed";

/** GET /api/audit-logs — activity feed for managers */
export async function GET(req: NextRequest) {
  try {
    const profile = await getApiCallerProfile(req);
    if (!profile?.clinic_id) {
      return NextResponse.json({ error: "غير مصرح" }, { status: 401 });
    }

    if (!isApiStaffRole(profile.role)) {
      return NextResponse.json({ error: "غير مصرح" }, { status: 403 });
    }

    const sp = req.nextUrl.searchParams;
    const action = sp.get("action")?.trim() || null;
    const changedBy = sp.get("changedBy")?.trim() || null;
    const entityType = sp.get("entityType")?.trim() || null;
    const limit = Number(sp.get("limit") ?? 60);
    const includeActors = sp.get("actors") === "1";

    const supabase = await createApiSessionClient(req);
    const items = await fetchAuditFeed(supabase, profile.clinic_id, {
      action,
      changedBy,
      entityType,
      limit,
    });

    if (includeActors) {
      const actors = await fetchAuditActors(supabase, profile.clinic_id);
      return NextResponse.json({ items, actors });
    }

    return NextResponse.json({ items });
  } catch (err) {
    console.error("[api/audit-logs]", err);
    return NextResponse.json(
      { error: "تعذر تحميل سجل المراقبة" },
      { status: 500 }
    );
  }
}
