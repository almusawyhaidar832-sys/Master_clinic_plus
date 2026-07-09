#!/usr/bin/env node
/**
 * فحص حالة تأكيد صرف أجر يومي لمساعد معيّن — يقارن salary_entries،
 * payroll_records، وحركات transactions الفعلية لمعرفة أين ينقطع الخصم
 * الحقيقي عن الإشعار المرسل للطبيب.
 *
 * الاستخدام:
 *   node scripts/diagnose-assistant-entry-confirm.mjs --assistant "يسرى" --month 2026-07
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

function parseArgs(argv) {
  const out = { assistant: null, month: null };
  for (let i = 2; i < argv.length; i += 1) {
    const a = argv[i];
    if (a === "--assistant" && argv[i + 1]) out.assistant = argv[++i];
    else if (a === "--month" && argv[i + 1]) out.month = argv[++i];
  }
  return out;
}

const args = parseArgs(process.argv);
const envPath = path.join(root, ".env.local");
if (!fs.existsSync(envPath)) {
  console.error("❌ .env.local غير موجود");
  process.exit(1);
}
const env = parseEnvFile(fs.readFileSync(envPath, "utf8"));
const url = env.get("NEXT_PUBLIC_SUPABASE_URL")?.trim();
const serviceKey = env.get("SUPABASE_SERVICE_ROLE_KEY")?.trim();
if (!url || !serviceKey) {
  console.error("❌ لا يوجد NEXT_PUBLIC_SUPABASE_URL أو SUPABASE_SERVICE_ROLE_KEY في .env.local");
  process.exit(1);
}

const admin = createClient(url, serviceKey, {
  auth: { persistSession: false, autoRefreshToken: false },
});

async function main() {
  const assistantFilter = args.assistant ?? "";
  const monthYear = args.month ?? new Date().toISOString().slice(0, 7);

  let query = admin
    .from("assistants")
    .select("id, full_name_ar, clinic_id, doctor_id, compensation_mode, doctor_share_percentage, is_active");
  if (assistantFilter) query = query.ilike("full_name_ar", `%${assistantFilter}%`);

  const { data: assistants, error: aErr } = await query;
  if (aErr) {
    console.error("خطأ جلب المساعدين:", aErr.message);
    process.exit(1);
  }
  if (!assistants?.length) {
    console.log("لم يُعثر على مساعد مطابق للاسم:", assistantFilter);
    process.exit(0);
  }

  for (const asst of assistants) {
    console.log(`\n================ ${asst.full_name_ar} (${asst.id}) ================`);
    console.log(
      `clinic_id=${asst.clinic_id} doctor_id=${asst.doctor_id} mode=${asst.compensation_mode} doctor_pct=${asst.doctor_share_percentage} active=${asst.is_active}`
    );

    const { data: doctor } = await admin
      .from("doctors")
      .select("id, full_name_ar")
      .eq("id", asst.doctor_id)
      .maybeSingle();
    console.log(`الطبيب: ${doctor?.full_name_ar ?? "?"} (${asst.doctor_id})`);

    const { data: entries, error: eErr } = await admin
      .from("salary_entries")
      .select("id, entry_type, amount, entry_date, notes_ar")
      .eq("assistant_id", asst.id)
      .gte("entry_date", `${monthYear}-01`)
      .lte("entry_date", `${monthYear}-31`)
      .order("entry_date", { ascending: true });
    if (eErr) {
      console.log("خطأ جلب الحركات:", eErr.message);
      continue;
    }

    const { data: record } = await admin
      .from("payroll_records")
      .select("*")
      .eq("assistant_id", asst.id)
      .eq("month_year", monthYear)
      .maybeSingle();

    console.log("\n-- payroll_records --");
    if (!record) {
      console.log("  لا يوجد سجل راتب لهذا الشهر");
    } else {
      console.log(
        `  status=${record.status} total_salary=${record.total_salary} doctor_share=${record.doctor_share_amount} clinic_share=${record.clinic_share_amount} paid_doctor=${record.paid_doctor_share_amount} paid_clinic=${record.paid_clinic_share_amount} paid_total=${record.paid_total_salary}`
      );
    }

    const entryIds = (entries ?? []).map((e) => e.id);
    const { data: doctorTx } = await admin
      .from("transactions")
      .select("id, amount, type, reference_type, reference_id, transaction_date, created_at")
      .eq("clinic_id", asst.clinic_id)
      .in("type", ["assistant_payroll_doctor"])
      .order("created_at", { ascending: true });
    const { data: clinicTx } = await admin
      .from("transactions")
      .select("id, amount, type, reference_type, reference_id, transaction_date, created_at")
      .eq("clinic_id", asst.clinic_id)
      .in("type", ["assistant_payroll_clinic"])
      .order("created_at", { ascending: true });

    const relatedDoctorTx = (doctorTx ?? []).filter(
      (t) => entryIds.includes(t.reference_id) || String(t.reference_id).startsWith(`${record?.id}:`)
    );
    const relatedClinicTx = (clinicTx ?? []).filter(
      (t) => entryIds.includes(t.reference_id) || String(t.reference_id).startsWith(`${record?.id}:`)
    );

    console.log("\n-- حركات salary_entries مقابل transactions الفعلية --");
    for (const entry of entries ?? []) {
      const dTx = relatedDoctorTx.filter((t) => t.reference_id === entry.id);
      const cTx = relatedClinicTx.filter((t) => t.reference_id === entry.id);
      const dSum = dTx.reduce((s, t) => s + Number(t.amount), 0);
      const cSum = cTx.reduce((s, t) => s + Number(t.amount), 0);
      console.log(
        `  ${entry.entry_date} ${entry.entry_type} amount=${entry.amount} | tx_doctor=${dTx.length}(sum=${dSum}) tx_clinic=${cTx.length}(sum=${cSum}) ${entry.notes_ar ? `| notes=${entry.notes_ar}` : ""}`
      );
    }

    console.log("\n-- كل حركات assistant_payroll_doctor/clinic لهذه العيادة بآخر 3 أيام --");
    const cutoff = new Date(Date.now() - 3 * 24 * 3600 * 1000).toISOString();
    for (const t of [...(doctorTx ?? []), ...(clinicTx ?? [])]) {
      if (String(t.created_at) >= cutoff) {
        console.log(
          `  [${t.type}] amount=${t.amount} ref=${t.reference_type}:${t.reference_id} date=${t.transaction_date} created=${t.created_at}`
        );
      }
    }
  }
}

main().catch((err) => {
  console.error("خطأ غير متوقع:", err);
  process.exit(1);
});
