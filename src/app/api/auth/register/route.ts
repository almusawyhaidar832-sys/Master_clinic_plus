import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

function internalEmail(username: string) {
  const safe = username.toLowerCase().replace(/[^a-z0-9._-]/g, "");
  return `${safe}@masterclinic.local`;
}

export async function POST(request: Request) {
  const body = await request.json();
  const username = String(body.username ?? "").trim();
  const password = String(body.password ?? "");
  const fullName = String(body.fullName ?? username).trim();

  if (!username || username.length < 3) {
    return NextResponse.json(
      { error: "اسم المستخدم يجب أن يكون 3 أحرف على الأقل" },
      { status: 400 }
    );
  }

  if (!password || password.length < 6) {
    return NextResponse.json(
      { error: "كلمة المرور يجب أن تكون 6 أحرف على الأقل" },
      { status: 400 }
    );
  }

  const supabase = await createClient();
  const email = internalEmail(username);

  const { data: existing } = await supabase.rpc("get_email_for_username", {
    p_username: username,
  });

  if (existing) {
    return NextResponse.json(
      { error: "اسم المستخدم مستخدم مسبقاً" },
      { status: 409 }
    );
  }

  const { data: signUpData, error: signUpError } = await supabase.auth.signUp({
    email,
    password,
    options: {
      data: { username, full_name: fullName },
    },
  });

  if (signUpError) {
    return NextResponse.json(
      { error: signUpError.message || "تعذر إنشاء الحساب" },
      { status: 400 }
    );
  }

  if (!signUpData.user) {
    return NextResponse.json({ error: "تعذر إنشاء الحساب" }, { status: 400 });
  }

  const { data: clinic } = await supabase
    .from("clinics")
    .select("id")
    .limit(1)
    .maybeSingle();

  if (!clinic?.id) {
    return NextResponse.json(
      {
        error:
          "لا توجد عيادة مسجّلة بعد. يجب على المدير إعداد العيادة قبل إنشاء حسابات.",
      },
      { status: 400 }
    );
  }

  const { error: profileError } = await supabase.from("profiles").upsert({
    id: signUpData.user.id,
    username,
    full_name: fullName,
    role: "accountant",
    clinic_id: clinic.id,
  });

  if (profileError) {
    return NextResponse.json(
      { error: "تم إنشاء الحساب لكن فشل ربط الملف الشخصي. تواصل مع الإدارة." },
      { status: 500 }
    );
  }

  return NextResponse.json({
    ok: true,
    message: "تم إنشاء الحساب. يمكنك تسجيل الدخول الآن.",
  });
}
