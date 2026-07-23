#!/usr/bin/env node
/**
 * يعدّل وركفلو N8N ليعمل مع Master Clinic Plus — عيادة الامل (WasenderAPI).
 * الاستخدام:
 *   node scripts/patch-n8n-workflow-amal.mjs <input.json> [output.json]
 */
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const AMAL_CLINIC_ID = "95e3ebda-a694-4d5b-8731-e946fb78f172";
const MCP_BASE = "https://master-clinic-plus-zg29.vercel.app";

const inputPath = process.argv[2];
const outputPath =
  process.argv[3] ||
  path.join(
    path.dirname(fileURLToPath(import.meta.url)),
    "..",
    "uploads",
    "n8n_عيادة_الامل_جاهز.json"
  );

if (!inputPath || !fs.existsSync(inputPath)) {
  console.error("Usage: node scripts/patch-n8n-workflow-amal.mjs <input.json> [output.json]");
  process.exit(1);
}

const wf = JSON.parse(fs.readFileSync(inputPath, "utf8"));

function findNode(name) {
  const n = wf.nodes.find((x) => x.name === name);
  if (!n) throw new Error(`Node not found: ${name}`);
  return n;
}

function setNodeType(node, type, typeVersion) {
  node.type = type;
  node.typeVersion = typeVersion;
}

// ── 1) استبدال Notion Lookup (WA) بإعدادات ثابتة لعيادة الامل ──
const clinicWa = findNode("Lookup Clinic Registry (WA)");
clinicWa.name = "Clinic Config (عيادة الامل)";
setNodeType(clinicWa, "n8n-nodes-base.set", 3.4);
clinicWa.parameters = {
  assignments: {
    assignments: [
      {
        id: "amal-clinic-id",
        name: "Clinic ID",
        value: AMAL_CLINIC_ID,
        type: "string",
      },
      {
        id: "amal-bot-key",
        name: "Bot API Key",
        value: "={{ $env.MCP_BOT_API_KEY }}",
        type: "string",
      },
      {
        id: "amal-clinic-name",
        name: "Clinic Name",
        value: "عيادة الامل",
        type: "string",
      },
    ],
  },
  options: {},
};
delete clinicWa.credentials;

// ── 2) استبدال Notion Lookup (Webhook) ──
const clinicWebhook = findNode("Lookup Clinic Registry (Webhook)");
clinicWebhook.name = "Webhook Clinic Config";
setNodeType(clinicWebhook, "n8n-nodes-base.code", 2);
clinicWebhook.parameters = {
  jsCode: `// إعدادات عيادة الامل لمسار webhook الوارد — بدون Notion
const body = $('Verify HMAC Signature').item.json.body || {};
return [{
  json: {
    'Clinic ID': body.clinic_id || '${AMAL_CLINIC_ID}',
    'Bot API Key': $env.MCP_BOT_API_KEY,
    body,
  },
}];`,
};
delete clinicWebhook.credentials;

// ── 3) إصلاح Edit Fields1 — WasenderAPI بدل WhatsApp Trigger ──
const editFields1 = findNode("Edit Fields1");
editFields1.parameters.assignments.assignments[0].value =
  '={{ $node["WasenderAPI Trigger"].json["data"]["messages"]["messageBody"] }}';

// ── 4) إصلاح Create Appointment — ترويسة API + idempotency من Wasender ──
const createAppt = findNode("Create Appointment via Bot API");
createAppt.parameters.url = `${MCP_BASE}/api/bot/appointments`;
createAppt.parameters.specifyHeaders = "keypair";
createAppt.parameters.headerParameters = {
  parameters: [
    {
      name: "X-API-Key",
      value: '={{ $node["Clinic Config (عيادة الامل)"].json["Bot API Key"] }}',
    },
    {
      name: "Content-Type",
      value: "application/json",
    },
  ],
};
createAppt.parameters.jsonBody = `={{ JSON.stringify({
  idempotency_key: $node["WasenderAPI Trigger"].json["data"]["messages"]["key"]["id"]
    || $node["WasenderAPI Trigger"].json["data"]["messages"]["key"]["remoteJid"]
    + "_" + ($node["WasenderAPI Trigger"].json["data"]["messages"]["messageTimestamp"] || Date.now()),
  source: "whatsapp_bot",
  name: $json["output"]["final_data"]["name"],
  phone: $json["output"]["final_data"]["phone"],
  date: $json["output"]["final_data"]["date"],
  doctorId: $json["output"]["final_data"]["doctorId"]
}) }}`;

// ── 5) تحديث مراجع Lookup Clinic Registry (WA) → Clinic Config ──
const oldRef = 'Lookup Clinic Registry (WA)';
const newRef = "Clinic Config (عيادة الامل)";
const oldWebhookRef = "Lookup Clinic Registry (Webhook)";
const newWebhookRef = "Webhook Clinic Config";

