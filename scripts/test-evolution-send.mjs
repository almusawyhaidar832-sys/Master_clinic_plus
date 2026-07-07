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
const base = (env.WHATSAPP_API_URL || "").replace(/\/$/, "");
const key = env.WHATSAPP_API_KEY || env.WHATSAPP_API_SECRET || "";
const instance = env.WHATSAPP_INSTANCE_NAME || "master_clinic";

if (!base || !key) {
  console.log("MISSING_ENV", { hasUrl: Boolean(base), hasKey: Boolean(key) });
  process.exit(1);
}

const instancesRes = await fetch(`${base}/instance/fetchInstances`, {
  headers: { apikey: key },
});
const instancesText = await instancesRes.text();
let instances = [];
try {
  const data = JSON.parse(instancesText);
  instances = Array.isArray(data) ? data : data?.data || data?.response || [];
} catch {
  /* ignore */
}

console.log("INSTANCES_HTTP", instancesRes.status);
for (const row of instances) {
  const name = row?.name || row?.instanceName;
  const st = row?.connectionStatus || row?.state || row?.status;
  console.log("INSTANCE", name, st);
}

const target =
  instances.find((r) => (r?.name || r?.instanceName) === instance)?.name ||
  instances.find((r) => (r?.name || r?.instanceName) === instance)
    ?.instanceName ||
  instances[0]?.name ||
  instances[0]?.instanceName ||
  instance;

const stateRes = await fetch(
  `${base}/instance/connectionState/${encodeURIComponent(target)}`,
  { headers: { apikey: key } }
);
const stateJson = await stateRes.json().catch(() => ({}));
console.log("TARGET_INSTANCE", target);
console.log(
  "CONNECTION_STATE",
  stateRes.status,
  JSON.stringify(stateJson).slice(0, 300)
);

const sendRes = await fetch(
  `${base}/message/sendText/${encodeURIComponent(target)}`,
  {
    method: "POST",
    headers: { apikey: key, "Content-Type": "application/json" },
    body: JSON.stringify({
      number: "9647731002610",
      text: `اختبار مباشر من Cursor — ${new Date().toISOString()}`,
    }),
  }
);
const sendText = await sendRes.text();
console.log("SEND_HTTP", sendRes.status);
console.log("SEND_BODY", sendText.slice(0, 500));
