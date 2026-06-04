import { NextRequest, NextResponse } from "next/server";
import {
  DEVELOPER_COOKIE,
  developerCookieOptions,
  getPlatformDeveloperEmail,
  isDeveloperAuthConfigured,
  signDeveloperToken,
  verifyDeveloperEmailInput,
  verifyDeveloperPassword,
} from "@/lib/auth/developer-gate";

export async function POST(request: NextRequest) {
  if (!isDeveloperAuthConfigured()) {
    return NextResponse.json(
      {
        error:
          "بوابة المدير العام غير مفعّلة — راجع ADMIN_EMAIL و PLATFORM_DEVELOPER_SECRET و HASH في .env",
      },
      { status: 503 }
    );
  }

  let email = "";
  let password = "";
  try {
    const body = await request.json();
    email = String(body?.email ?? "").trim();
    password = String(body?.password ?? "");
  } catch {
    return NextResponse.json({ error: "أدخل البريد وكلمة المرور" }, { status: 400 });
  }

  if (!email || !password) {
    return NextResponse.json({ error: "البريد وكلمة المرور مطلوبان" }, { status: 400 });
  }

  const emailOk = verifyDeveloperEmailInput(email);
  const passOk = verifyDeveloperPassword(password);
  if (!emailOk || !passOk) {
    const hint =
      process.env.NODE_ENV === "development"
        ? emailOk
          ? "كلمة المرور لا تطابق ADMIN_PASSWORD أو HASH في .env.local"
          : `البريد يجب أن يطابق ADMIN_EMAIL (${getPlatformDeveloperEmail() || "غير معرّف"})`
        : undefined;
    return NextResponse.json(
      {
        error: "بريد أو كلمة مرور غير صحيحة",
        hint,
      },
      { status: 403 }
    );
  }

  const token = await signDeveloperToken({
    email,
    actingClinicId: null,
  });

  if (!token) {
    return NextResponse.json({ error: "تعذر إنشاء الجلسة" }, { status: 500 });
  }

  const res = NextResponse.json({ ok: true, redirect: "/developer" });
  res.cookies.set(DEVELOPER_COOKIE, token, developerCookieOptions());
  return res;
}
