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
    const expectedEmail = getPlatformDeveloperEmail();
    const hints: string[] = [];
    if (process.env.NODE_ENV === "development") {
      if (!emailOk) {
        hints.push(
          `البريد المسجّل في ADMIN_EMAIL: ${expectedEmail || "غير معرّف"}`
        );
      }
      if (!passOk) {
        hints.push(
          "كلمة المرور لا تطابق PLATFORM_DEVELOPER_PASSWORD_HASH أو ADMIN_PASSWORD في .env.local"
        );
      }
      if (emailOk && !passOk) {
        hints.push(
          "بعد تغيير .env.local أعد تشغيل السيرفر (Ctrl+C ثم npm run dev)"
        );
      }
    }
    return NextResponse.json(
      {
        error: !emailOk
          ? "البريد غير مطابق لـ ADMIN_EMAIL"
          : "كلمة المرور غير صحيحة",
        hint: hints.length > 0 ? hints.join(" — ") : undefined,
        emailOk,
        passOk,
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
