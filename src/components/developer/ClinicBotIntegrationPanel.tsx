"use client";

import { useCallback, useEffect, useState } from "react";
import { Copy, KeyRound, RefreshCw } from "lucide-react";

type IntegrationRow = {
  id: string;
  provider: "evolution" | "n8n_bot" | "disabled";
  bot_api_key_prefix: string | null;
  webhook_url: string | null;
  webhook_secret: string | null;
  whatsapp_numbers: string[];
  is_active: boolean;
};

type GeneratedResult = {
  clinic_name: string;
  clinic_id: string;
  api_key: string;
  webhook_secret: string;
  webhook_url: string | null;
  whatsapp_numbers: string[];
};

type Props = {
  clinicId: string;
  clinicName: string;
  onMessage: (msg: { ok: boolean; text: string }) => void;
};

function CopyButton({ value, label }: { value: string; label?: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(value);
          setCopied(true);
          setTimeout(() => setCopied(false), 1500);
        } catch {
          /* ignore */
        }
      }}
      className="inline-flex items-center gap-1 rounded-md border border-slate-600 px-2 py-1 text-xs text-slate-300 hover:bg-slate-700"
    >
      <Copy className="h-3 w-3" />
      {copied ? "تم" : label ?? "نسخ"}
    </button>
  );
}

