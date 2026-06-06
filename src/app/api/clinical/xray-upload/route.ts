import { NextRequest, NextResponse } from "next/server";
import { getApiCallerProfile } from "@/lib/auth/api-session";
import { getAdminClient } from "@/lib/supabase/admin";

const BUCKET = "clinical-xrays";
const MAX_BYTES = 10 * 1024 * 1024;

/** POST multipart — upload X-ray image for a session (operation) */
export async function POST(req: NextRequest) {
  try {
    const profile = await getApiCallerProfile();
    if (!profile?.clinic_id) {
      return NextResponse.json({ error: "غير مصرح" }, { status: 401 });
    }

    const role = String(profile.role ?? "").toLowerCase();
    if (role !== "accountant" && role !== "super_admin" && role !== "doctor") {
      return NextResponse.json({ error: "غير مصرح" }, { status: 403 });
    }

    const form = await req.formData();
    const operationId = form.get("operation_id") as string | null;
    const file = form.get("file") as File | null;

    if (!operationId || !file) {
      return NextResponse.json(
        { error: "operation_id و file مطلوبان" },
        { status: 400 }
      );
    }

    if (file.size > MAX_BYTES) {
      return NextResponse.json(
        { error: "حجم الملف أكبر من 10 ميجابايت" },
        { status: 400 }
      );
    }

    const admin = getAdminClient();
    const { data: op } = await admin
      .from("patient_operations")
      .select("id, clinic_id, doctor_id")
      .eq("id", operationId)
      .maybeSingle();

    if (!op || op.clinic_id !== profile.clinic_id) {
      return NextResponse.json({ error: "الجلسة غير موجودة" }, { status: 404 });
    }

    if (role === "doctor") {
      const { data: doc } = await admin
        .from("doctors")
        .select("id")
        .eq("profile_id", profile.id)
        .maybeSingle();
      if (!doc || doc.id !== op.doctor_id) {
        return NextResponse.json({ error: "غير مصرح" }, { status: 403 });
      }
    }

    const ext = file.name.split(".").pop()?.toLowerCase() || "jpg";
    const safeName = `${crypto.randomUUID()}.${ext}`;
    const storagePath = `${op.clinic_id}/${operationId}/${safeName}`;

    const buffer = Buffer.from(await file.arrayBuffer());
    const { error: uploadErr } = await admin.storage
      .from(BUCKET)
      .upload(storagePath, buffer, {
        contentType: file.type || "image/jpeg",
        upsert: false,
      });

    if (uploadErr) {
      return NextResponse.json(
        {
          error:
            uploadErr.message.includes("Bucket not found")
              ? "أنشئ bucket باسم clinical-xrays في Supabase Storage"
              : uploadErr.message,
        },
        { status: 500 }
      );
    }

    const { error: rowErr } = await admin.from("operation_xray_images").insert({
      clinic_id: op.clinic_id,
      operation_id: operationId,
      storage_path: storagePath,
      file_name: file.name,
      mime_type: file.type || null,
      uploaded_by: profile.id,
    });

    if (rowErr) {
      await admin.storage.from(BUCKET).remove([storagePath]);
      return NextResponse.json(
        { error: rowErr.message || "تعذر تسجيل الصورة" },
        { status: 500 }
      );
    }

    return NextResponse.json({ success: true, path: storagePath });
  } catch (err) {
    console.error("[clinical/xray-upload]", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "خطأ" },
      { status: 500 }
    );
  }
}
