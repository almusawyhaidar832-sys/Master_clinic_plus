import { NextRequest, NextResponse } from "next/server";
import {
  DEVELOPER_COOKIE,
  developerCookieOptions,
  requireDeveloperSession,
  signDeveloperToken,
} from "@/lib/auth/developer-gate";

export const runtime = "nodejs";

/** إنهاء الدخول النيابي — العودة لجلسة مطور بدون عيادة نشطة */
export async function POST(request: NextRequest) {
  const session = await requireDeveloperSession(request);
  if ("error" in session) {
    return NextResponse.json(
      { error: session.error },
      { status: session.status }
    );
  }

  const token = await signDeveloperToken({
    email: session.email,
    actingClinicId: null,
  });

  if (!token) {
    return NextResponse.json({ error: "تعذر تحديث الجلسة" }, { status: 500 });
  }

  const res = NextResponse.json({ ok: true, redirect: "/developer" });
  res.cookies.set(DEVELOPER_COOKIE, token, developerCookieOptions());
  return res;
}