export function ClinicBotIntegrationPanel({ clinicId, clinicName, onMessage }: Props) {
  const [integration, setIntegration] = useState<IntegrationRow | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [webhookUrl, setWebhookUrl] = useState("");
  const [numbers, setNumbers] = useState("");
  const [generated, setGenerated] = useState<GeneratedResult | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    const res = await fetch(`/api/developer/clinics/${clinicId}/bot-integration`);
    const data = await res.json();
    if (res.ok) {
      setIntegration(data.integration ?? null);
      setWebhookUrl(data.integration?.webhook_url ?? "");
      setNumbers((data.integration?.whatsapp_numbers ?? []).join(", "));
    }
    setLoading(false);
  }, [clinicId]);

  useEffect(() => {
    void load();
  }, [load]);

  async function callAction(action: "generate" | "disable" | "update") {
    setBusy(true);
    setGenerated(null);
    const res = await fetch(`/api/developer/clinics/${clinicId}/bot-integration`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action, webhook_url: webhookUrl, numbers }),
    });
    const data = await res.json();
    setBusy(false);
    if (!res.ok) {
      onMessage({ ok: false, text: data.error ?? "فشلت العملية" });
      return;
    }
    if (action === "generate") {
      setGenerated({
        clinic_name: data.clinic_name,
        clinic_id: data.clinic_id,
        api_key: data.api_key,
        webhook_secret: data.webhook_secret,
        webhook_url: data.webhook_url,
        whatsapp_numbers: data.whatsapp_numbers ?? [],
      });
      onMessage({ ok: true, text: "تم توليد مفتاح جديد — انسخه الآن، لن يظهر ثانية" });
    } else {
      onMessage({ ok: true, text: data.message ?? "تم" });
    }
    void load();
  }

  const baseUrl = typeof window !== "undefined" ? window.location.origin : "";

  function handoffText(g: GeneratedResult) {
    return [
      `=== ربط N8N — ${g.clinic_name} ===`,
      ``,
      `Base URL: ${baseUrl}`,
      `clinic_id: ${g.clinic_id}`,
      ``,
      `--- Master Clinic Bot API ---`,
      `X-Bot-Api-Key: ${g.api_key}`,
      ``,
      `--- متغيرات n8n (Settings → Variables) ---`,
      `MCP_BOT_API_KEY=${g.api_key}`,
      `APPOINTMENT_WEBHOOK_SECRET=${g.webhook_secret}`,
      ``,
      `--- Webhook URL (من n8n → Appointment Events Webhook → Production URL) ---`,
      `ضع الرابط بلوحة المطور → رابط Webhook`,
      g.webhook_url ? `webhook_url الحالي: ${g.webhook_url}` : `webhook_url: (بانتظار الرابط من n8n)`,
      ``,
      `--- استيراد الوركفلو ---`,
      `استورد الملف: n8n_عيادة_الامل_جاهز.json`,
      `فعّل الوركفلو (Active = ON)`,
    ].join("\n");
  }

  function n8nEnvBlock() {
    if (!integration?.webhook_secret) return null;
    return [
      `MCP_BOT_API_KEY=<انسخ من X-Bot-Api-Key بعد توليد مفتاح جديد>`,
      `APPOINTMENT_WEBHOOK_SECRET=${integration.webhook_secret}`,
    ].join("\n");
  }

  const isEnabled = integration?.provider === "n8n_bot" && integration.is_active;

  return (
    <div id="bot-integration" className="mt-6 rounded-xl border border-slate-700 p-4">
      <div className="flex items-center justify-between">
        <h2 className="flex items-center gap-2 text-sm font-bold text-amber-400">
          <KeyRound className="h-4 w-4" />
          ربط N8N Bot (واتساب صديقك) — {clinicName}
        </h2>
        <button
          type="button"
          onClick={() => void load()}
          disabled={loading}
          className="text-slate-400 hover:text-white"
        >
          <RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} />
        </button>
      </div>

      <p className="mt-2 text-xs">
        الحالة:{" "}
        <span className={isEnabled ? "text-emerald-400" : "text-slate-400"}>
          {isEnabled ? "مفعّل — يرسل عبر N8N" : "غير مفعّل — يرسل عبر Evolution (الوضع الحالي)"}
        </span>
      </p>

      {integration?.bot_api_key_prefix && (
        <p className="mt-1 text-xs text-slate-400" dir="ltr">
          مفتاح حالي (بادئة فقط): {integration.bot_api_key_prefix}...
        </p>
      )}

      <div className="mt-3 grid gap-2 sm:grid-cols-2">
        <div>
          <label className="text-xs text-slate-400">رابط Webhook (من صديقك)</label>
          <input
            type="text"
            dir="ltr"
            value={webhookUrl}
            onChange={(e) => setWebhookUrl(e.target.value)}
            placeholder="https://n8n.example.com/webhook/clinic-events"
            className="mt-1 w-full rounded-md border border-slate-600 bg-slate-900 px-2 py-1.5 text-xs text-white"
          />
        </div>
        <div>
          <label className="text-xs text-slate-400">أرقام واتساب (مفصولة بفاصلة)</label>
          <input
            type="text"
            dir="ltr"
            value={numbers}
            onChange={(e) => setNumbers(e.target.value)}
            placeholder="+9647801234567, +9647809876543"
            className="mt-1 w-full rounded-md border border-slate-600 bg-slate-900 px-2 py-1.5 text-xs text-white"
          />
        </div>
      </div>

      <div className="mt-3 flex flex-wrap gap-2">
        <button
          type="button"
          onClick={() => void callAction("update")}
          disabled={busy}
          className="rounded-lg bg-slate-700 px-3 py-1.5 text-xs font-bold hover:bg-slate-600 disabled:opacity-60"
        >
          حفظ الرابط والأرقام
        </button>
        <button
          type="button"
          onClick={() => void callAction("generate")}
          disabled={busy}
          className="rounded-lg bg-amber-700 px-3 py-1.5 text-xs font-bold hover:bg-amber-600 disabled:opacity-60"
        >
          {integration?.bot_api_key_prefix ? "توليد مفتاح جديد (تدوير)" : "توليد مفتاح API + تفعيل"}
        </button>
        {isEnabled && (
          <button
            type="button"
            onClick={() => void callAction("disable")}
            disabled={busy}
            className="rounded-lg bg-red-800 px-3 py-1.5 text-xs font-bold hover:bg-red-700 disabled:opacity-60"
          >
            تعطيل — رجوع لـ Evolution
          </button>
        )}
      </div>

      {generated && (
        <div className="mt-4 rounded-lg border border-amber-700 bg-amber-950/30 p-3">
          <p className="text-xs font-bold text-amber-300">
            ⚠️ يظهر المفتاح مرة واحدة فقط — انسخه وأرسله لصديقك الآن
          </p>
          <div className="mt-2 space-y-1 text-xs" dir="ltr">
            <div className="flex items-center justify-between gap-2">
              <span className="text-slate-400">Base URL:</span>
              <span className="truncate font-mono">{baseUrl}</span>
              <CopyButton value={baseUrl} />
            </div>
            <div className="flex items-center justify-between gap-2">
              <span className="text-slate-400">clinic_id:</span>
              <span className="truncate font-mono">{generated.clinic_id}</span>
              <CopyButton value={generated.clinic_id} />
            </div>
            <div className="flex items-center justify-between gap-2">
              <span className="text-slate-400">X-Bot-Api-Key:</span>
              <span className="truncate font-mono">{generated.api_key}</span>
              <CopyButton value={generated.api_key} />
            </div>
            <div className="flex items-center justify-between gap-2">
              <span className="text-slate-400">webhook_secret:</span>
              <span className="truncate font-mono">{generated.webhook_secret}</span>
              <CopyButton value={generated.webhook_secret} />
            </div>
          </div>
          <button
            type="button"
            onClick={async () => {
              await navigator.clipboard.writeText(handoffText(generated));
              onMessage({ ok: true, text: "تم نسخ كل شيء — الصقه لصديقك مباشرة" });
            }}
            className="mt-3 w-full rounded-lg bg-emerald-700 px-3 py-2 text-xs font-bold hover:bg-emerald-600"
          >
            📋 نسخ الكل جاهز للإرسال لصديقك
          </button>
        </div>
      )}

      {integration?.webhook_secret && !generated && (
        <div className="mt-3 space-y-2 rounded-md bg-slate-900 px-2 py-2 text-xs" dir="ltr">
          <div className="flex items-center justify-between gap-2">
            <span className="text-slate-400">webhook_secret الحالي:</span>
            <span className="truncate font-mono">{integration.webhook_secret}</span>
            <CopyButton value={integration.webhook_secret} />
          </div>
          {n8nEnvBlock() && (
            <button
              type="button"
              onClick={async () => {
                await navigator.clipboard.writeText(n8nEnvBlock() ?? "");
                onMessage({ ok: true, text: "تم نسخ متغيرات n8n (أضف MCP_BOT_API_KEY بعد توليد المفتاح)" });
              }}
              className="w-full rounded-lg border border-slate-600 px-3 py-1.5 text-xs text-slate-300 hover:bg-slate-800"
            >
              📋 نسخ متغيرات n8n (APPOINTMENT_WEBHOOK_SECRET جاهز)
            </button>
          )}
        </div>
      )}
    </div>
  );
}
