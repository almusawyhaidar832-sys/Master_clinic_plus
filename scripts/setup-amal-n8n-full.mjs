#!/usr/bin/env node
/**
 * إعداد كامل لربط عيادة الامل — DB + ملف n8n جاهز للصديق.
 *
 *   node scripts/setup-amal-n8n-full.mjs
 *   node scripts/setup-amal-n8n-full.mjs --n8n-webhook-url=https://xxx/webhook/appointment-events
 */
import fs from "fs";
import path from "path";
import { spawnSync } from "child_process";
import { fileURLToPath } from "url";

const AMAL_CLINIC_ID = "95e3ebda-a694-4d5b-8731-e946fb78f172";
const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const uploads = path.join(root, "uploads");

const sourceWorkflow =
  process.env.N8N_SOURCE_WORKFLOW ||
  "C:\\Users\\a\\.cursor\\projects\\c-Users-a-Projects-Master-clinic-plus\\uploads\\c__Users_a_AppData_Local_Packages_5319275A.WhatsAppDesktop_cv1g1gvanyjgm_LocalState_sessions_944D821E4BCA945B32DE094B4FB8A92459C04688_transfers_2026-30_2_5411457672526474740-L1-L1420-0.json";

const args = Object.fromEntries(
  process.argv.slice(2).map((a) => {
    const [k, v] = a.replace(/^--/, "").split(/=(.*)/s);
    return [k, v ?? true];
  })
);

const n8nWebhookUrl = args["n8n-webhook-url"] ? String(args["n8n-webhook-url"]).trim() : null;
const n8nBaseUrl = args["n8n-base-url"] ? String(args["n8n-base-url"]).replace(/\/$/, "") : null;
const webhookUrl =
  n8nWebhookUrl ||
  (n8nBaseUrl ? `${n8nBaseUrl}/webhook/appointment-events` : null);

const numbers = "07731002610,+9647731002610";
const outputWorkflow = path.join(uploads, "n8n_عيادة_الامل_جاهز.json");
const friendMsg = path.join(uploads, "صديقي_استورد_فقط.txt");
const userMsg = path.join(uploads, "لك_الويبهوك_والإعداد.txt");

if (!fs.existsSync(sourceWorkflow)) {
  console.error("ملف الوركفلو المصدر غير موجود:", sourceWorkflow);
  process.exit(1);
}

function runNode(script, scriptArgs) {
  const res = spawnSync(process.execPath, [script, ...scriptArgs], {
    cwd: root,
    encoding: "utf8",
  });
  if (res.status !== 0) {
    console.error(res.stderr || res.stdout);
    process.exit(res.status || 1);
  }
  return res.stdout;
}

// 1) تفعيل + رقم + مفتاح جديد + webhook_url إن وُجد
const manageArgs = [
  "scripts/manage-bot-integration.mjs",
  `--clinic-id=${AMAL_CLINIC_ID}`,
  "--enable",
  `--numbers=${numbers}`,
  "--rotate-key",
];
if (webhookUrl) manageArgs.push(`--webhook-url=${webhookUrl}`);

const manageOut = runNode(manageArgs[0], manageArgs.slice(1));

const apiKeyMatch = manageOut.match(/(mcp_bot_[^\s]+)/);
const secretMatch = manageOut.match(/webhook_secret:\s+([a-f0-9]{64})/i);
const apiKey = apiKeyMatch?.[1];
const webhookSecret = secretMatch?.[1];

if (!apiKey || !webhookSecret) {
  console.error("تعذّر استخراج المفتاح أو webhook_secret من مخرجات السكربت");
  console.log(manageOut);
  process.exit(1);
}

// 2) بناء وركفلو n8n — مفاتيح مدمجة (صديقك ما يحتاج Variables)
runNode("scripts/patch-n8n-workflow-amal.mjs", [
  sourceWorkflow,
  outputWorkflow,
  `--embed-api-key=${apiKey}`,
  `--embed-webhook-secret=${webhookSecret}`,
]);

// 3) رسالة للصديق — خطوتين فقط
fs.writeFileSync(
  friendMsg,
  `مرحباً — كل الربط جاهز داخل الملف. ما تحتاج تدخل مفاتيح يدوياً.

1) Workflows → Import from File → n8n_عيادة_الامل_جاهز.json
2) تأكد credentials WasenderAPI + Gemini → فعّل Active = ON
3) افتح عقدة "Appointment Events Webhook" → انسخ Production URL → أرسله لي

⚠️ لا تحذف عقدة Inquiry Assistant
⚠️ لا تحتاج Settings → Variables — المفاتيح مدمجة بالملف

Clinic: عيادة الامل
WhatsApp: 07731002610
`,
  "utf8"
);

// 4) ملخص للمستخدم
const userLines = [
  "=== تم الإعداد التلقائي — عيادة الامل ===",
  "",
  "✅ قاعدة البيانات: n8n_bot مفعّل",
  "✅ رقم واتساب: 07731002610 (+9647731002610)",
  "✅ ملف n8n جاهز: uploads/n8n_عيادة_الامل_جاهز.json",
  "✅ رسالة للصديق: uploads/صديقي_استورد_فقط.txt",
  "",
  "--- رابط Webhook (للوحة المطور) ---",
];

if (webhookUrl) {
  userLines.push(`✅ تم حفظه تلقائياً: ${webhookUrl}`);
  userLines.push("→ افتح لوحة المطور وتأكد ظهر بالحقل (أو حدّث الصفحة)");
} else {
  userLines.push("⏳ ينتظر رابط n8n من صديقك بعد تفعيل الوركفلو");
  userLines.push("→ عندما يرسل Production URL، شغّل:");
  userLines.push(
    `   node scripts/manage-bot-integration.mjs --clinic-id=${AMAL_CLINIC_ID} --enable --webhook-url=URL_HERE --numbers=${numbers}`
  );
}

userLines.push("", "--- API Key (للمرجع فقط — مدمج بالملف) ---", apiKey);
userLines.push("", "--- webhook_secret (مدمج بالملف) ---", webhookSecret);

fs.writeFileSync(userMsg, userLines.join("\n"), "utf8");

console.log(userLines.join("\n"));
console.log("\n→ أرسل لصديقك: n8n_عيادة_الامل_جاهز.json + صديقي_استورد_فقط.txt");
