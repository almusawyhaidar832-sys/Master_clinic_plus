import { digitsOnly } from "@/lib/phone";
import { getWhatsAppConfig } from "@/lib/whatsapp/config";
import {
  resolveWhatsAppInstanceForClinic,
  resolveWhatsAppInstanceName,
} from "@/lib/whatsapp/resolve-instance";

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
    inst.state ??
      inst.status ??
      inst.connectionStatus ??
      d.state ??
      d.status ??
      ""
  ).toLowerCase();

  if (raw === "open" || raw === "connected") return "open";
  if (raw === "connecting" || raw === "qrcode" || raw === "qr") {
    return "connecting";
  }
  if (raw === "close" || raw === "closed" || raw === "disconnected") {
    return "close";
  }
  return "unknown";
}

export type EvolutionSessionSnapshot = {
  linked: boolean;
  state: EvolutionConnectionState;
  connectionStateData: unknown;
  instanceListData: unknown;
};

/**
 * حالة الجلسة الموحّدة — لا نستدعي /connect إذا كانت open (يقطع الجلسة على الهاتف).
 */
export async function resolveEvolutionSession(
  instanceOverride?: string
): Promise<EvolutionSessionSnapshot> {
  const instanceName =
    instanceOverride?.trim() ||
    (await resolveWhatsAppInstanceName());

  const [stateRes, listRes] = await Promise.all([
    evolutionFetch(
      `/instance/connectionState/${encodeURIComponent(instanceName)}`,
      { method: "GET" }
    ),
    evolutionFetch("/instance/fetchInstances", { method: "GET" }),
  ]);

  const stateFromEndpoint = stateRes.ok
    ? parseConnectionState(stateRes.data)
    : "unknown";

  const rows = listRes.ok ? parseInstanceList(listRes.data) : [];
  const row = rows.find(
    (i) => i.name === instanceName || i.instanceName === instanceName
  ) as { connectionStatus?: string; name?: string } | undefined;

  const stateFromList = row?.connectionStatus
    ? parseConnectionState({ connectionStatus: row.connectionStatus })
    : "unknown";

  const linked = stateFromEndpoint === "open" || stateFromList === "open";

  let state: EvolutionConnectionState = "unknown";
  if (linked) state = "open";
  else if (stateFromEndpoint !== "unknown") state = stateFromEndpoint;
  else state = stateFromList;

  return {
    linked,
    state,
    connectionStateData: stateRes.data,
    instanceListData: listRes.data,
  };
}

export async function fetchEvolutionConnectionState(): Promise<{
  state: EvolutionConnectionState;
  data: unknown;
  linked: boolean;
}> {
  const session = await resolveEvolutionSession();
  return {
    state: session.state,
    data: session.connectionStateData,
    linked: session.linked,
  };
}

function parseInstanceList(data: unknown): { name?: string; instanceName?: string }[] {
  if (Array.isArray(data)) return data as { name?: string; instanceName?: string }[];
  if (data && typeof data === "object") {
    const d = data as Record<string, unknown>;
    for (const key of ["instances", "data", "value", "response"]) {
      if (Array.isArray(d[key])) {
        return d[key] as { name?: string; instanceName?: string }[];
      }
    }
  }
  return [];
}

function instanceExists(
  rows: { name?: string; instanceName?: string }[],
  instanceName: string
): boolean {
  return rows.some(
    (i) => i.name === instanceName || i.instanceName === instanceName
  );
}

