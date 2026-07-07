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

async function evo(base, key, p, init = {}) {
  const res = await fetch(`${base}${p}`, {
    ...init,
    headers: {
      apikey: key,
      ...(init.body ? { "Content-Type": "application/json" } : {}),
      ...(init.headers || {}),
    },
  });
  const text = await res.text();
  let data = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = { raw: text };
  }
  return { ok: res.ok, status: res.status, data, text };
}

const env = parseEnv(fs.readFileSync(envPath, "utf8"));
const base = (env.WHATSAPP_API_URL || "").replace(/\/$/, "");
const key = env.WHATSAPP_API_KEY || env.WHATSAPP_API_SECRET || "";
if (!base || !key) {
  console.log("MISSING_ENV");
  process.exit(1);
}

const home = await evo(base, key, "/");
console.log("HOME", home.status, JSON.stringify(home.data).slice(0, 400));

const instances = await evo(base, key, "/instance/fetchInstances");
const rows = Array.isArray(instances.data)
  ? instances.data
  : instances.data?.data || instances.data?.response || [];
console.log("INSTANCES", instances.status, "count", rows.length);
for (const row of rows) {
  console.log(
    " -",
    row?.name || row?.instanceName,
    "state=",
    row?.connectionStatus || row?.state,
    "phone=",
    row?.ownerJid || row?.number || row?.profileName || "?"
  );
}

const instance = rows[0]?.name || rows[0]?.instanceName || "mc_clinic_9186408c";
console.log("USING_INSTANCE", instance);

const state = await evo(
  base,
  key,
  `/instance/connectionState/${encodeURIComponent(instance)}`
);
console.log("STATE", state.status, JSON.stringify(state.data));

const connect = await evo(
  base,
  key,
  `/instance/connect/${encodeURIComponent(instance)}`
);
console.log("CONNECT", connect.status, JSON.stringify(connect.data).slice(0, 300));

const testNumber = "9647731002610";
const send = await evo(
  base,
  key,
  `/message/sendText/${encodeURIComponent(instance)}`,
  {
    method: "POST",
    body: JSON.stringify({
      number: testNumber,
      text: `Baileys diagnostic ${Date.now()}`,
    }),
  }
);
console.log("SEND", send.status, JSON.stringify(send.data).slice(0, 500));

const msgId = send.data?.key?.id;
const remoteJid = send.data?.key?.remoteJid || `${testNumber}@s.whatsapp.net`;
if (msgId) {
  await new Promise((r) => setTimeout(r, 5000));
  const status = await evo(
    base,
    key,
    `/chat/findStatusMessage/${encodeURIComponent(instance)}`,
    {
      method: "POST",
      body: JSON.stringify({
        where: { id: msgId, remoteJid, fromMe: true },
        limit: 1,
      }),
    }
  );
  console.log("MSG_STATUS_5S", status.status, JSON.stringify(status.data).slice(0, 400));
}

const numCheck = await evo(
  base,
  key,
  `/chat/whatsappNumbers/${encodeURIComponent(instance)}`,
  {
    method: "POST",
    body: JSON.stringify({ numbers: [testNumber] }),
  }
);
console.log("NUMBER_CHECK", numCheck.status, JSON.stringify(numCheck.data));
