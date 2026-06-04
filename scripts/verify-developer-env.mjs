import { readFileSync } from "fs";
import { scryptSync, timingSafeEqual } from "crypto";

for (const line of readFileSync(".env.local", "utf8").split(/\r?\n/)) {
  const i = line.indexOf("=");
  if (i > 0 && !line.trimStart().startsWith("#")) {
    process.env[line.slice(0, i).trim()] = line.slice(i + 1).trim();
  }
}

const email = (process.env.ADMIN_EMAIL || "").trim().toLowerCase();
const secret = (process.env.PLATFORM_DEVELOPER_SECRET || "").trim();
const hash = (process.env.PLATFORM_DEVELOPER_PASSWORD_HASH || "").trim();
const pwd = process.argv[2] || "DevAdmin123!";

const computed = scryptSync(pwd, secret, 64);
const expected = Buffer.from(hash, "hex");
const passOk = computed.length === expected.length && timingSafeEqual(computed, expected);

console.log("ADMIN_EMAIL:", email);
console.log("SECRET length:", secret.length);
console.log("Password OK for", pwd, ":", passOk);
