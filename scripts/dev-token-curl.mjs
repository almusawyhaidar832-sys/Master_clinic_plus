import { readFileSync } from "fs";

for (const line of readFileSync(".env.local", "utf8").split(/\r?\n/)) {
  const i = line.indexOf("=");
  if (i > 0 && !line.trimStart().startsWith("#")) {
    let v = line.slice(i + 1).trim();
    if (
      (v.startsWith('"') && v.endsWith('"')) ||
      (v.startsWith("'") && v.endsWith("'"))
    ) {
      v = v.slice(1, -1);
    }
    process.env[line.slice(0, i).trim()] = v;
  }
}

const secret = process.env.PLATFORM_DEVELOPER_SECRET;
const email = process.env.ADMIN_EMAIL?.toLowerCase();
const body = {
  email,
  exp: Date.now() + 86400000,
  actingClinicId: null,
};
const data = Buffer.from(JSON.stringify(body)).toString("base64url");
const enc = new TextEncoder();
const key = await crypto.subtle.importKey(
  "raw",
  enc.encode(secret),
  { name: "HMAC", hash: "SHA-256" },
  false,
  ["sign"]
);
const sigBuf = await crypto.subtle.sign("HMAC", key, enc.encode(data));
const sig = Buffer.from(sigBuf).toString("base64url");
const token = `${data}.${sig}`;
const port = process.argv[2] || "3000";

for (const path of ["/api/developer/stats", "/api/developer/clinics"]) {
  const res = await fetch(`http://localhost:${port}${path}`, {
    headers: { Cookie: `mcp_platform_developer=${token}` },
  });
  const text = await res.text();
  console.log(path, res.status, text.slice(0, 300));
}
