import { NextRequest, NextResponse } from "next/server";
import { requireDeveloperSession } from "@/lib/auth/developer-gate";
import { getAdminClient } from "@/lib/supabase/admin";

/** POST — إصلاح بيانات العيادات (platform_repair_all_tenant_data) */
export async function POST(request: NextRequest) {
  const session = await requireDeveloperSession(request);
  if ("error" in session) {
    return NextResponse.json(
      { error: session.error },
      { status: session.status }
    );
  }

  const admin = getAdminClient();
  const { data, error } = await admin.rpc("platform_repair_all_tenant_data");

  if (error) {
    return NextResponse.json(
      {
        error:
          error.message.includes("platform_repair_all_tenant_data")
            ? "شغّل سكربت FIX_ALL_TENANT_DATA_AND_CLINIC_DELETE.sql في Supabase أولاً"
            : error.message,
      },
      { status: 500 }
    );
  }

  return NextResponse.json({ ok: true, result: data });
}
