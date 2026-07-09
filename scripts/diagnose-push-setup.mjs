#!/usr/bin/env node
/**
 * فحص إعداد VAPID محلياً + (اختياري) اشتراكات Push من Supabase
 *
 * الاستخدام:
 *   node scripts/diagnose-push-setup.mjs
 *   node scripts/diagnose-push-setup.mjs --doctor "أحمد"
 *   node scripts/diagnose-push-setup.mjs --profile-id <uuid>
 */
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { createClient } from "@supabase/supabase-js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(__dirname, "..");

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

function loadEnv() {
  const envPath = path.join(root, ".env.local");
  if (!fs.existsSync(envPath)) {
    console.error("❌ .env.local غير موجود");
    process.exit(1);
  }
  return parseEnvFile(fs.readFileSync(envPath, "utf8"));
}

function maskPublicKey(value) {
  if (!value) return "MISSING";
  if (value.length <= 18) return `${value.slice(0, 6)}...`;
  return `${value.slice(0, 12)}...${value.slice(-6)} (${value.length} chars)`;
}

function printVapidSection(label, env) {
  console.log(`\n=== ${label} ===`);
  const pub = env.get("NEXT_PUBLIC_VAPID_PUBLIC_KEY")?.trim() ?? "";
  const priv = env.get("VAPID_PRIVATE_KEY")?.trim() ?? "";
  const subject = env.get("VAPID_SUBJECT")?.trim() ?? "";

  console.log(`NEXT_PUBLIC_VAPID_PUBLIC_KEY: ${maskPublicKey(pub)}`);
  console.log(
    `VAPID_PRIVATE_KEY: ${priv ? `set (${priv.length} chars)` : "MISSING"}`
  );
  console.log(`VAPID_SUBJECT: ${subject || "MISSING (fallback: mailto:support@masterclinic.local)"}`);

  const ok = Boolean(pub && priv);
  console.log(ok ? "✅ VAPID جاهز محلياً" : "❌ VAPID ناقص — شغّل: node scripts/generate-vapid-keys.mjs");
  return ok;
}

async function diagnoseSupabase(env, args) {
  const url = env.get("NEXT_PUBLIC_SUPABASE_URL")?.trim();
  const serviceKey = env.get("SUPABASE_SERVICE_ROLE_KEY")?.trim();
  if (!url || !serviceKey) {
    console.log("\n⚠️  Supabase service key غير موجود في .env.local — تخطّي فحص قاعدة البيانات");
    return;
  }

  const admin = createClient(url, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  console.log("\n=== Supabase: جدول push_subscriptions ===");
  const { count: tableCount, error: tableErr } = await admin
    .from("push_subscriptions")
    .select("id", { count: "exact", head: true });

  if (tableErr) {
    if (tableErr.message.includes("push_subscriptions")) {
      console.log("❌ الجدول غير موجود — شغّل supabase/scripts/40-push-subscriptions.sql");
    } else {
      console.log("❌ خطأ:", tableErr.message);
    }
    return;
  }
  console.log(`✅ الجدول موجود — إجمالي الاشتراكات: ${tableCount ?? 0}`);

  const doctorArg = args.doctor;
  const profileIdArg = args.profileId;

  let doctorsQuery = admin
    .from("doctors")
    .select("id, clinic_id, full_name_ar, phone, profile_id, is_active")
    .eq("is_active", true);

  if (profileIdArg) {
    doctorsQuery = doctorsQuery.eq("profile_id", profileIdArg);
  } else if (doctorArg) {
    doctorsQuery = doctorsQuery.ilike("full_name_ar", `%${doctorArg}%`);
  }

  const { data: doctors, error: docErr } = await doctorsQuery.limit(20);
  if (docErr) {
    console.log("❌ خطأ أطباء:", docErr.message);
    return;
  }

  if (!doctors?.length) {
    console.log("⚠️  لم يُعثر على أطباء مطابقين — أضف --doctor \"الاسم\" أو --profile-id <uuid>");
    return;
  }

  console.log(`\n=== أطباء مطابقون (${doctors.length}) ===`);
  for (const doc of doctors) {
    const profileId = doc.profile_id;
    const linkStatus = profileId ? "✅ مربوط" : "❌ غير مربوط بـ profile";
    console.log(`\n• ${doc.full_name_ar} (${doc.id})`);
    console.log(`  profile_id: ${profileId ?? "NULL"} — ${linkStatus}`);

    if (!profileId) {
      console.log("  ⚠️  لن تصل إشعارات Push حتى يُربط doctors.profile_id");
      continue;
    }

    const { data: profile } = await admin
      .from("profiles")
      .select("id, full_name, role, phone")
      .eq("id", profileId)
      .maybeSingle();

    if (profile) {
      console.log(`  حساب الدخول: ${profile.full_name} — role=${profile.role}`);
    } else {
      console.log("  ⚠️  profile_id يشير لحساب غير موجود");
    }

    const { data: subs, error: subErr } = await admin
      .from("push_subscriptions")
      .select("id, endpoint, user_agent, updated_at")
      .eq("profile_id", profileId)
      .order("updated_at", { ascending: false });

    if (subErr) {
      console.log("  ❌ خطأ اشتراكات:", subErr.message);
      continue;
    }

    if (!subs?.length) {
      console.log("  ❌ لا يوجد اشتراك Push — الطبيب لم يفعّل التنبيهات من موبايله");
      continue;
    }

    console.log(`  ✅ اشتراكات Push: ${subs.length}`);
    subs.forEach((sub, i) => {
      const endpoint = String(sub.endpoint ?? "");
      const shortEndpoint =
        endpoint.length > 70 ? `${endpoint.slice(0, 50)}...${endpoint.slice(-15)}` : endpoint;
      const ua = String(sub.user_agent ?? "unknown").slice(0, 80);
      console.log(`    ${i + 1}. ${shortEndpoint}`);
      console.log(`       UA: ${ua}`);
      console.log(`       updated: ${sub.updated_at ?? "?"}`);
    });
  }
}

function parseArgs(argv) {
  const out = { doctor: null, profileId: null };
  for (let i = 2; i < argv.length; i += 1) {
    const a = argv[i];
    if (a === "--doctor" && argv[i + 1]) {
      out.doctor = argv[++i];
    } else if (a === "--profile-id" && argv[i + 1]) {
      out.profileId = argv[++i];
    }
  }
  return out;
}

const args = parseArgs(process.argv);
const local = loadEnv();

console.log("Master Clinic Plus — Push diagnostics");
printVapidSection(".env.local", local);

const deployPath = path.join(root, "deploy", "vercel-env-import.env");
if (fs.existsSync(deployPath)) {
  const deploy = parseEnvFile(fs.readFileSync(deployPath, "utf8"));
  printVapidSection("deploy/vercel-env-import.env (للرفع على Vercel)", deploy);
} else {
  console.log("\n⚠️  deploy/vercel-env-import.env غير موجود — شغّل: node scripts/prepare-vercel-deploy.mjs");
}

await diagnoseSupabase(local, args);

console.log("\n=== خطوات Vercel (يدوياً) ===");
console.log("1. Vercel → Project → Settings → Environment Variables");
console.log("2. تأكد من وجود: NEXT_PUBLIC_VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY, VAPID_SUBJECT");
console.log("3. Production + Preview — ثم Redeploy");
console.log("4. من موبايل الطبيب: ثبّت PWA → فعّل التنبيهات → جرّب Push من /doctor/notifications");
