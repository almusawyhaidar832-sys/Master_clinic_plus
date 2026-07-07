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

const home = await evo(base, key, "/");
console.log("API", home.status, home.data?.version, home.data?.whatsappWebVersion);

const list = await evo(base, key, "/instance/fetchInstances");
const rows = Array.isArray(list.data)
  ? list.data
  : list.data?.data || list.data?.response || [];
console.log("INSTANCES", rows.length);
for (const row of rows) {
  console.log(
    " -",
    row?.name || row?.instanceName,
    row?.connectionStatus || row?.state,
    row?.ownerJid || row?.number || ""
  );
}

const instance = rows[0]?.name || rows[0]?.instanceName || "mc_clinic_9186408c";
const state = await evo(
  base,
  key,
  `/instance/connectionState/${encodeURIComponent(instance)}`
);
console.log("STATE", state.status, JSON.stringify(state.data));
