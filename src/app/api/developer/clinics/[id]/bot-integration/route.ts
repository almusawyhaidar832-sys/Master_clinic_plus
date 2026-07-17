import { NextRequest, NextResponse } from "next/server";
import crypto from "crypto";
import { requireDeveloperSession } from "@/lib/auth/developer-gate";
import { getAdminClient } from "@/lib/supabase/admin";

type Params = { params: Promise<{ id: string }> };

const INTEGRATION_COLUMNS =
  "id, clinic_id, provider, bot_api_key_prefix, webhook_url, webhook_secret, whatsapp_numbers, is_active";

function generateApiKey(clinicId: string) {
  const random = crypto.randomBytes(24).toString("base64url");
  const shortTag = clinicId.replace(/-/g, "").slice(0, 8);
  const fullKey = `mcp_bot_${shortTag}_${random}`;
  const keyHash = crypto.createHash("sha256").update(fullKey, "utf8").digest("hex");
  const keyPrefix = fullKey.slice(0, "mcp_bot_".length + 9);
  return { fullKey, keyHash, keyPrefix };
}

function generateWebhookSecret() {
  return crypto.randomBytes(32).toString("hex");
}

/** GET — حالة ربط N8N للعيادة (بدون المفتاح الكامل أبداً — فقط بادئته) */
export async function GET(request: NextRequest, { params }: Params) {
  const session = await requireDeveloperSession(request);
  if ("error" in session) {
    return NextResponse.json({ error: session.error }, { status: session.status });
  }

  const { id } = await params;
  const admin = getAdminClient();

  const { data: clinic } = await admin
    .from("clinics")
    .select("id, name, name_ar")
    .eq("id", id)
    .maybeSingle();

  if (!clinic) {
    return NextResponse.json({ error: "العيادة غير موجودة" }, { status: 404 });
  }

  const { data: integration } = await admin
    .from("clinic_integrations")
    .select(INTEGRATION_COLUMNS)
    .eq("clinic_id", id)
    .maybeSingle();

  return NextResponse.json({
    clinic: { id: clinic.id, name: clinic.name_ar || clinic.name },
    integration: integration ?? null,
  });
}

/** POST — توليد/تدوير مفتاح، تفعيل/تعطيل، أو تحديث webhook_url/الأرقام */
export async function POST(request: NextRequest, { params }: Params) {
  const session = await requireDeveloperSession(request);
  if ("error" in session) {
    return NextResponse.json({ error: session.error }, { status: session.status });
  }

  const { id } = await params;
  const admin = getAdminClient();

  const { data: clinic } = await admin
    .from("clinics")
    .select("id, name, name_ar")
    .eq("id", id)
    .maybeSingle();

  if (!clinic) {
    return NextResponse.json({ error: "العيادة غير موجودة" }, { status: 404 });
  }

  const body = (await request.json().catch(() => ({}))) as {
    action?: "generate" | "disable" | "update";
    webhook_url?: string | null;
    numbers?: string | null;
  };

  const { data: existing } = await admin
    .from("clinic_integrations")
    .select(INTEGRATION_COLUMNS)
    .eq("clinic_id", id)
    .maybeSingle();

  if (body.action === "disable") {
    if (!existing) {
      return NextResponse.json({ ok: true, message: "العيادة أصلاً على Evolution — لا حاجة للتعطيل" });
    }
    await admin
      .from("clinic_integrations")
      .update({ provider: "evolution" })
      .eq("id", existing.id);
    return NextResponse.json({ ok: true, message: "تم — رجعت العيادة لإرسال Evolution العادي" });
  }

  if (body.action === "update") {
    const numbers = (body.numbers ?? "")
      .split(",")
      .map((n) => n.trim())
      .filter(Boolean);
    const payload = {
      clinic_id: id,
      provider: existing?.provider ?? "evolution",
      webhook_url: body.webhook_url?.trim() || null,
      webhook_secret: existing?.webhook_secret ?? generateWebhookSecret(),
      whatsapp_numbers: numbers,
      is_active: true,
    };
    if (existing) {
      await admin.from("clinic_integrations").update(payload).eq("id", existing.id);
    } else {
      await admin.from("clinic_integrations").insert(payload);
    }
    return NextResponse.json({ ok: true, message: "تم حفظ إعدادات الربط" });
  }

  // action === "generate" (default) — يولّد مفتاحاً جديداً ويُفعّل n8n_bot تلقائياً
  const generated = generateApiKey(id);
  const numbers = (body.numbers ?? "")
    .split(",")
    .map((n) => n.trim())
    .filter(Boolean);

  const payload = {
    clinic_id: id,
    provider: "n8n_bot" as const,
    bot_api_key_hash: generated.keyHash,
    bot_api_key_prefix: generated.keyPrefix,
    webhook_url: body.webhook_url?.trim() || null,
    webhook_secret: existing?.webhook_secret ?? generateWebhookSecret(),
    whatsapp_numbers: numbers,
    is_active: true,
  };

  let row: { webhook_secret: string | null } | null = null;
  if (existing) {
    const { data } = await admin
      .from("clinic_integrations")
      .update(payload)
      .eq("id", existing.id)
      .select("webhook_secret")
      .maybeSingle();
    row = data;
  } else {
    const { data } = await admin
      .from("clinic_integrations")
      .insert(payload)
      .select("webhook_secret")
      .maybeSingle();
    row = data;
  }

  return NextResponse.json({
    ok: true,
    clinic_id: id,
    clinic_name: clinic.name_ar || clinic.name,
    api_key: generated.fullKey,
    webhook_secret: row?.webhook_secret ?? payload.webhook_secret,
    bot_api_key_prefix: generated.keyPrefix,
    webhook_url: payload.webhook_url,
    whatsapp_numbers: payload.whatsapp_numbers,
  });
}
