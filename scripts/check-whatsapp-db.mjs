import fs from "fs";
import path from "path";
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
    const key = trimmed.slice(0, eq).trim();
    let value = trimmed.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    map[key] = value;
  }
  return map;
}

const env = parseEnv(fs.readFileSync(envPath, "utf8"));
const url = env.NEXT_PUBLIC_SUPABASE_URL;
const key = env.SUPABASE_SERVICE_ROLE_KEY;

if (!url || !key) {
  console.log("MISSING_SUPABASE_ENV");
  process.exit(1);
}

async function q(table, select, order = "") {
  const res = await fetch(
    `${url}/rest/v1/${table}?select=${encodeURIComponent(select)}${order}`,
    {
      headers: {
        apikey: key,
        Authorization: `Bearer ${key}`,
      },
    }
  );
  return res.json();
}

const clinics = await q(
  "clinics",
  "id,name_ar,whatsapp_linked,whatsapp_session_id,whatsapp_instance_name"
);
console.log("CLINICS", JSON.stringify(clinics, null, 2));

const messages = await q(
  "whatsapp_messages",
  "id,clinic_id,message_type,status,recipient_phone,created_at,sent_at",
  "&clinic_id=eq.9186408c-ddca-447c-9107-879c2b73ee7a&order=created_at.desc&limit=50"
);
console.log("RECENT_MESSAGES", JSON.stringify(messages, null, 2));

const statusCounts = {};
for (const m of messages) {
  statusCounts[m.status] = (statusCounts[m.status] || 0) + 1;
}
console.log("MESSAGE_STATUS_COUNTS_LAST_15", statusCounts);
