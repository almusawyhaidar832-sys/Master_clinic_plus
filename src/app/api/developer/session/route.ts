import { NextRequest, NextResponse } from "next/server";
import { requireDeveloperSession } from "@/lib/auth/developer-gate";
import { getDeveloperAdminClient } from "@/lib/api/developer-route";

export const runtime = "nodejs";

export async function GET(request: NextRequest) {
  try {
    const session = await requireDeveloperSession(request);
    if ("error" in session) {
      return NextResponse.json(
        { error: session.error },
        { status: session.status }
      );
    }

    let clinicName: string | null = null;
    if (session.actingClinicId) {
      try {
        const admin = getDeveloperAdminClient();
        const { data } = await admin
          .from("clinics")
          .select("name_ar, name")
          .eq("id", session.actingClinicId)
          .maybeSingle();
        clinicName =
          (data as { name_ar?: string; name?: string } | null)?.name_ar ||
          (data as { name_ar?: string; name?: string } | null)?.name ||
          null;
      } catch {
        /* optional */
      }
    }

    return NextResponse.json({
      email: session.email,
      actingClinicId: session.actingClinicId,
      clinicName,
      impersonating: Boolean(session.actingClinicId),
    });
  } catch (e) {
    const message = e instanceof Error ? e.message : "خطأ داخلي";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
