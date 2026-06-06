/**
 * معاينة نص رسالة الواتساب للمراجع — بدون إرسال فعلي.
 * الاستخدام:
 *   node scripts/preview-whatsapp-message.mjs
 *   OPERATION_ID=uuid CASE_ID=uuid node scripts/preview-whatsapp-message.mjs
 */

import { readFileSync, existsSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";
import { createClient } from "@supabase/supabase-js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, "..");

function loadEnvLocal() {
  const envPath = resolve(root, ".env.local");
  if (!existsSync(envPath)) return;
  for (const line of readFileSync(envPath, "utf8").split("\n")) {
    const t = line.trim();
    if (!t || t.startsWith("#")) continue;
    const i = t.indexOf("=");
    if (i < 0) continue;
    const key = t.slice(0, i).trim();
    let val = t.slice(i + 1).trim();
    if (
      (val.startsWith('"') && val.endsWith('"')) ||
      (val.startsWith("'") && val.endsWith("'"))
    ) {
      val = val.slice(1, -1);
    }
    if (!process.env[key]) process.env[key] = val;
  }
}

function formatCurrency(n) {
  const v = Math.max(0, Number(n) || 0);
  return `${v.toLocaleString("ar-IQ")} د.ع`;
}

function num(v) {
  const n = Number(v ?? 0);
  return Number.isFinite(n) ? n : 0;
}

function isChartFile(fileName) {
  return /chart|fdi|مخطط|أسنان|dental/i.test(String(fileName ?? ""));
}

function isXrayImageFile(fileName, mimeType) {
  const name = String(fileName ?? "").toLowerCase();
  const mime = String(mimeType ?? "");
  if (mime === "application/pdf" || name.endsWith(".pdf")) return false;
  return mime.startsWith("image/") || /\.(jpe?g|png|webp)$/i.test(name);
}

function buildPatientNotificationBody(currentCase, params) {
  const paid = formatCurrency(currentCase.paid_this_session);
  const remaining = formatCurrency(currentCase.remaining_balance);

  let message = `🏥 *${params.clinicName}*

أهلاً بك يا *${params.patientName}*،

📋 *تفاصيل زيارتك:*

👤 *اسم المراجع:* ${params.patientName}
🦷 *الإجراء:* ${currentCase.treatment_name_ar}
💰 *المبلغ المدفوع (هذه الجلسة):* ${paid}
📊 *الذمة المتبقية الكلية:* ${remaining}
👨‍⚕️ *الطبيب المشرف:* ${params.doctorName}`;

  if (currentCase.notes) {
    message += `\n📝 *الملاحظات:*\n${currentCase.notes}`;
  }
  if (currentCase.xrays_url) {
    message += `\n🩻 *الأشعة:* ${currentCase.xrays_url}`;
  }
  if (currentCase.fdi_chart_url) {
    message += `\n🦷 *المخطط:* ${currentCase.fdi_chart_url}`;
  }

  message += `\n\nنحن نهتم لأدق التفاصيل في علاجك، ونتمنى لك دوام الصحة والشفاء العاجل.

مع تحيات فريق *${params.clinicName}* الطبي.`;

  return message;
}

async function fetchCurrentCaseFromDb(supabase, caseId, operationId) {
  const { data: currentCase, error: caseErr } = await supabase
    .from("patient_treatment_cases")
    .select(
      "id, treatment_name_ar, final_price, case_price, discount_total, total_paid"
    )
    .eq("id", caseId)
    .single();

  if (caseErr || !currentCase) throw new Error(caseErr?.message ?? "case not found");

  const { data: sessionsRaw } = await supabase
    .from("patient_operations")
    .select("id, paid_amount, notes, created_at")
    .eq("treatment_case_id", caseId)
    .order("created_at", { ascending: true });

  const sessions = (sessionsRaw ?? []).map((row) => ({
    id: String(row.id),
    paid_amount: num(row.paid_amount),
    notes: row.notes ?? null,
  }));

  const allOpIds = [
    ...new Set([
      ...sessions.map((s) => s.id),
      ...(operationId ? [operationId] : []),
    ]),
  ];

  const noteLines = [];
  if (allOpIds.length) {
    const { data: teeth } = await supabase
      .from("operation_tooth_records")
      .select("tooth_number, procedure_ar, note")
      .in("operation_id", allOpIds)
      .order("tooth_number", { ascending: true });

    for (const r of teeth ?? []) {
      const note = String(r.note ?? "").trim();
      const proc = String(r.procedure_ar ?? "").trim();
      if (note && proc) noteLines.push(`سن ${r.tooth_number}: ${proc} — ${note}`);
      else if (note) noteLines.push(`سن ${r.tooth_number}: ${note}`);
      else if (proc) noteLines.push(`سن ${r.tooth_number}: ${proc}`);
    }
  }

  let fdi_chart_url = null;
  let xrays_url = null;

  if (allOpIds.length) {
    const { data: xrayRows } = await supabase
      .from("operation_xray_images")
      .select("storage_path, file_name, mime_type, created_at")
      .in("operation_id", allOpIds)
      .order("created_at", { ascending: false });

    for (const row of xrayRows ?? []) {
      const path = String(row.storage_path ?? "").trim();
      if (!path) continue;
      const fileName = String(row.file_name ?? "");
      const mimeType = String(row.mime_type ?? "");

      if (!fdi_chart_url && isChartFile(fileName)) {
        const { data } = await supabase.storage
          .from("clinical-xrays")
          .createSignedUrl(path, 86400);
        fdi_chart_url = data?.signedUrl ?? `[mock-fdi:${path}]`;
      } else if (!xrays_url && isXrayImageFile(fileName, mimeType)) {
        const { data } = await supabase.storage
          .from("clinical-xrays")
          .createSignedUrl(path, 86400);
        xrays_url = data?.signedUrl ?? `[mock-xray:${path}]`;
      }
    }
  }

  const total_price =
    num(currentCase.final_price) ||
    Math.max(0, num(currentCase.case_price) - num(currentCase.discount_total));
  const paidSum = sessions.reduce((s, x) => s + x.paid_amount, 0);
  const remaining_balance = Math.max(0, total_price - paidSum);

  let paid_this_session = 0;
  if (operationId) {
    const { data: opRow } = await supabase
      .from("patient_operations")
      .select("paid_amount")
      .eq("id", operationId)
      .maybeSingle();
    paid_this_session = num(opRow?.paid_amount);
  }

  return {
    treatment_name_ar:
      String(currentCase.treatment_name_ar ?? "علاج").trim() || "علاج",
    notes: noteLines.length ? noteLines.join("\n") : null,
    fdi_chart_url,
    xrays_url,
    remaining_balance,
    paid_this_session,
    total_price,
    paidSum,
  };
}

function mockCase() {
  return {
    treatment_name_ar: "حشوة ضوئية",
    notes: "سن 16: حشوة — يحتاج متابعة بعد أسبوع",
    fdi_chart_url: "https://example.supabase.co/storage/v1/fdi-chart-demo.png",
    xrays_url: "https://example.supabase.co/storage/v1/xray-demo.jpg",
    paid_this_session: 50000,
    remaining_balance: 150000,
    total_price: 200000,
    paidSum: 50000,
  };
}

async function main() {
  loadEnvLocal();

  const operationId = process.env.OPERATION_ID?.trim();
  const caseId = process.env.CASE_ID?.trim();
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;

  let currentCase;
  let patientName = "محمد أحمد";
  let doctorName = "د. علي حسن";
  let clinicName = "عيادة علي";

  if (operationId && caseId && url && key) {
    const supabase = createClient(url, key);
    currentCase = await fetchCurrentCaseFromDb(supabase, caseId, operationId);

    const { data: op } = await supabase
      .from("patient_operations")
      .select("clinic_id, patient_id, doctor_id")
      .eq("id", operationId)
      .maybeSingle();

    if (op) {
      const [{ data: patient }, { data: doctor }, { data: clinic }] =
        await Promise.all([
          supabase
            .from("patients")
            .select("full_name_ar")
            .eq("id", op.patient_id)
            .maybeSingle(),
          supabase
            .from("doctors")
            .select("full_name_ar")
            .eq("id", op.doctor_id)
            .maybeSingle(),
          supabase
            .from("clinics")
            .select("name, name_ar")
            .eq("id", op.clinic_id)
            .maybeSingle(),
        ]);
      patientName = patient?.full_name_ar ?? patientName;
      doctorName = doctor?.full_name_ar ?? doctorName;
      clinicName = clinic?.name_ar?.trim() || clinic?.name?.trim() || clinicName;
    }

    console.log("[preview] بيانات من Supabase:");
    console.log(`  total_price=${currentCase.total_price} paidSum=${currentCase.paidSum} remaining=${currentCase.remaining_balance}`);
  } else {
    console.log("[preview] لا توجد OPERATION_ID/CASE_ID — استخدام بيانات تجريبية");
    currentCase = mockCase();
  }

  const patientBody = buildPatientNotificationBody(currentCase, {
    patientName,
    doctorName,
    clinicName,
  });

  console.log("\n========== هذا هو نص الرسالة الذي سيصل للمراجع ==========\n");
  console.log(patientBody);
  console.log("\n==========================================================\n");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
