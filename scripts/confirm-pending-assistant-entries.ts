/**
 * ينفّذ فعلياً نفس منطق "تأكيد صرف" الحقيقي (بدون إعادة كتابته) على حركات
 * أجر يومي معلّقة (لا تحمل أي حركة transactions فعلية بعد) لمساعد محدد.
 *
 * الاستخدام:
 *   npx tsx scripts/confirm-pending-assistant-entries.ts --assistant <id> --month 2026-07 [--apply]
 */
import fs from "fs";
import path from "path";
import { createClient } from "@supabase/supabase-js";
import {
  isAssistantDailyEntryConfirmed,
  recordAssistantDailyEntryPaidTransaction,
} from "../src/lib/services/payroll-financial";
import {
  ensureAssistantPayrollRecordDraft,
  recomputeAssistantPayrollRecord,
} from "../src/lib/services/salary-entries-server";
import { assistantIsFullyPaid } from "../src/lib/services/payroll-paid-portions";
import type { PayrollRecord } from "../src/types";

function roundMoney(n: number): number {
  return Math.round(n * 100) / 100;
}

function parseEnvFile(content: string): Map<string, string> {
  const map = new Map<string, string>();
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

function parseArgs(argv: string[]) {
  const out: { assistant?: string; month?: string; apply: boolean } = {
    apply: false,
  };
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === "--assistant" && argv[i + 1]) out.assistant = argv[++i];
    else if (argv[i] === "--month" && argv[i + 1]) out.month = argv[++i];
    else if (argv[i] === "--apply") out.apply = true;
  }
  return out;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (!args.assistant || !args.month) {
    console.error("استخدم: --assistant <id> --month YYYY-MM [--apply]");
    process.exit(1);
  }

  const envPath = path.join(process.cwd(), ".env.local");
  const env = parseEnvFile(fs.readFileSync(envPath, "utf8"));
  const url = env.get("NEXT_PUBLIC_SUPABASE_URL")!;
  const serviceKey = env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const admin = createClient(url, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const assistantId = args.assistant;
  const monthYear = args.month;

  const { data: assistantRow, error: aErr } = await admin
    .from("assistants")
    .select("id, clinic_id, full_name_ar, doctor_share_percentage")
    .eq("id", assistantId)
    .maybeSingle();
  if (aErr || !assistantRow) {
    console.error("لم يُعثر على المساعد:", aErr?.message);
    process.exit(1);
  }
  const clinicId = assistantRow.clinic_id as string;

  const { data: entries, error: eErr } = await admin
    .from("salary_entries")
    .select("id, amount, entry_date, entry_type")
    .eq("assistant_id", assistantId)
    .eq("entry_type", "daily_wage")
    .gte("entry_date", `${monthYear}-01`)
    .lte("entry_date", `${monthYear}-31`)
    .order("entry_date", { ascending: true });
  if (eErr) {
    console.error("خطأ جلب الحركات:", eErr.message);
    process.exit(1);
  }

  console.log(
    `المساعد: ${assistantRow.full_name_ar} — نسبة الطبيب: ${assistantRow.doctor_share_percentage}% — ${args.apply ? "تنفيذ فعلي" : "معاينة فقط (بدون --apply)"}`
  );

  for (const entry of entries ?? []) {
    const alreadyConfirmed = await isAssistantDailyEntryConfirmed(
      admin,
      clinicId,
      entry.id
    );
    if (alreadyConfirmed) {
      console.log(`  [تخطّي] ${entry.entry_date} — مؤكَّدة مسبقاً`);
      continue;
    }

    console.log(`  [معلّقة] ${entry.entry_date} — amount=${entry.amount}`);
    if (!args.apply) continue;

    const ensured = await ensureAssistantPayrollRecordDraft(
      admin,
      clinicId,
      assistantId,
      monthYear
    );
    if (ensured.error && !ensured.record) {
      console.error(`    ❌ ${ensured.error}`);
      continue;
    }

    const { record: freshRecord, error: recomputeErr, dailyWage } =
      await recomputeAssistantPayrollRecord(admin, clinicId, assistantId, monthYear);
    if (recomputeErr && !freshRecord) {
      console.error(`    ❌ ${recomputeErr}`);
      continue;
    }
    if (!freshRecord) {
      console.error("    ❌ لا يوجد سجل راتب");
      continue;
    }

    const activeRecord = freshRecord as PayrollRecord;
    const doctorSharePct = Number(
      assistantRow.doctor_share_percentage ?? activeRecord.doctor_share_percentage ?? 0
    );

    const tx = await recordAssistantDailyEntryPaidTransaction(
      admin,
      clinicId,
      activeRecord,
      entry.id,
      Number(entry.amount ?? 0),
      doctorSharePct,
      String(assistantRow.full_name_ar ?? activeRecord.assistant_name_ar ?? "مساعد"),
      monthYear
    );

    if (!tx.ok) {
      console.error(`    ❌ تعذر التأكيد: ${tx.error}`);
      continue;
    }

    const newPaidDoctor = roundMoney(
      Number(activeRecord.paid_doctor_share_amount ?? 0) + (tx.doctorAmount ?? 0)
    );
    const newPaidClinic = roundMoney(
      Number(activeRecord.paid_clinic_share_amount ?? 0) + (tx.clinicAmount ?? 0)
    );
    const newPaidTotal = roundMoney(
      Number(activeRecord.paid_total_salary ?? 0) +
        (tx.doctorAmount ?? 0) +
        (tx.clinicAmount ?? 0)
    );

    const { error: updErr } = await admin
      .from("payroll_records")
      .update({
        paid_doctor_share_amount: newPaidDoctor,
        paid_clinic_share_amount: newPaidClinic,
        paid_total_salary: newPaidTotal,
        paid_at: new Date().toISOString(),
      })
      .eq("id", activeRecord.id);
    if (updErr) {
      console.error(`    ❌ فشل تحديث السجل: ${updErr.message}`);
      continue;
    }

    const resolvedRecord = {
      ...activeRecord,
      paid_doctor_share_amount: newPaidDoctor,
      paid_clinic_share_amount: newPaidClinic,
      paid_total_salary: newPaidTotal,
    } as PayrollRecord;
    const fullyPaid = assistantIsFullyPaid(resolvedRecord, {
      dailyWage: dailyWage ?? true,
      doctorSharePercentage: doctorSharePct,
    });

    await admin
      .from("payroll_records")
      .update({ status: fullyPaid ? "paid" : "generated" })
      .eq("id", activeRecord.id);

    console.log(
      `    ✅ تم — خصم من الطبيب=${tx.doctorAmount} خصم من العيادة=${tx.clinicAmount}`
    );
  }
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error("خطأ غير متوقع:", err);
    process.exit(1);
  });
