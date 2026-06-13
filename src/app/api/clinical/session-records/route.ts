import { NextRequest, NextResponse } from "next/server";
import {
  getApiCallerProfile,
  isApiAssistantRole,
  isApiDoctorRole,
  isApiStaffRole,
} from "@/lib/auth/api-session";
import {
  assertAssistantOwnsOperation,
  resolveAssistantApiContext,
} from "@/lib/auth/resolve-assistant-api";
import { getAdminClient } from "@/lib/supabase/admin";

const XRAY_BUCKET = "clinical-xrays";
const SIGNED_URL_TTL_SEC = 3600;

type ClinicalPayload = {
  teeth: { tooth_number: number; procedure_ar: string; note?: string | null }[];
  xrays: {
    id: string;
    url: string;
    file_name?: string | null;
    mime_type?: string | null;
  }[];
};

async function loadClinicalByOperationIds(
  admin: ReturnType<typeof getAdminClient>,
  operationIds: string[]
): Promise<
  | { byOperation: Record<string, ClinicalPayload> }
  | { error: string; tablesMissing?: boolean }
> {
  const byOperation: Record<string, ClinicalPayload> = {};
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
      return { byOperation: {}, tablesMissing: true };
    }
    return { error: teethErr.message };
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

  return { byOperation };
}

function canAccessClinicalRecords(role: string) {
  return (
    isApiStaffRole(role) ||
    isApiDoctorRole(role) ||
    isApiAssistantRole(role)
  );
}

async function assertAssistantOperationScope(
  profile: { id: string; clinic_id: string | null; role?: string | null },
  operationId: string
): Promise<NextResponse | null> {
  if (!isApiAssistantRole(profile.role)) return null;
  const ctx = await resolveAssistantApiContext(profile);
  if (!ctx) {
    return NextResponse.json(
      { error: "حساب المساعد غير مربوط بطبيب" },
      { status: 403 }
    );
  }
  const check = await assertAssistantOwnsOperation(operationId, ctx);
  if (!check.ok) {
    return NextResponse.json({ error: check.error }, { status: check.status });
  }
  return null;
}

/** GET ?patient_id= | ?operation_id= — السجل الطبي البصري */
export async function GET(req: NextRequest) {
  try {
    const profile = await getApiCallerProfile(req);
    if (!profile?.clinic_id) {
      return NextResponse.json({ error: "غير مصرح" }, { status: 401 });
    }

    const role = String(profile.role ?? "").toLowerCase();
    if (!canAccessClinicalRecords(role)) {
      return NextResponse.json({ error: "غير مصرح" }, { status: 403 });
    }

    const patientId = req.nextUrl.searchParams.get("patient_id");
    const operationIdParam = req.nextUrl.searchParams.get("operation_id");

    if (operationIdParam) {
      const scopeError = await assertAssistantOperationScope(
        profile,
        operationIdParam
      );
      if (scopeError) return scopeError;
    }

    if (!patientId && !operationIdParam) {
      return NextResponse.json(
        { error: "patient_id أو operation_id مطلوب" },
        { status: 400 }
      );
    }

    const admin = getAdminClient();

    if (operationIdParam) {
      const { data: op } = await admin
        .from("patient_operations")
        .select("id, clinic_id, doctor_id")
        .eq("id", operationIdParam)
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

      const loaded = await loadClinicalByOperationIds(admin, [operationIdParam]);
      if ("error" in loaded && loaded.error) {
        return NextResponse.json({ error: loaded.error }, { status: 500 });
      }
      const clinical =
        loaded.byOperation[operationIdParam] ?? { teeth: [], xrays: [] };
      return NextResponse.json({
        clinical,
        byOperation: { [operationIdParam]: clinical },
        tablesMissing: loaded.tablesMissing,
      });
    }

    const { data: ops } = await admin
      .from("patient_operations")
      .select("id, doctor_id")
      .eq("patient_id", patientId!)
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
      const allowed = (ops ?? [])
        .filter((o) => o.doctor_id === doc.id)
        .map((o) => o.id as string);
      if (allowed.length === 0) {
        return NextResponse.json({ byOperation: {} });
      }
      operationIds.splice(0, operationIds.length, ...allowed);
    }

    const loaded = await loadClinicalByOperationIds(admin, operationIds);
    if ("error" in loaded && loaded.error) {
      return NextResponse.json({ error: loaded.error }, { status: 500 });
    }

    return NextResponse.json({
      byOperation: loaded.byOperation,
      tablesMissing: loaded.tablesMissing,
    });
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
    if (!canAccessClinicalRecords(role)) {
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

    const scopeError = await assertAssistantOperationScope(
      profile,
      body.operation_id
    );
    if (scopeError) return scopeError;

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
    } else if (isApiAssistantRole(role)) {
      const ctx = await resolveAssistantApiContext(profile);
      if (!ctx || op.doctor_id !== ctx.doctorId) {
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
