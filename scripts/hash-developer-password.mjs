/**
 * يولّد PLATFORM_DEVELOPER_PASSWORD_HASH لوضعه في .env.local
 *
 * الاستخدام:
 *   node scripts/hash-developer-password.mjs "كلمة-السر-الخاصة"
 *
 * يتطلب PLATFORM_DEVELOPER_SECRET في البيئة (نفس القيمة التي على السيرفر).
 */
import { scryptSync } from "crypto";

const password = process.argv[2];
const secret = process.env.PLATFORM_DEVELOPER_SECRET?.trim();

if (!password) {
  console.error("Usage: node scripts/hash-developer-password.mjs \"your-password\"");
  process.exit(1);
}
if (!secret || secret.length < 16) {
  console.error("Set PLATFORM_DEVELOPER_SECRET (16+ chars) in env before running.");
  process.exit(1);
}

const hash = scryptSync(password, secret, 64).toString("hex");
console.log("Add to .env.local:");
console.log(`PLATFORM_DEVELOPER_PASSWORD_HASH=${hash}`);
