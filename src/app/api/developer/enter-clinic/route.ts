import { NextRequest, NextResponse } from "next/server";
import {
  DEVELOPER_COOKIE,
  developerCookieOptions,
  requireDeveloperSession,
  signDeveloperToken,
} from "@/lib/auth/developer-gate";
import { establishImpersonationDashboardSession } from "@/lib/auth/developer-impersonation";
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

  const token = await signDeveloperToken({
    email: session.email,
    actingClinicId: clinicId,
  });

  if (!token) {
    return NextResponse.json({ error: "تعذر تحديث الجلسة" }, { status: 500 });
  }

  const clinicName =
    (clinic as { name_ar?: string; name?: string }).name_ar ||
    (clinic as { name?: string }).name;

  let sessionWarning: string | undefined;
  let authCookies: { name: string; value: string; options?: object }[] = [];

  if (linkProfile) {
    const sessionResult = await establishImpersonationDashboardSession(
      request,
      clinicId
    );
    if (!sessionResult.ok) {
      sessionWarning = sessionResult.error;
    } else {
      authCookies = sessionResult.cookies;
    }
  }

  const res = NextResponse.json({
    ok: true,
    clinicId,
    clinicName,
    redirect: "/dashboard",
    impersonation: true,
    sessionWarning,
  });
  res.cookies.set(DEVELOPER_COOKIE, token, developerCookieOptions());
  for (const { name, value, options } of authCookies) {
    res.cookies.set(name, value, options);
  }

  return res;
}
