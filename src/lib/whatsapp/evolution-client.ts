import { digitsOnly } from "@/lib/phone";
import { getWhatsAppConfig } from "@/lib/whatsapp/config";

export type EvolutionConnectionState = "open" | "close" | "connecting" | "unknown";

export interface EvolutionQrResult {
  linked: boolean;
  connectionState: EvolutionConnectionState;
  qrImageSrc: string | null;
  raw?: unknown;
  error?: string;
}

const LOG = "[whatsapp/evolution]";

export async function evolutionFetch(
  path: string,
  init: RequestInit = {}
): Promise<{ ok: boolean; status: number; data: unknown; text: string }> {
  const { baseUrl, apiKey } = getWhatsAppConfig();
  if (!baseUrl || !apiKey) {
    return {
      ok: false,
      status: 0,
      data: null,
      text: "WHATSAPP_API_URL or WHATSAPP_API_KEY not set",
    };
  }

  const url = `${baseUrl}${path.startsWith("/") ? path : `/${path}`}`;
  const headers: Record<string, string> = {
    apikey: apiKey,
    ...(init.headers as Record<string, string>),
  };
  if (init.body && !headers["Content-Type"]) {
    headers["Content-Type"] = "application/json";
  }

  const res = await fetch(url, { ...init, headers });
  const text = await res.text().catch(() => "");
  let data: unknown = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = { raw: text };
  }

  if (!res.ok) {
    console.error(LOG, path, res.status, text.slice(0, 400));
  }

  return { ok: res.ok, status: res.status, data, text };
}

/** يستخرج صورة QR من استجابة Evolution (أشكال متعددة حسب الإصدار) */
export function extractQrImageSrc(data: unknown): string | null {
  if (!data || typeof data !== "object") return null;
  const d = data as Record<string, unknown>;
  const qrBlock =
    d.qrcode && typeof d.qrcode === "object"
      ? (d.qrcode as Record<string, unknown>)
      : null;

  const candidates: unknown[] = [
    d.base64,
    qrBlock?.base64,
    d.code,
    qrBlock?.code,
  ];

  for (const c of candidates) {
    if (typeof c !== "string" || c.length < 20) continue;
    if (c.startsWith("data:image")) return c;
    const cleaned = c.replace(/^data:image\/\w+;base64,/, "");
    return `data:image/png;base64,${cleaned}`;
  }
  return null;
}

export function parseConnectionState(data: unknown): EvolutionConnectionState {
  if (!data || typeof data !== "object") return "unknown";
  const d = data as Record<string, unknown>;
  const inst =
    d.instance && typeof d.instance === "object"
      ? (d.instance as Record<string, unknown>)
      : d;

  const raw = String(
    inst.state ?? inst.status ?? d.state ?? d.status ?? ""
  ).toLowerCase();

  if (raw === "open" || raw === "connected") return "open";
  if (raw === "connecting" || raw === "qrcode" || raw === "qr") return "connecting";
  if (raw === "close" || raw === "closed" || raw === "disconnected") {
    return "close";
  }
  return "unknown";
}

export async function fetchEvolutionConnectionState(): Promise<{
  state: EvolutionConnectionState;
  data: unknown;
}> {
  const { instanceName } = getWhatsAppConfig();
  const res = await evolutionFetch(
    `/instance/connectionState/${encodeURIComponent(instanceName)}`,
    { method: "GET" }
  );
  return {
    state: res.ok ? parseConnectionState(res.data) : "unknown",
    data: res.data,
  };
}

/** إنشاء Instance إن لم يكن موجوداً (WHATSAPP-BAILEYS) */
export async function ensureEvolutionInstance(): Promise<void> {
  const { instanceName } = getWhatsAppConfig();

  const list = await evolutionFetch("/instance/fetchInstances", {
    method: "GET",
  });

  if (list.ok && Array.isArray(list.data)) {
    const exists = (list.data as { name?: string; instanceName?: string }[]).some(
      (i) =>
        i.name === instanceName || i.instanceName === instanceName
    );
    if (exists) return;
  }

  const created = await evolutionFetch("/instance/create", {
    method: "POST",
    body: JSON.stringify({
      instanceName,
      integration: "WHATSAPP-BAILEYS",
      qrcode: true,
    }),
  });

  if (!created.ok) {
    const msg =
      typeof created.data === "object" &&
      created.data &&
      "message" in (created.data as object)
        ? String((created.data as { message: string }).message)
        : created.text;
    if (!/already|exist/i.test(msg)) {
      console.error(LOG, "create_instance_failed", msg);
    }
  }
}

/** جلب QR للعرض في واجهة «ربط واتساب» */
export async function fetchEvolutionQr(): Promise<EvolutionQrResult> {
  const { instanceName, configured } = getWhatsAppConfig();
  if (!configured) {
    return {
      linked: false,
      connectionState: "unknown",
      qrImageSrc: null,
      error: "لم يُضبط WHATSAPP_API_URL أو WHATSAPP_API_KEY",
    };
  }

  await ensureEvolutionInstance();

  const stateRes = await fetchEvolutionConnectionState();
  if (stateRes.state === "open") {
    return {
      linked: true,
      connectionState: "open",
      qrImageSrc: null,
      raw: stateRes.data,
    };
  }

  const connect = await evolutionFetch(
    `/instance/connect/${encodeURIComponent(instanceName)}`,
    { method: "GET" }
  );

  if (!connect.ok) {
    return {
      linked: false,
      connectionState: stateRes.state,
      qrImageSrc: null,
      error: connect.text.slice(0, 300) || `HTTP ${connect.status}`,
      raw: connect.data,
    };
  }

  const qrImageSrc = extractQrImageSrc(connect.data);
  const connectionState = parseConnectionState(connect.data);

  return {
    linked: connectionState === "open",
    connectionState:
      connectionState === "unknown" ? stateRes.state : connectionState,
    qrImageSrc,
    raw: connect.data,
  };
}

/** إرسال نص عبر Evolution — الرقم بدون + */
export async function sendEvolutionText(
  rawPhone: string,
  text: string
): Promise<{ ok: boolean; status: number; error?: string; data?: unknown }> {
  const { instanceName, configured } = getWhatsAppConfig();
  if (!configured) {
    return { ok: false, status: 0, error: "whatsapp_not_configured" };
  }

  let number = digitsOnly(rawPhone);
  if (number.startsWith("00")) number = number.slice(2);
  if (number.startsWith("0")) number = `964${number.slice(1)}`;
  if (!number.startsWith("964") && number.length >= 10) {
    number = `964${number}`;
  }

  const res = await evolutionFetch(
    `/message/sendText/${encodeURIComponent(instanceName)}`,
    {
      method: "POST",
      body: JSON.stringify({ number, text }),
    }
  );

  if (!res.ok) {
    const err =
      typeof res.data === "object" && res.data && "message" in (res.data as object)
        ? String((res.data as { message: string }).message)
        : res.text.slice(0, 400);
    return { ok: false, status: res.status, error: err, data: res.data };
  }

  return { ok: true, status: res.status, data: res.data };
}
