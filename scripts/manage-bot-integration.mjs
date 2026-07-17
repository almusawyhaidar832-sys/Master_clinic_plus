#!/usr/bin/env node
/**
 * إدارة ربط N8N Bot لعيادة — توليد/تدوير مفتاح API، تفعيل/تعطيل، ضبط webhook.
 * لا يغيّر أي عيادة أخرى — كل شيء مقيّد بـ --clinic-id.
 *
 * أمثلة:
 *   node scripts/manage-bot-integration.mjs --clinic-id=UUID --status
 *
 *   node scripts/manage-bot-integration.mjs --clinic-id=UUID --enable \
 *     --webhook-url=https://n8n.example.com/webhook/clinic-events \
 *     --numbers=+9647801234567,+9647809876543
 *
 *   node scripts/manage-bot-integration.mjs --clinic-id=UUID --rotate-key
 *   node scripts/manage-bot-integration.mjs --clinic-id=UUID --disable
 */
import fs from "fs";
import path from "path";
import crypto from "crypto";
import { fileURLToPath } from "url";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const envPath = path.join(root, ".env.local");

function parseEnv(content) {
  const map = {};
  for (const line of content.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq <= 0) continue;
    const k = trimmed.slice(0, eq).trim();
    let v = trimmed.slice(eq + 1).trim();
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) {
      v = v.slice(1, -1);
    }
    map[k] = v;
  }
  return map;
}

if (!fs.existsSync(envPath)) {
  console.error("لم يتم العثور على .env.local في جذر المشروع");
  process.exit(1);
}

const env = parseEnv(fs.readFileSync(envPath, "utf8"));
const supabaseUrl = env.NEXT_PUBLIC_SUPABASE_URL;
const serviceKey = env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !serviceKey) {
  console.error("MISSING_SUPABASE_ENV — تأكد من NEXT_PUBLIC_SUPABASE_URL و SUPABASE_SERVICE_ROLE_KEY في .env.local");
  process.exit(1);
}

const args = Object.fromEntries(
  process.argv.slice(2).map((a) => {
    const [k, v] = a.replace(/^--/, "").split(/=(.*)/s);
    return [k, v ?? true];
  })
);

const clinicId = args["clinic-id"];
if (!clinicId) {
  console.error("مطلوب: --clinic-id=UUID");
  process.exit(1);
}

async function restFetch(method, tablePath, body) {
  const res = await fetch(`${supabaseUrl}/rest/v1/${tablePath}`, {
    method,
    headers: {
      apikey: serviceKey,
      Authorization: `Bearer ${serviceKey}`,
      "Content-Type": "application/json",
      Prefer: "return=representation",
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  if (!res.ok) {
    throw new Error(`${method} ${tablePath} -> HTTP ${res.status}: ${text}`);
  }
  return text ? JSON.parse(text) : null;
}

function generateApiKey(id) {
  const random = crypto.randomBytes(24).toString("base64url");
  const shortTag = id.replace(/-/g, "").slice(0, 8);
  const fullKey = `mcp_bot_${shortTag}_${random}`;
  const keyHash = crypto.createHash("sha256").update(fullKey, "utf8").digest("hex");
  const keyPrefix = fullKey.slice(0, "mcp_bot_".length + 9);
  return { fullKey, keyHash, keyPrefix };
}

function generateWebhookSecret() {
  return crypto.randomBytes(32).toString("hex");
}

async function fetchExisting() {
  const rows = await restFetch(
    "GET",
    `clinic_integrations?clinic_id=eq.${clinicId}&select=*`
  );
  return rows?.[0] ?? null;
}

async function main() {
  const existing = await fetchExisting();

  if (args.status) {
    if (!existing) {
      console.log("لا يوجد إعداد ربط لهذه العيادة — provider الافتراضي: evolution (بدون تغيير)");
      return;
    }
    console.log(
      JSON.stringify(
        {
          provider: existing.provider,
          is_active: existing.is_active,
          bot_api_key_prefix: existing.bot_api_key_prefix,
          webhook_url: existing.webhook_url,
          whatsapp_numbers: existing.whatsapp_numbers,
        },
        null,
        2
      )
    );
    return;
  }

  if (args.disable) {
    if (!existing) {
      console.log("لا يوجد إعداد لهذه العيادة أصلاً — لا حاجة للتعطيل");
      return;
    }
    await restFetch("PATCH", `clinic_integrations?id=eq.${existing.id}`, {
      provider: "evolution",
    });
    console.log("تم — العيادة رجعت لإرسال Evolution العادي (provider=evolution)، لم يتأثر شيء آخر");
    return;
  }

  const shouldRotate = Boolean(args["rotate-key"]) || !existing?.bot_api_key_hash;
  let fullKey = null;
  let keyHash = existing?.bot_api_key_hash ?? null;
  let keyPrefix = existing?.bot_api_key_prefix ?? null;

  if (shouldRotate) {
    const generated = generateApiKey(clinicId);
    fullKey = generated.fullKey;
    keyHash = generated.keyHash;
    keyPrefix = generated.keyPrefix;
  }

  const numbers = args.numbers
    ? String(args.numbers)
        .split(",")
        .map((n) => n.trim())
        .filter(Boolean)
    : existing?.whatsapp_numbers ?? [];

  const payload = {
    clinic_id: clinicId,
    provider: args.enable ? "n8n_bot" : existing?.provider ?? "evolution",
    bot_api_key_hash: keyHash,
    bot_api_key_prefix: keyPrefix,
    webhook_url: args["webhook-url"] ?? existing?.webhook_url ?? null,
    webhook_secret: args["webhook-secret"] ?? existing?.webhook_secret ?? generateWebhookSecret(),
    whatsapp_numbers: numbers,
    is_active: true,
  };

  if (existing) {
    await restFetch("PATCH", `clinic_integrations?id=eq.${existing.id}`, payload);
  } else {
    await restFetch("POST", "clinic_integrations", payload);
  }

  console.log("تم حفظ إعدادات الربط بنجاح.");
  console.log("clinic_id:      ", clinicId);
  console.log("provider:       ", payload.provider);
  console.log("webhook_url:    ", payload.webhook_url);
  console.log("webhook_secret: ", payload.webhook_secret, "(للتحقق من HMAC في N8N — احتفظ به)");
  console.log("whatsapp_numbers:", numbers);

  if (fullKey) {
    console.log("\n================ مفتاح API الجديد — يُعرض مرة واحدة فقط ================");
    console.log(fullKey);
    console.log("=========================================================================");
    console.log("أرسل هذا المفتاح لصديقك ليضعه في header: X-Bot-Api-Key");
  } else {
    console.log(`\nالمفتاح الحالي بدون تغيير (بادئة: ${keyPrefix}...) — استخدم --rotate-key لتوليد مفتاح جديد`);
  }

  if (payload.provider === "n8n_bot") {
    console.log(
      "\nتنبيه: هذه العيادة الآن تُرسل واتساب عبر N8N بدل Evolution. للتراجع: --disable"
    );
  }
}

main().catch((err) => {
  console.error("فشل:", err.message);
  process.exit(1);
});
