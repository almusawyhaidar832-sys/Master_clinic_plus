import { NextRequest, NextResponse } from "next/server";
import {
  DEVELOPER_COOKIE,
  developerCookieOptions,
  getPlatformDeveloperEmail,
  requireDeveloperSession,
  signDeveloperToken,
} from "@/lib/auth/developer-gate";
import { getAdminClient } from "@/lib/supabase/admin";

export async function POST(request: NextRequest) {
  const session = await requireDeveloperSession(request);
  if ("error" in session) {
    return NextResponse.json({ error: session.error }, { status: session.status });
  }

  const body = (await request.json()) as {
    clinicId?: string;
    linkProfile?: boolean;
  };
  const clinicId = body.clinicId?.trim();
  /** ربط profiles.clinic_id ضروري ليعمل الداشبورد بالعيادة المختارة */
  const linkProfile = body.linkProfile !== false;

  if (!clinicId) {
    return NextResponse.json({ error: "معرّف العيادة مطلوب" }, { status: 400 });
  }

  const admin = getAdminClient();
  const { data: clinic } = await admin
    .from("clinics")
    .select("id, name_ar, name, is_active")
    .eq("id", clinicId)
    .maybeSingle();

  if (!clinic) {
    return NextResponse.json({ error: "العيادة غير موجودة" }, { status: 404 });
  }

  if ((clinic as { is_active?: boolean }).is_active === false) {
    return NextResponse.json(
      { error: "العيادة معطّلة — فعّلها من لوحة المدير العام أولاً" },
      { status: 403 }
    );
  }

  if (linkProfile) {
    const devEmail = getPlatformDeveloperEmail();
    const { data: authList } = await admin.auth.admin.listUsers({
      page: 1,
      perPage: 200,
    });
    const authUser = authList?.users?.find(
      (u) => u.email?.toLowerCase() === devEmail
    );
    if (authUser) {
      await admin
        .from("profiles")
        .update({ clinic_id: clinicId })
        .eq("id", authUser.id);
    }
  }

  const token = await signDeveloperToken({
    email: session.email,
    actingClinicId: clinicId,
  });

  if (!token) {
    return NextResponse.json({ error: "تعذر تحديث الجلسة" }, { status: 500 });
  }

  const res = NextResponse.json({
    ok: true,
    clinicId,
    clinicName: (clinic as { name_ar?: string; name?: string }).name_ar ||
      (clinic as { name?: string }).name,
    redirect: "/dashboard",
    impersonation: true,
  });
  res.cookies.set(DEVELOPER_COOKIE, token, developerCookieOptions());
  return res;
}
