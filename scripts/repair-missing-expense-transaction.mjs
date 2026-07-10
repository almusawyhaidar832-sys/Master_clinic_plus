#!/usr/bin/env node
/**
 * يبحث عن مصروفات (expenses) لا تملك حركة مالية مقابلة في transactions
 * (reference_type='expense') ويُنشئ الحركة الناقصة باستخدام clinic_id
 * المحفوظ فعلياً على صف المصروف نفسه (مصدر الحقيقة، لا الجلسة).
 *
 * الاستخدام:
 *   node scripts/repair-missing-expense-transaction.mjs           (فحص فقط)
 *   node scripts/repair-missing-expense-transaction.mjs --apply   (تنفيذ الإصلاح)
 */
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { randomUUID } from "crypto";
import { createClient } from "@supabase/supabase-js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(__dirname, "..");
const apply = process.argv.includes("--apply");

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

const env = parseEnvFile(fs.readFileSync(path.join(root, ".env.local"), "utf8"));
const url = env.get("NEXT_PUBLIC_SUPABASE_URL")?.trim();
const serviceKey = env.get("SUPABASE_SERVICE_ROLE_KEY")?.trim();

const admin = createClient(url, serviceKey, {
  auth: { persistSession: false, autoRefreshToken: false },
});

async function main() {
  const { data: expenses, error } = await admin
    .from("expenses")
    .select("id, clinic_id, description_ar, amount, expense_date, created_at")
    .order("created_at", { ascending: false })
    .limit(500);
  if (error) {
    console.error("خطأ جلب المصروفات:", error.message);
    process.exit(1);
  }

  const missing = [];
  for (const e of expenses ?? []) {
    const { data: tx } = await admin
      .from("transactions")
      .select("id")
      .eq("reference_type", "expense")
      .eq("reference_id", e.id)
      .maybeSingle();
    if (!tx) missing.push(e);
  }

  if (missing.length === 0) {
    console.log("لا توجد مصروفات بلا حركة مالية — كل شيء سليم.");
    return;
  }

  console.log(`عُثر على ${missing.length} مصروف بلا حركة مالية:\n`);
  for (const e of missing) {
    console.log(
      `  - ${e.created_at} | ${e.description_ar} | amount=${e.amount} | clinic_id=${e.clinic_id ?? "NULL"} | id=${e.id}`
    );
  }

  if (!e_clinic_ids_ok(missing)) {
    console.log(
      "\n⚠️  بعض المصروفات أعلاه بلا clinic_id — لن يتم إصلاحها تلقائياً (تحتاج مراجعة يدوية)."
    );
  }

  if (!apply) {
    console.log("\n(فحص فقط — أعد التشغيل مع --apply لإنشاء الحركات الناقصة)");
    return;
  }

  for (const e of missing) {
    if (!e.clinic_id) {
      console.log(`  ⏭️  تخطي ${e.id} — لا يملك clinic_id`);
      continue;
    }
    const { error: insErr } = await admin.from("transactions").insert({
      id: randomUUID(),
      clinic_id: e.clinic_id,
      doctor_id: null,
      patient_id: null,
      operation_id: null,
      amount: -Number(e.amount),
      type: "clinic_expense",
      description_ar: e.description_ar,
      transaction_date: e.expense_date,
      reference_type: "expense",
      reference_id: e.id,
    });
    if (insErr) {
      console.log(`  ❌ فشل إصلاح ${e.id}: ${insErr.message}`);
    } else {
      console.log(`  ✅ تم إنشاء الحركة الناقصة للمصروف ${e.id}`);
    }
  }
}

function e_clinic_ids_ok(list) {
  return list.every((e) => !!e.clinic_id);
}

main().catch((err) => {
  console.error("خطأ غير متوقع:", err);
  process.exit(1);
});
