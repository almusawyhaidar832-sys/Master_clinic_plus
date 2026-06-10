import { NextRequest, NextResponse } from "next/server";
import { getApiCallerProfile, isApiStaffRole } from "@/lib/auth/api-session";
import { getAdminClient } from "@/lib/supabase/admin";

const XRAY_BUCKET = "clinical-xrays";
const SIGNED_URL_TTL_SEC = 3600;

/** GET ?patient_id= — السجل الطبي البصري لكل جلسات المريض */
export async function GET(req: NextRequest) {
  try {
    const profile = await getApiCallerProfile(req);
    if (!profile?.clinic_id) {
      return NextResponse.json({ error: "غير مصرح" }, { status: 401 });
    }

    const role = String(profile.role ?? "").toLowerCase();
    if (!isApiStaffRole(role) && role !== "doctor") {
      return NextResponse.json({ error: "غير مصرح" }, { status: 403 });
    }

    const patientId = req.nextUrl.searchParams.get("patient_id");
    if (!patientId) {
      return NextResponse.json({ error: "patient_id مطلوب" }, { status: 400 });
    }

    const admin = getAdminClient();
    const { data: ops } = await admin
      .from("patient_operations")
      .select("id, doctor_id")
      .eq("patient_id", patientId)
      .eq("clinic_id", profile.clinic_id);

    const operationIds = (ops ?? []).map((o) => o.id as string);
    if (operationIds.length === 0) {
      return NextResponse.json({ byOperation: {} });
    }

    if (role === "doctor") {
      const { data: doc } = await admin
        .from("doctors")
        .select("id")
        .eq("profile_id", profile.id)
        .maybeSingle();
      if (!doc) {
        return NextResponse.json({ error: "غير مصرح" }, { status: 403 });
      }
      const allowed = new Set(
        (ops ?? []).filter((o) => o.doctor_id === doc.id).map((o) => o.id as string)
      );
      if (allowed.size === 0) {
        return NextResponse.json({ byOperation: {} });
      }
      operationIds.splice(0, operationIds.length, ...allowed);
    }

    const byOperation: Record<
      string,
      {
        teeth: { tooth_number: number; procedure_ar: string; note?: string | null }[];
        xrays: { id: string; url: string; file_name?: string | null; mime_type?: string | null }[];
      }
    > = {};

    for (const id of operationIds) {
      byOperation[id] = { teeth: [], xrays: [] };
    }

    const { data: teethRows, error: teethErr } = await admin
      .from("operation_tooth_records")
      .select("operation_id, tooth_number, procedure_ar, note")
      .in("operation_id", operationIds);

    if (teethErr) {
      const missing =
        teethErr.message.includes("operation_tooth_records") ||
        teethErr.message.includes("schema cache");
      if (missing) {
        return NextResponse.json({ byOperation: {}, tablesMissing: true });
      }
      return NextResponse.json({ error: teethErr.message }, { status: 500 });
    }

    for (const row of teethRows ?? []) {
      const opId = row.operation_id as string;
      if (!byOperation[opId]) continue;
      byOperation[opId].teeth.push({
        tooth_number: Number(row.tooth_number),
        procedure_ar: String(row.procedure_ar),
        note: row.note as string | null | undefined,
      });
    }

    const { data: xrayRows, error: xrayErr } = await admin
      .from("operation_xray_images")
      .select("id, operation_id, storage_path, file_name, mime_type")
      .in("operation_id", operationIds);

    if (!xrayErr) {
      for (const row of xrayRows ?? []) {
        const opId = row.operation_id as string;
        if (!byOperation[opId]) continue;
        const path = String(row.storage_path ?? "");
        if (!path) continue;

        const { data: signed, error: signErr } = await admin.storage
          .from(XRAY_BUCKET)
          .createSignedUrl(path, SIGNED_URL_TTL_SEC);

        if (signErr || !signed?.signedUrl) continue;

        byOperation[opId].xrays.push({
          id: row.id as string,
          url: signed.signedUrl,
          file_name: row.file_name as string | null,
          mime_type: row.mime_type as string | null,
        });
      }
    }

    return NextResponse.json({ byOperation });
  } catch (err) {
    console.error("[clinical/session-records GET]", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "خطأ" },
      { status: 500 }
    );
  }
}

/** POST — save tooth records for a patient operation (session) */
export async function POST(req: NextRequest) {
  try {
    const profile = await getApiCallerProfile(req);
    if (!profile?.clinic_id) {
      return NextResponse.json({ error: "غير مصرح" }, { status: 401 });
    }

    const role = String(profile.role ?? "").toLowerCase();
    if (!isApiStaffRole(role) && role !== "doctor") {
      return NextResponse.json({ error: "غير مصرح" }, { status: 403 });
    }

    const body = (await req.json()) as {
      operation_id?: string;
      teeth?: { tooth_number: number; procedure_ar: string; note?: string }[];
    };

    if (!body.operation_id || !body.teeth?.length) {
      return NextResponse.json(
        { error: "operation_id و teeth مطلوبان" },
        { status: 400 }
      );
    }

    const admin = getAdminClient();
    const { data: op } = await admin
      .from("patient_operations")
      .select("id, clinic_id, doctor_id")
      .eq("id", body.operation_id)
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

    const rows = body.teeth.map((t) => ({
      clinic_id: op.clinic_id,
      operation_id: op.id,
      tooth_number: t.tooth_number,
      procedure_ar: t.procedure_ar.trim(),
      note: t.note?.trim() || null,
    }));

    const { error } = await admin.from("operation_tooth_records").upsert(rows, {
      onConflict: "operation_id,tooth_number",
    });

    if (error) {
      const msg = error.message || "";
      const missingTable =
        msg.includes("operation_tooth_records") ||
        msg.includes("schema cache");
      return NextResponse.json(
        {
          error: missingTable
            ? "جدول السجل الطبي غير مُنشأ في قاعدة البيانات — شغّل ملف fix-clinical-session-records.sql في Supabase ثم أعد المحاولة"
            : msg || "تعذر حفظ مخطط الأسنان",
        },
        { status: 500 }
      );
    }

    return NextResponse.json({ success: true });
  } catch (err) {
    console.error("[clinical/session-records]", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "خطأ" },
      { status: 500 }
    );
  }
}
