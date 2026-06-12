#!/usr/bin/env node
/**
 * يقرأ .env.local وينشئ ملفاً جاهزاً لرفعه على Vercel (Import .env)
 * الاستخدام: node scripts/prepare-vercel-deploy.mjs
 */
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(__dirname, "..");
const envLocalPath = path.join(root, ".env.local");
const outDir = path.join(root, "deploy");
const outPath = path.join(outDir, "vercel-env-import.env");
const guidePath = path.join(outDir, "SUPABASE-AFTER-DEPLOY.txt");

const PRODUCTION_KEYS = [
  "NEXT_PUBLIC_SUPABASE_URL",
  "NEXT_PUBLIC_SUPABASE_ANON_KEY",
  "SUPABASE_SERVICE_ROLE_KEY",
  "ADMIN_EMAIL",
  "PLATFORM_DEVELOPER_SECRET",
  "PLATFORM_DEVELOPER_PASSWORD_HASH",
  "WHATSAPP_API_URL",
  "WHATSAPP_API_KEY",
  "WHATSAPP_INSTANCE_NAME",
  "WHATSAPP_PROVIDER",
  "NEXT_PUBLIC_VAPID_PUBLIC_KEY",
  "VAPID_PRIVATE_KEY",
  "VAPID_SUBJECT",
];

function parseEnvFile(content) {
  const map = new Map();
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
    map.set(key, value);
  }
  return map;
}

if (!fs.existsSync(envLocalPath)) {
  console.error("❌ ملف .env.local غير موجود — شغّل التطبيق محلياً أولاً.");
  process.exit(1);
}

const local = parseEnvFile(fs.readFileSync(envLocalPath, "utf8"));
fs.mkdirSync(outDir, { recursive: true });

const lines = [
  "# Master Clinic Plus — Production (Vercel)",
  "# Import this file: Vercel → Project → Settings → Environment Variables → Import .env",
  "# Do NOT commit this file to GitHub",
  "",
  "# NEXT_PUBLIC_APP_URL — اتركه فارغ على Vercel (يُكتشف تلقائياً من VERCEL_URL)",
  "# بعد النشر يمكنك وضع رابطك الدائم: https://your-app.vercel.app",
  "",
];

const missing = [];
for (const key of PRODUCTION_KEYS) {
  const value = local.get(key);
  if (!value) {
    if (
      key.startsWith("WHATSAPP_") ||
      key.startsWith("NEXT_PUBLIC_VAPID") ||
      key === "VAPID_PRIVATE_KEY" ||
      key === "VAPID_SUBJECT"
    ) {
      continue;
    }
    missing.push(key);
    continue;
  }
  lines.push(`${key}=${value}`);
}

if (missing.length) {
  console.warn("⚠️  ناقص في .env.local:", missing.join(", "));
}

fs.writeFileSync(outPath, lines.join("\n") + "\n", "utf8");

const supabaseGuide = `بعد أول Deploy على Vercel — انسخ رابط التطبيق (مثل https://xxx.vercel.app)

1) Supabase Dashboard → Authentication → URL Configuration
   Site URL = https://xxx.vercel.app

2) Redirect URLs — أضف:
   https://xxx.vercel.app/**
   http://localhost:3000/**

3) Deployments → Redeploy (اختياري بعد تغيير Supabase)

4) من موبايل الطبيب: افتح الرابط → ثبّت PWA → فعّل التنبيهات
`;

fs.writeFileSync(guidePath, supabaseGuide, "utf8");

console.log("");
console.log("✅ تم تجهيز ملف النشر:");
console.log("   ", outPath);
console.log("");
console.log("📋 الخطوات (مرة واحدة):");
console.log("   1) vercel.com → New Project → Import من GitHub");
console.log("   2) Settings → Environment Variables → Import .env");
console.log("      اختر الملف:", outPath);
console.log("   3) Deploy");
console.log("   4) اتبع:", guidePath);
console.log("");