for (const node of wf.nodes) {
  const s = JSON.stringify(node.parameters);
  if (s.includes(oldRef) || s.includes(oldWebhookRef)) {
    node.parameters = JSON.parse(
      s
        .replaceAll(oldRef, newRef)
        .replaceAll(oldWebhookRef, newWebhookRef)
    );
  }
}

// أدوات AI
for (const node of wf.nodes) {
  if (node.name === "Check Appointment Availability" || node.name === "Get Clinic Doctors") {
    node.parameters.url = `${MCP_BASE}/api/bot/${node.name === "Get Clinic Doctors" ? "clinic" : "availability"}`;
  }
  if (node.name === "Check Event Processed") {
    node.parameters.url = `={{ '${MCP_BASE}/api/bot/events/' + $('Verify HMAC Signature').item.json.body.idempotency_key }}`;
  }
  if (node.name === "Mark Event Processed") {
    node.parameters.url = `${MCP_BASE}/api/bot/events`;
    node.parameters.jsonBody = `={{ JSON.stringify({
  idempotency_key: $('Verify HMAC Signature').item.json.body.idempotency_key
}) }}`;
  }
}

// ── 6) إصلاح عقد إرسال Wasender — إضافة نص الرسالة ──
const sendBookingConfirm = findNode("Send text message");
sendBookingConfirm.parameters.to =
  '={{ $node["WasenderAPI Trigger"].json["data"]["messages"]["key"]["remoteJid"] }}';
sendBookingConfirm.parameters.text = `={{ "تم تثبيت حجزك بنجاح يا " + $node["Intake & Booking"].json["output"]["final_data"]["name"] + " 🌿\\nننتظرك بالعيادة بموعدك. نورتنا!" }}`;

const sendBookingReply = findNode("Send text message1");
sendBookingReply.parameters.to =
  '={{ $node["WasenderAPI Trigger"].json["data"]["messages"]["key"]["remoteJid"] }}';
sendBookingReply.parameters.text = '={{ $json["output"]["reply_to_user"] }}';

const sendInquiry = findNode("Send text message2");
sendInquiry.parameters.to =
  '={{ $node["WasenderAPI Trigger"].json["data"]["messages"]["key"]["remoteJid"] }}';
sendInquiry.parameters.text = '={{ $json["output"] }}';

// ── 7) تحديث Inquiry Assistant — عيادة الامل بدل روكان (نص ثابت مؤقت) ──
const inquiry = findNode("Inquiry Assistant");
if (inquiry.parameters.options?.systemMessage?.includes("عيادة روكان")) {
  inquiry.parameters.options.systemMessage =
    inquiry.parameters.options.systemMessage.replace(/عيادة روكان/g, "عيادة الامل");
}

// ── 8) ربط التدفق: Trigger → Clinic Config → Edit Fields ──
wf.connections["WasenderAPI Trigger"] = {
  main: [[{ node: "Clinic Config (عيادة الامل)", type: "main", index: 0 }]],
};
wf.connections["Clinic Config (عيادة الامل)"] = {
  main: [[{ node: "Edit Fields", type: "main", index: 0 }]],
};

// webhook path
wf.connections["Self-Origin Event?"] = {
  main: [
    [{ node: "Respond OK (Ignored)", type: "main", index: 0 }],
    [{ node: "Webhook Clinic Config", type: "main", index: 0 }],
  ],
};
wf.connections["Webhook Clinic Config"] = {
  main: [[{ node: "Check Event Processed", type: "main", index: 0 }]],
};

// حذف مفاتيح connections القديمة بعد إعادة تسمية العقد
delete wf.connections["Lookup Clinic Registry (WA)"];
delete wf.connections["Lookup Clinic Registry (Webhook)"];

// Check Event Processed يقرأ Bot API Key من Webhook Clinic Config
const checkEvent = findNode("Check Event Processed");
checkEvent.parameters.headerParameters.parameters[0].value =
  '={{ $json["Bot API Key"] }}';

wf.name = "إدارة واتس اب العيادات — عيادة الامل (Master Clinic Plus)";
wf.active = false;

fs.mkdirSync(path.dirname(outputPath), { recursive: true });
fs.writeFileSync(outputPath, JSON.stringify(wf, null, 2), "utf8");
console.log("تم — الوركفلو الجاهز:", outputPath);
console.log("Clinic ID:", AMAL_CLINIC_ID);
console.log("\nفي n8n عند صديقك:");
console.log("  1) Variables → MCP_BOT_API_KEY = (من لوحة المطور)");
console.log("  2) Variables → APPOINTMENT_WEBHOOK_SECRET = (webhook_secret من لوحة المطور)");
console.log("  3) استورد الملف وفعّل الوركفلو");
console.log("  4) انسخ Production URL من Appointment Events Webhook → ضعه بلوحة المطور");
