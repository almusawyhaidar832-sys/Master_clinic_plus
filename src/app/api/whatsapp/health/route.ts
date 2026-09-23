import { NextRequest, NextResponse } from "next/server";
import { getWhatsAppConfig } from "@/lib/whatsapp/config";
import {
  evolutionFetch,
  resolveEvolutionSession,
  summarizeEvolutionInstances,
} from "@/lib/whatsapp/evolution-client";
import { resolveWhatsAppInstanceName } from "@/lib/whatsapp/resolve-instance";
import { requireWhatsAppManageAccess } from "@/lib/whatsapp/require-api-access";
import { phoneToLocalDisplay } from "@/lib/phone";

/**
 * GET /api/whatsapp/health — فحص شامل لسيرفر Evolution (بدون إرسال رسالة).
 */
export async function GET(request: NextRequest) {
  const access = await requireWhatsAppManageAccess(request);
  if (!access.ok) return access.response;

  const cfg = getWhatsAppConfig();
  if (!cfg.configured) {
    return NextResponse.json({
      ok: false,
      configured: false,
      diagnosisAr:
        "واتساب غير مُعدّ على Vercel — أضف WHATSAPP_API_URL و WHATSAPP_API_KEY",
      fixSteps: [
        "في Vercel → Settings → Environment Variables",
        "WHATSAPP_API_URL = رابط Railway",
        "WHATSAPP_API_KEY = مفتاح Evolution",
      ],
    });
  }

  const home = await evolutionFetch("/", { method: "GET" });
  const apiVersion =
    home.ok &&
    home.data &&
    typeof home.data === "object" &&
    "version" in (home.data as object)
      ? String((home.data as { version: string }).version)
      : null;

  const instanceName = await resolveWhatsAppInstanceName();
  const session = await resolveEvolutionSession(instanceName, { skipCache: true });
  const instances = await summarizeEvolutionInstances();
  const extraConnected = instances.filter(
    (i) => i.connected && i.name !== instanceName
  );

  const zombieRisk = Boolean(
    session.linked &&
      session.state === "open" &&
      apiVersion?.startsWith("2.3")
  );

  const diagnosisAr = !session.linked
    ? "واتساب غير مربوط — امسح QR من إعدادات واتساب"
    : zombieRisk
      ? "الجلسة تظهر «متصلة» لكن Baileys قد يكون معطّلاً (zombie) — الإرسال يُرجع PENDING ولا تصل الرسالة للجوال"
      : "الجلسة متصلة — جرّب رسالة اختبار للتأكد من التسليم";

  const fixSteps = session.linked
    ? [
        "في التطبيق: إعدادات واتساب → «إصلاح واتساب الآن» → امسح QR من جوال العيادة",
        "على Railway: Docker = evoapicloud/evolution-api:v2.3.7 (ليس 2.4)",
        "على Railway: WPP_LID_MODE=false و CONFIG_SESSION_PHONE_VERSION=2.3000.1042742319",
        "على Railway: Redeploy ثم أعد QR — instance واحد فقط: " + instanceName,
        "إذا استمرت المشكلة: انسخ «تعليمات Railway» من أسفل صفحة واتساب وأرسلها لدعم Railway",
      ]
    : [
        "افتح إعدادات واتساب وامسح QR من جوال العيادة",
        "تأكد أن instance واحد فقط على السيرفر: " + instanceName,
      ];

  return NextResponse.json({
    ok: session.linked && home.ok,
    configured: true,
    apiOk: home.ok,
    apiVersion,
    whatsappWebVersion:
      home.data &&
      typeof home.data === "object" &&
      "whatsappWebVersion" in (home.data as object)
        ? String((home.data as { whatsappWebVersion: string }).whatsappWebVersion)
        : null,
    evolutionPublicUrl: cfg.baseUrl,
    instanceName,
    linked: session.linked,
    state: session.state,
    linkedPhoneDisplay: session.linkedPhone
      ? phoneToLocalDisplay(session.linkedPhone)
      : null,
    profileName: session.profileName,
    instances,
    extraConnectedInstances: extraConnected.map((i) => i.name),
    zombieRisk,
    diagnosisAr,
    fixSteps,
    railwayMessage: buildRailwaySupportMessage({
      serverUrl: cfg.baseUrl,
      instanceName,
      apiVersion,
      linkedPhone: session.linkedPhone,
      zombieRisk,
    }),
  });
}

function buildRailwaySupportMessage(input: {
  serverUrl: string;
  instanceName: string;
  apiVersion: string | null;
  linkedPhone: string | null;
  zombieRisk: boolean;
}): string {
  const url = input.serverUrl.replace(/\/$/, "");
  return [
    "=== طلب دعم Railway — Evolution API / Baileys لا يُسلّم الرسائل ===",
    "",
    "المشروع: Master Clinic Plus (عيادة)",
    `التاريخ: ${new Date().toISOString().slice(0, 10)}`,
    "",
    "الأعراض:",
    "- Evolution API يرد HTTP 201 على /message/sendText",
    '- status في الاستجابة يبقى "PENDING" ولا يتحول إلى DELIVERY_ACK',
    "- /chat/findStatusMessage يُرجع [] فارغ بعد 5–10 ثوانٍ",
    "- التطبيق يظهر «تم الإرسال» لكن الرسالة لا تصل لأي جوال",
    `- instance: ${input.instanceName}`,
    `- حالة الاتصال: open (متصل ظاهرياً)`,
    input.linkedPhone ? `- رقم العيادة المربوط: ${input.linkedPhone}` : "",
    input.apiVersion ? `- إصدار Evolution: ${input.apiVersion}` : "",
    "",
    "ما جُرّب:",
    "- إعادة ربط QR من التطبيق",
    "- التأكد من WHATSAPP_API_URL و API_KEY على Vercel",
    "- instance واحد فقط على السيرفر",
    "",
    "المطلوب من Railway:",
    "1) Docker Image: evoapicloud/evolution-api:v2.3.7 (لا تستخدم 2.4 — LICENSE_REQUIRED)",
    "2) Variables:",
    `   SERVER_URL=${url}`,
    "   WPP_LID_MODE=false",
    "   CONFIG_SESSION_PHONE_VERSION=2.3000.1042742319",
    "   DATABASE_ENABLED=true",
    "   DATABASE_PROVIDER=postgresql",
    "3) Redeploy كامل للخدمة + حذف volume القديم إن وُجد (جلسة Baileys تالفة)",
    "4) بعد Redeploy: مسح QR جديد من التطبيق",
    "",
    input.zombieRisk
      ? "التشخيص: zombie Baileys session — الجلسة open لكن Baileys لا يُرسل للشبكة."
      : "",
    "",
    `رابط السيرفر: ${url}`,
    "شكراً",
  ]
    .filter(Boolean)
    .join("\n");
}
