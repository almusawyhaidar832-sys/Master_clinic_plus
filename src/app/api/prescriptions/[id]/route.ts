import { NextRequest, NextResponse } from "next/server";
import {
  getApiCallerProfile,
  isApiStaffRole,
} from "@/lib/auth/api-session";
import { getAdminClient } from "@/lib/supabase/admin";
import { markPrescriptionPrinted } from "@/lib/prescriptions/server";

/** PATCH — تسجيل طباعة الوصفة (المحاسب) */
export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const profile = await getApiCallerProfile(req);
    if (!profile?.clinic_id) {
      return NextResponse.json({ error: "غير مصرح" }, { status: 401 });
    }

    const role = String(profile.role ?? "").toLowerCase();
    if (!isApiStaffRole(role)) {
      return NextResponse.json({ error: "للموظفين فقط" }, { status: 403 });
    }

    const { id } = await params;
    const body = (await req.json()) as { action?: string };

    if (body.action !== "mark_printed") {
      return NextResponse.json({ error: "إجراء غير مدعوم" }, { status: 400 });
    }

    const admin = getAdminClient();
    const prescription = await markPrescriptionPrinted(
      admin,
      profile.clinic_id as string,
      id,
      profile.id as string
    );

    return NextResponse.json({ prescription });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "خطأ غير متوقع";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