/** إنشاء Instance إن لم يكن موجوداً (WHATSAPP-BAILEYS) */
export async function ensureEvolutionInstanceNamed(instanceName: string): Promise<{
  ok: boolean;
  created: boolean;
  qrFromCreate: string | null;
  error?: string;
}> {
  const name = instanceName.trim();
  if (!name) {
    return { ok: false, created: false, qrFromCreate: null, error: "instance_name_required" };
  }

  const list = await evolutionFetch("/instance/fetchInstances", { method: "GET" });

  if (list.ok && instanceExists(parseInstanceList(list.data), name)) {
    return { ok: true, created: false, qrFromCreate: null };
  }

  const created = await evolutionFetch("/instance/create", {
    method: "POST",
    body: JSON.stringify({
      instanceName: name,
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
      console.error(LOG, "create_instance_failed", name, msg);
      return { ok: false, created: false, qrFromCreate: null, error: msg };
    }
    return { ok: true, created: false, qrFromCreate: null };
  }

  return {
    ok: true,
    created: true,
    qrFromCreate: extractQrImageSrc(created.data),
  };
}

export async function ensureEvolutionInstance(): Promise<{
  created: boolean;
  qrFromCreate: string | null;
}> {
  const { instanceName } = getWhatsAppConfig();
  const result = await ensureEvolutionInstanceNamed(instanceName);
  return { created: result.created, qrFromCreate: result.qrFromCreate };
}

/**
 * إعادة ضبط الجلسة — يحل QR منتهي أو "Couldn't link device".
 * logout ثم connect برمز جديد.
 */
/** إعادة تهيئة instance محدد (logout + إعادة إنشاء) */
export async function restartEvolutionInstanceNamed(
  instanceName: string
): Promise<{ ok: boolean; error?: string }> {
  const { configured } = getWhatsAppConfig();
  if (!configured) {
    return { ok: false, error: "whatsapp_not_configured" };
  }

  const name = instanceName.trim();
  if (!name) return { ok: false, error: "instance_name_required" };

  await evolutionFetch(
    `/instance/logout/${encodeURIComponent(name)}`,
    { method: "DELETE" }
  );

  await new Promise((r) => setTimeout(r, 1500));

  const ensured = await ensureEvolutionInstanceNamed(name);
  return { ok: ensured.ok, error: ensured.error };
}

export async function restartEvolutionInstance(): Promise<EvolutionQrResult> {
  const { configured } = getWhatsAppConfig();
  const instanceName = await resolveWhatsAppInstanceName();
  if (!configured) {
    return {
      linked: false,
      connectionState: "unknown",
      qrImageSrc: null,
      error: "لم يُضبط WHATSAPP_API_URL أو WHATSAPP_API_KEY",
    };
  }

  await evolutionFetch(
    `/instance/logout/${encodeURIComponent(instanceName)}`,
    { method: "DELETE" }
  );

  await new Promise((r) => setTimeout(r, 1500));

  return fetchEvolutionQr();
}

/** جلب QR للعرض في واجهة «ربط واتساب» */
export async function fetchEvolutionQr(): Promise<EvolutionQrResult> {
  const { configured } = getWhatsAppConfig();
  const instanceName = await resolveWhatsAppInstanceName();
  if (!configured) {
    return {
      linked: false,
      connectionState: "unknown",
      qrImageSrc: null,
      error: "لم يُضبط WHATSAPP_API_URL أو WHATSAPP_API_KEY",
    };
  }

  await ensureEvolutionInstanceNamed(instanceName);

  const session = await resolveEvolutionSession(instanceName);
  if (session.linked) {
    return {
      linked: true,
      connectionState: "open",
      qrImageSrc: null,
      raw: session.connectionStateData,
    };
  }

  const connect = await evolutionFetch(
    `/instance/connect/${encodeURIComponent(instanceName)}`,
    { method: "GET" }
  );

  if (!connect.ok) {
    const ensured = await ensureEvolutionInstanceNamed(instanceName);
    const fallbackQr = ensured.qrFromCreate;
    if (fallbackQr) {
      return {
        linked: false,
        connectionState: "connecting",
        qrImageSrc: fallbackQr,
        raw: connect.data,
      };
    }
    return {
      linked: false,
      connectionState: session.state,
      qrImageSrc: null,
      error: connect.text.slice(0, 300) || `HTTP ${connect.status}`,
      raw: connect.data,
    };
  }

  const qrImageSrc = extractQrImageSrc(connect.data);
  const connectionState = parseConnectionState(connect.data);

  if (!qrImageSrc && connectionState === "open") {
    return {
      linked: true,
      connectionState: "open",
      qrImageSrc: null,
      raw: connect.data,
    };
  }

  if (!qrImageSrc && !session.linked) {
    return {
      linked: false,
      connectionState:
        connectionState === "unknown" ? session.state : connectionState,
      qrImageSrc: null,
      error:
        "لم يُرجع Evolution رمز QR — اضغط «QR جديد (بعد خطأ الربط)» أو «إعادة الربط»",
      raw: connect.data,
    };
  }

  return {
    linked: connectionState === "open",
    connectionState:
      connectionState === "unknown" ? session.state : connectionState,
    qrImageSrc,
    raw: connect.data,
  };
}

/** إرسال نص عبر Evolution — الرقم بدون + */
export async function sendEvolutionText(
  rawPhone: string,
  text: string,
  options?: { clinicId?: string; instanceName?: string }
): Promise<{ ok: boolean; status: number; error?: string; data?: unknown }> {
  const { configured } = getWhatsAppConfig();
  const instanceName =
    options?.instanceName?.trim() ||
    (options?.clinicId
      ? await resolveWhatsAppInstanceForClinic(options.clinicId)
      : await resolveWhatsAppInstanceName());
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
