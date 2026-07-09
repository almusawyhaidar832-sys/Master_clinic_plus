#!/usr/bin/env node
/**
 * إصلاح انحراف payroll_records.paid_doctor_share_amount /
 * paid_clinic_share_amount / paid_total_salary عن الحقيقة الفعلية
 * المخزّنة بجدول transactions (المصدر الوحيد الموثوق).
 *
 * السبب: هذه الأعمدة كانت "عدّاد" يُزاد برمجياً عند كل تأكيد، لا يُعاد
 * حسابه من transactions أبداً — فأي علّة سابقة (خصم مضاعف، تأكيد نقرتين
 * بالتسابق، إلغاء لم يُسجَّل بشكل صحيح) تترك انحرافاً دائماً حتى بعد
 * إصلاح الكود المسبِّب.
 *
 * الاستخدام:
 *   node scripts/repair-assistant-payroll-paid-drift.mjs           (تقرير فقط)
 *   node scripts/repair-assistant-payroll-paid-drift.mjs --apply   (يطبّق الإصلاح)
 */
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { createClient } from "@supabase/supabase-js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(__dirname, "..");
const APPLY = process.argv.includes("--apply");

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

const envPath = path.join(root, ".env.local");
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

function round(n) {
  return Math.round(n * 100) / 100;
}

async function main() {
  const { data: records, error: recErr } = await admin
    .from("payroll_records")
    .select("id, clinic_id, assistant_id, assistant_name_ar, month_year, paid_doctor_share_amount, paid_clinic_share_amount, paid_total_salary, total_salary, doctor_share_amount, clinic_share_amount, status");
  if (recErr) {
    console.error("خطأ جلب payroll_records:", recErr.message);
    process.exit(1);
  }

  console.log(`عدد سجلات الرواتب: ${records.length}\n`);

  let driftCount = 0;
  for (const record of records) {
    // الحركات المرتبطة بهذا السجل عبر:
    //  1) تأكيد كل حركة أجر يومي على حدة  (reference_id = entry.id)
    //  2) تأكيد "الدفعة الواحدة" القديم   (reference_id = record.id[:from:x:y])
    //  3) تصحيحات الحذف/التعديل           (reference_type = payroll_entry_adjustment*)
    const { data: doctorTx, error: dErr } = await admin
      .from("transactions")
      .select("amount, reference_type, reference_id")
      .eq("clinic_id", record.clinic_id)
      .eq("type", "assistant_payroll_doctor");
    const { data: clinicTx, error: cErr } = await admin
      .from("transactions")
      .select("amount, reference_type, reference_id")
      .eq("clinic_id", record.clinic_id)
      .eq("type", "assistant_payroll_clinic");
    if (dErr || cErr) {
      console.log(`  ⚠️  ${record.assistant_name_ar} ${record.month_year}: خطأ جلب حركات`, dErr?.message ?? cErr?.message);
      continue;
    }

    const { data: entries } = await admin
      .from("salary_entries")
      .select("id")
      .eq("assistant_id", record.assistant_id)
      .gte("entry_date", `${record.month_year}-01`)
      .lte("entry_date", `${record.month_year}-31`);
    const entryIds = new Set((entries ?? []).map((e) => e.id));

    const belongsToRecord = (ref) => {
      const r = String(ref ?? "");
      if (entryIds.has(r)) return true; // تأكيد حركة يومية مفردة
      if (r === record.id || r.startsWith(`${record.id}:`)) return true; // دفعة واحدة قديمة
      return false;
    };

    const realDoctorSum = round(
      (doctorTx ?? [])
        .filter((t) => belongsToRecord(t.reference_id))
        .reduce((s, t) => s + Number(t.amount), 0)
    );
    const realClinicSum = round(
      (clinicTx ?? [])
        .filter((t) => belongsToRecord(t.reference_id))
        .reduce((s, t) => s + Number(t.amount), 0)
    );
    // المبالغ في transactions مسجّلة سالبة (خصم) أو موجبة (تصحيح/استرجاع) —
    // paid_* يجب أن يساوي صافي الخصم الفعلي = -(صافي المجموع الموجب+السالب)
    const realPaidDoctor = round(Math.max(0, -realDoctorSum));
    const realPaidClinic = round(Math.max(0, -realClinicSum));
    const realPaidTotal = round(realPaidDoctor + realPaidClinic);

    const storedPaidDoctor = round(Number(record.paid_doctor_share_amount ?? 0));
    const storedPaidClinic = round(Number(record.paid_clinic_share_amount ?? 0));
    const storedPaidTotal = round(Number(record.paid_total_salary ?? 0));

    const driftDoctor = round(storedPaidDoctor - realPaidDoctor);
    const driftClinic = round(storedPaidClinic - realPaidClinic);
    const driftTotal = round(storedPaidTotal - realPaidTotal);

    if (Math.abs(driftDoctor) > 0.5 || Math.abs(driftClinic) > 0.5 || Math.abs(driftTotal) > 0.5) {
      driftCount += 1;
      console.log(
        `⚠️  ${record.assistant_name_ar} — ${record.month_year} (record ${record.id})`
      );
      console.log(
        `    مخزَّن: doctor=${storedPaidDoctor} clinic=${storedPaidClinic} total=${storedPaidTotal}`
      );
      console.log(
        `    حقيقي:  doctor=${realPaidDoctor} clinic=${realPaidClinic} total=${realPaidTotal}`
      );
      console.log(
        `    انحراف: doctor=${driftDoctor} clinic=${driftClinic} total=${driftTotal}`
      );

      if (APPLY) {
        const { error: updErr } = await admin
          .from("payroll_records")
          .update({
            paid_doctor_share_amount: realPaidDoctor,
            paid_clinic_share_amount: realPaidClinic,
            paid_total_salary: realPaidTotal,
          })
          .eq("id", record.id);
        if (updErr) {
          console.log(`    ❌ فشل التصحيح: ${updErr.message}`);
        } else {
          console.log(`    ✅ تم التصحيح`);
        }
      }
    }
  }

  console.log(`\nإجمالي السجلات المنحرفة: ${driftCount}`);
  if (!APPLY && driftCount > 0) {
    console.log("هذا تقرير فقط — أعد التشغيل مع --apply لتطبيق التصحيح.");
  }
}

main().catch((err) => {
  console.error("خطأ غير متوقع:", err);
  process.exit(1);
});
