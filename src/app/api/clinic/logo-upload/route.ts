import { NextRequest, NextResponse } from "next/server";
import { getApiCallerProfile } from "@/lib/auth/api-session";
import { getAdminClient } from "@/lib/supabase/admin";

const BUCKET = "clinic-assets";
const MAX_BYTES = 2 * 1024 * 1024;
const ALLOWED = new Set(["image/png", "image/jpeg", "image/webp", "image/gif"]);

/** POST multipart — رفع شعار العيادة (محاسب / مالك) */
export async function POST(req: NextRequest) {
  try {
    const profile = await getApiCallerProfile(req);
    if (!profile?.clinic_id) {
      return NextResponse.json({ error: "غير مصرح" }, { status: 401 });
    }
    if (!["super_admin", "accountant"].includes(String(profile.role))) {
      return NextResponse.json(
        { error: "رفع الشعار متاح للمحاسب أو مالك العيادة فقط" },
        { status: 403 }
      );
    }

    const form = await req.formData();
    const file = form.get("file") as File | null;
    if (!file) {
      return NextResponse.json({ error: "الملف مطلوب" }, { status: 400 });
    }
    if (file.size > MAX_BYTES) {
      return NextResponse.json(
        { error: "حجم الشعار أكبر من 2 ميجابايت" },
        { status: 400 }
      );
    }
    if (!ALLOWED.has(file.type)) {
      return NextResponse.json(
        { error: "صيغة غير مدعومة — استخدم PNG أو JPG أو WebP" },
        { status: 400 }
      );
    }

    const admin = getAdminClient();
    const clinicId = profile.clinic_id as string;
    const ext = file.name.split(".").pop()?.toLowerCase() || "png";
    const storagePath = `${clinicId}/logo.${ext}`;

    const buffer = Buffer.from(await file.arrayBuffer());
    const { error: uploadErr } = await admin.storage
      .from(BUCKET)
      .upload(storagePath, buffer, {
        contentType: file.type,
        upsert: true,
      });

    if (uploadErr) {
      return NextResponse.json(
        {
          error: uploadErr.message.includes("Bucket not found")
            ? "أنشئ bucket باسم clinic-assets في Supabase Storage"
            : uploadErr.message,
        },
        { status: 500 }
      );
    }

    const { data: urlData } = admin.storage
      .from(BUCKET)
      .getPublicUrl(storagePath);

    const logoUrl = urlData.publicUrl;

    const { error: updateErr } = await admin
      .from("clinics")
      .update({ logo_url: logoUrl })
      .eq("id", clinicId);

    if (updateErr) {
      return NextResponse.json({ error: updateErr.message }, { status: 500 });
    }

    return NextResponse.json({ success: true, logo_url: logoUrl });
  } catch (err) {
    console.error("[clinic/logo-upload]", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "خطأ" },
      { status: 500 }
    );
  }
}
