import { digitsOnly, normalizePhoneForWhatsApp } from "@/lib/phone";
import { getWhatsAppConfig } from "@/lib/whatsapp/config";
import { describeWhatsAppDeliveryError } from "@/lib/whatsapp/delivery-errors";
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
  linkedPhone?: string | null;
  profileName?: string | null;
}

const LOG = "[whatsapp/evolution]";

/** Baileys يفلتر رسائل متتالية سريعة — ننتظر بين كل إرسالين لنفس الجلسة */
const lastSendAtByInstance = new Map<string, number>();
const MIN_SEND_GAP_MS = 2500;

async function waitForEvolutionSendSlot(instanceName: string): Promise<void> {
  const name = instanceName.trim();
  if (!name) return;
  const last = lastSendAtByInstance.get(name) ?? 0;
  const waitMs = last + MIN_SEND_GAP_MS - Date.now();
  if (waitMs > 0) {
    await new Promise((r) => setTimeout(r, waitMs));
  }
  lastSendAtByInstance.set(name, Date.now());
}

export function parseEvolutionLicenseError(
  data: unknown,
  text: string
): "evolution_license_required" | null {
  if (text.includes("LICENSE_REQUIRED") || text.includes("service not activated")) {
    return "evolution_license_required";
  }
  if (!data || typeof data !== "object") return null;
  const d = data as Record<string, unknown>;
  if (d.code === "LICENSE_REQUIRED") return "evolution_license_required";
  if (String(d.error ?? "").includes("not activated")) {
    return "evolution_license_required";
  }
  return null;
}

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
  /** رقم واتساب العيادة المربوط (+964…) */
  linkedPhone: string | null;
  /** اسم الحساب على واتساب إن وُجد */
  profileName: string | null;
};

const SESSION_CACHE_MS = 20_000;
const sessionCache = new Map<
  string,
  { snapshot: EvolutionSessionSnapshot; expires: number }
>();

export function invalidateEvolutionSessionCache(instanceName?: string) {
  if (instanceName?.trim()) sessionCache.delete(instanceName.trim());
  else sessionCache.clear();
}

/**
 * حالة الجلسة الموحّدة — لا نستدعي /connect إذا كانت open (يقطع الجلسة على الهاتف).
 */
export async function resolveEvolutionSession(
  instanceOverride?: string,
  options?: { skipCache?: boolean }
): Promise<EvolutionSessionSnapshot> {
  const instanceName =
    instanceOverride?.trim() ||
    (await resolveWhatsAppInstanceName());

  if (!options?.skipCache) {
    const cached = sessionCache.get(instanceName);
    if (cached && cached.expires > Date.now()) {
      return cached.snapshot;
    }
  }

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

  const { linkedPhone, profileName } = extractEvolutionLinkedPhone(
    instanceName,
    stateRes.data,
    listRes.data
  );

  const snapshot: EvolutionSessionSnapshot = {
    linked,
    state,
    connectionStateData: stateRes.data,
    instanceListData: listRes.data,
    linkedPhone: linked ? linkedPhone : null,
    profileName: linked ? profileName : null,
  };

  sessionCache.set(instanceName, {
    snapshot,
    expires: Date.now() + SESSION_CACHE_MS,
  });

  return snapshot;
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

function parseInstanceList(
  data: unknown
): {
  name?: string;
  instanceName?: string;
  owner?: string;
  ownerJid?: string;
  number?: string;
  profileName?: string;
  connectionStatus?: string | { state?: string };
}[] {
  if (Array.isArray(data)) {
    return data as {
      name?: string;
      instanceName?: string;
      owner?: string;
      ownerJid?: string;
      number?: string;
      profileName?: string;
      connectionStatus?: string | { state?: string };
    }[];
  }
  if (data && typeof data === "object") {
    const d = data as Record<string, unknown>;
    for (const key of ["instances", "data", "value", "response"]) {
      if (Array.isArray(d[key])) {
        return d[key] as {
          name?: string;
          instanceName?: string;
          owner?: string;
          ownerJid?: string;
          number?: string;
          profileName?: string;
          connectionStatus?: string | { state?: string };
        }[];
      }
    }
  }
  return [];
}

function pickJidDigits(value: unknown): string | null {
  if (typeof value !== "string" || !value.trim()) return null;
  const head = value.trim().split("@")[0];
  const d = digitsOnly(head);
  return d.length >= 10 ? d : null;
}

function pickPhoneFromRecord(
  record: Record<string, unknown> | null | undefined
): string | null {
  if (!record) return null;
  const nested =
    record.instance && typeof record.instance === "object"
      ? (record.instance as Record<string, unknown>)
      : null;

  for (const source of [record, nested]) {
    if (!source) continue;
    for (const key of ["number", "ownerJid", "owner", "phoneNumber", "wuid"]) {
      const digits = pickJidDigits(source[key]);
      if (digits) return digits;
    }
  }
  return null;
}

/** يستخرج رقم واتساب العيادة من استجابة Evolution */
export function extractEvolutionLinkedPhone(
  instanceName: string,
  connectionStateData: unknown,
  instanceListData: unknown
): { linkedPhone: string | null; profileName: string | null } {
  const rows = parseInstanceList(instanceListData);
  const row = rows.find(
    (i) => i.name === instanceName || i.instanceName === instanceName
  );

  const digits =
    pickJidDigits(row?.number) ||
    pickJidDigits(row?.ownerJid) ||
    pickJidDigits(row?.owner) ||
    pickPhoneFromRecord(
      connectionStateData && typeof connectionStateData === "object"
        ? (connectionStateData as Record<string, unknown>)
        : null
    );

  let linkedPhone: string | null = null;
  if (digits) {
    const normalized = normalizePhoneForWhatsApp(digits);
    linkedPhone = normalized || null;
  }

  const profileName =
    typeof row?.profileName === "string" && row.profileName.trim()
      ? row.profileName.trim()
      : null;

  return { linkedPhone, profileName };
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

/** حذف instance من Evolution (logout + حذف البيانات) */
export async function deleteEvolutionInstanceNamed(
  instanceName: string
): Promise<{ ok: boolean; error?: string }> {
  const name = instanceName.trim();
  if (!name) return { ok: false, error: "instance_name_required" };

  const res = await evolutionFetch(
    `/instance/delete/${encodeURIComponent(name)}`,
    { method: "DELETE" }
  );

  if (!res.ok && res.status !== 404) {
    const msg =
      typeof res.data === "object" && res.data && "message" in (res.data as object)
        ? String((res.data as { message: string }).message)
        : res.text.slice(0, 300);
    return { ok: false, error: msg || `HTTP ${res.status}` };
  }

  invalidateEvolutionSessionCache(name);
  return { ok: true };
}

/** يحذف كل instances ما عدا instance العيادة */
export async function cleanupExtraEvolutionInstances(
  keepInstanceName: string
): Promise<{ deleted: string[]; failed: { name: string; error: string }[] }> {
  const keep = keepInstanceName.trim();
  const instances = await summarizeEvolutionInstances();
  const deleted: string[] = [];
  const failed: { name: string; error: string }[] = [];

  for (const row of instances) {
    const name = row.name.trim();
    if (!name || name === keep) continue;
    const result = await deleteEvolutionInstanceNamed(name);
    if (result.ok) deleted.push(name);
    else failed.push({ name, error: result.error ?? "delete_failed" });
  }

  return { deleted, failed };
}

/**
 * إصلاح تلقائي: حذف instances زائدة → logout → instance جديد → QR.
 * يتطلب مسح QR مرة واحدة من جوال العيادة.
 */
export async function autoRepairEvolutionWhatsApp(
  instanceName: string
): Promise<{
  ok: boolean;
  deletedInstances: string[];
  deleteFailures: { name: string; error: string }[];
  qr: EvolutionQrResult;
  error?: string;
}> {
  const name = instanceName.trim();
  const { configured } = getWhatsAppConfig();
  if (!configured) {
    return {
      ok: false,
      deletedInstances: [],
      deleteFailures: [],
      qr: {
        linked: false,
        connectionState: "unknown",
        qrImageSrc: null,
        error: "whatsapp_not_configured",
      },
      error: "whatsapp_not_configured",
    };
  }

  const cleanup = await cleanupExtraEvolutionInstances(name);

  // دائماً logout + QR جديد — جلسة "open" قد تكون zombie (تقبل الإرسال لكن لا تُسلّم).
  await evolutionFetch(`/instance/logout/${encodeURIComponent(name)}`, {
    method: "DELETE",
  });
  await new Promise((r) => setTimeout(r, 2000));

  invalidateEvolutionSessionCache(name);
  await ensureEvolutionInstanceNamed(name);

  const qr = await fetchEvolutionQrNamed(name);

  return {
    ok: qr.linked || Boolean(qr.qrImageSrc),
    deletedInstances: cleanup.deleted,
    deleteFailures: cleanup.failed,
    qr,
    error: qr.error,
  };
}

/** جلب QR لـ instance محدد */
export async function fetchEvolutionQrNamed(
  instanceName: string
): Promise<EvolutionQrResult> {
  const name = instanceName.trim();
  const { configured } = getWhatsAppConfig();
  if (!configured) {
    return {
      linked: false,
      connectionState: "unknown",
      qrImageSrc: null,
      error: "لم يُضبط WHATSAPP_API_URL أو WHATSAPP_API_KEY",
    };
  }

  await ensureEvolutionInstanceNamed(name);

  const session = await resolveEvolutionSession(name);
  if (session.linked) {
    return {
      linked: true,
      connectionState: "open",
      qrImageSrc: null,
      raw: session.connectionStateData,
      linkedPhone: session.linkedPhone,
      profileName: session.profileName,
    };
  }

  const connect = await evolutionFetch(
    `/instance/connect/${encodeURIComponent(name)}`,
    { method: "GET" }
  );

  if (!connect.ok) {
    const licenseErr = parseEvolutionLicenseError(connect.data, connect.text);
    if (licenseErr) {
      return {
        linked: false,
        connectionState: "unknown",
        qrImageSrc: null,
        error: describeWhatsAppDeliveryError(licenseErr),
        raw: connect.data,
      };
    }
    const ensured = await ensureEvolutionInstanceNamed(name);
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

  const licenseErr = parseEvolutionLicenseError(connect.data, connect.text);
  if (licenseErr) {
    return {
      linked: false,
      connectionState: "unknown",
      qrImageSrc: null,
      error: describeWhatsAppDeliveryError(licenseErr),
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
        "لم يُرجع Evolution رمز QR — اضغط «إصلاح تلقائي» مرة أخرى",
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

export async function fetchEvolutionQr(): Promise<EvolutionQrResult> {
  const instanceName = await resolveWhatsAppInstanceName();
  return fetchEvolutionQrNamed(instanceName);
}

/** يكتشف أخطاء مخفية في استجابة Evolution (HTTP 200 لكن الإرسال فشل) */
function parseEvolutionSendFailure(data: unknown): string | null {
  if (!data || typeof data !== "object") return null;
  const d = data as Record<string, unknown>;

  if (d.exists === false) return "number_not_on_whatsapp";

  const response = d.response;
  if (response && typeof response === "object") {
    const msg = (response as Record<string, unknown>).message;
    if (Array.isArray(msg)) {
      for (const item of msg) {
        if (!item || typeof item !== "object") continue;
        const row = item as { exists?: boolean; message?: string };
        if (row.exists === false) return "number_not_on_whatsapp";
        if (typeof row.message === "string" && row.message.trim()) {
          return row.message.trim();
        }
      }
    }
  }

  const status = String(d.status ?? "").toUpperCase();
  if (status === "ERROR" || status === "FAILED") {
    return typeof d.message === "string" ? d.message : "evolution_send_failed";
  }

  return null;
}

/** رقم Evolution بدون + (9647XXXXXXXXX) */
export function formatEvolutionApiNumber(rawPhone: string): string {
  let number = digitsOnly(rawPhone);
  if (number.startsWith("00")) number = number.slice(2);
  if (number.startsWith("0")) number = `964${number.slice(1)}`;
  if (!number.startsWith("964") && number.length >= 10) {
    number = `964${number}`;
  }
  return number;
}

/** يختار رقم الإرسال من JID إن وُجد (@s.whatsapp.net) */
export function resolveEvolutionSendNumber(
  rawPhone: string,
  numberCheck: { jid?: string }
): { number: string; lidJid?: string } {
  const fallback = formatEvolutionApiNumber(rawPhone);
  const jid = numberCheck.jid?.trim();
  if (!jid) return { number: fallback };
  if (jid.includes("@lid")) return { number: fallback, lidJid: jid };
  if (jid.endsWith("@s.whatsapp.net")) {
    const digits = jid.split("@")[0]?.replace(/\D/g, "");
    if (digits) return { number: digits };
  }
  return { number: fallback };
}

export type EvolutionInstanceSummary = {
  name: string;
  connected: boolean;
  phone: string | null;
  profileName: string | null;
  messageCount: number | null;
};

/** قائمة مختصرة بكل instances — للتشخيص */
export async function summarizeEvolutionInstances(): Promise<
  EvolutionInstanceSummary[]
> {
  const listRes = await evolutionFetch("/instance/fetchInstances", {
    method: "GET",
  });
  if (!listRes.ok) return [];

  return parseInstanceList(listRes.data).map((row) => {
    const name = String(row.name ?? row.instanceName ?? "").trim();
    const statusRaw =
      typeof row.connectionStatus === "string"
        ? row.connectionStatus
        : row.connectionStatus &&
            typeof row.connectionStatus === "object" &&
            "state" in row.connectionStatus
          ? String((row.connectionStatus as { state?: string }).state ?? "")
          : "";
    const connected =
      parseConnectionState({ connectionStatus: statusRaw }) === "open";
    const { linkedPhone } = extractEvolutionLinkedPhone(name, null, [row]);
    const messageCount =
      row && typeof row === "object" && "messageCount" in row
        ? Number((row as { messageCount?: number }).messageCount)
        : null;

    return {
      name,
      connected,
      phone: linkedPhone,
      profileName:
        typeof row.profileName === "string" ? row.profileName.trim() : null,
      messageCount: Number.isFinite(messageCount) ? messageCount : null,
    };
  });
}

function parseEvolutionMessageStatus(data: unknown): string | null {
  if (!data || typeof data !== "object") return null;
  const status = (data as Record<string, unknown>).status;
  return typeof status === "string" && status.trim() ? status.trim() : null;
}

function extractEvolutionMessageKey(
  data: unknown
): { id?: string; remoteJid?: string } | null {
  if (!data || typeof data !== "object") return null;
  const key = (data as Record<string, unknown>).key;
  if (!key || typeof key !== "object") return null;
  const row = key as Record<string, unknown>;
  return {
    id: typeof row.id === "string" ? row.id : undefined,
    remoteJid: typeof row.remoteJid === "string" ? row.remoteJid : undefined,
  };
}

function shouldRestartEvolutionBeforeSend(): boolean {
  return process.env.WHATSAPP_RESTART_BEFORE_SEND === "true";
}

/** إعادة تشغيل اتصال Baileys بدون logout (أفضل من QR المتكرر) */
export async function restartEvolutionConnection(
  instanceName: string
): Promise<{ ok: boolean; error?: string }> {
  const name = instanceName.trim();
  if (!name) return { ok: false, error: "instance_name_required" };

  const res = await evolutionFetch(
    `/instance/restart/${encodeURIComponent(name)}`,
    { method: "POST" }
  );

  if (!res.ok) {
    const msg =
      typeof res.data === "object" && res.data && "message" in (res.data as object)
        ? String((res.data as { message: string }).message)
        : res.text.slice(0, 300);
    return { ok: false, error: msg || `HTTP ${res.status}` };
  }

  await new Promise((r) => setTimeout(r, 4500));
  invalidateEvolutionSessionCache(name);
  return { ok: true };
}

async function sendEvolutionComposingPresence(
  instanceName: string,
  number: string
): Promise<void> {
  await evolutionFetch(
    `/chat/sendPresence/${encodeURIComponent(instanceName)}`,
    {
      method: "POST",
      body: JSON.stringify({
        number,
        presence: "composing",
        delay: 800,
      }),
    }
  );
}

async function pollEvolutionMessageDeliveryStatus(
  instanceName: string,
  messageId: string,
  remoteJid: string,
  maxMs = 6_000
): Promise<string | null> {
  const started = Date.now();
  while (Date.now() - started < maxMs) {
    const res = await evolutionFetch(
      `/chat/findStatusMessage/${encodeURIComponent(instanceName)}`,
      {
        method: "POST",
        body: JSON.stringify({
          where: { id: messageId, remoteJid, fromMe: true },
          limit: 1,
        }),
      }
    );

    if (res.ok) {
      const rows = Array.isArray(res.data)
        ? res.data
        : res.data && typeof res.data === "object"
          ? (((res.data as Record<string, unknown>).messages as unknown[]) ??
            ((res.data as Record<string, unknown>).data as unknown[]) ??
            (Array.isArray((res.data as Record<string, unknown>).response)
              ? ((res.data as Record<string, unknown>).response as unknown[])
              : []))
          : [];

      const row = rows[0] as Record<string, unknown> | undefined;
      if (row && typeof row === "object") {
        const status = String(row.status ?? "").toUpperCase();
        if (
          status === "DELIVERY_ACK" ||
          status === "READ" ||
          status === "SERVER_ACK"
        ) {
          return status;
        }
        if (status === "ERROR" || status === "FAILED") {
          return "ERROR";
        }
      }
    }

    await new Promise((r) => setTimeout(r, 2000));
  }

  return null;
}

/** هل الرقم مسجّل على واتساب؟ (Evolution /chat/whatsappNumbers) */
export async function checkEvolutionWhatsAppNumber(
  rawPhone: string,
  options?: { clinicId?: string; instanceName?: string }
): Promise<{ exists: boolean; jid?: string; skipped?: boolean }> {
  const { configured } = getWhatsAppConfig();
  const instanceName =
    options?.instanceName?.trim() ||
    (options?.clinicId
      ? await resolveWhatsAppInstanceForClinic(options.clinicId)
      : await resolveWhatsAppInstanceName());
  if (!configured) return { exists: true, skipped: true };

  const number = formatEvolutionApiNumber(rawPhone);
  const res = await evolutionFetch(
    `/chat/whatsappNumbers/${encodeURIComponent(instanceName)}`,
    {
      method: "POST",
      body: JSON.stringify({ numbers: [number] }),
    }
  );

  if (!res.ok) {
    console.warn(LOG, "whatsappNumbers_check_failed", res.status, res.text.slice(0, 200));
    return { exists: true, skipped: true };
  }

  const rows = Array.isArray(res.data)
    ? res.data
    : res.data && typeof res.data === "object"
      ? (((res.data as Record<string, unknown>).data as unknown[]) ??
        ((res.data as Record<string, unknown>).response as unknown[]) ??
        [])
      : [];

  const row = (rows[0] ?? null) as { exists?: boolean; jid?: string } | null;
  return {
    exists: row?.exists !== false,
    jid: typeof row?.jid === "string" ? row.jid : undefined,
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

  const numberCheck = await checkEvolutionWhatsAppNumber(rawPhone, {
    clinicId: options?.clinicId,
    instanceName,
  });
  if (!numberCheck.skipped && !numberCheck.exists) {
    return {
      ok: false,
      status: 400,
      error: "number_not_on_whatsapp",
      data: numberCheck,
    };
  }

  const sendTarget = resolveEvolutionSendNumber(rawPhone, numberCheck);
  if (sendTarget.lidJid) {
    return {
      ok: false,
      status: 400,
      error: "whatsapp_lid_jid",
      data: { jid: sendTarget.lidJid, numberCheck },
    };
  }

  const sendNumber = numberCheck.jid?.endsWith("@s.whatsapp.net")
    ? numberCheck.jid.split("@")[0] ?? sendTarget.number
    : sendTarget.number;

  await waitForEvolutionSendSlot(instanceName);

  const res = await evolutionFetch(
    `/message/sendText/${encodeURIComponent(instanceName)}`,
    {
      method: "POST",
      body: JSON.stringify({ number: sendNumber, text }),
    }
  );

  if (!res.ok) {
    const err =
      typeof res.data === "object" && res.data && "message" in (res.data as object)
        ? String((res.data as { message: string }).message)
        : res.text.slice(0, 400);
    return { ok: false, status: res.status, error: err, data: res.data };
  }

  const hiddenErr = parseEvolutionSendFailure(res.data);
  if (hiddenErr) {
    return { ok: false, status: res.status, error: hiddenErr, data: res.data };
  }

  return { ok: true, status: res.status, data: res.data };
}

/** إرسال ملف (PDF) عبر Evolution */
export async function sendEvolutionDocument(
  rawPhone: string,
  input: {
    base64: string;
    fileName: string;
    caption?: string;
    mimetype?: string;
  },
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

  const media = input.base64.replace(/^data:application\/pdf;base64,/, "");

  const res = await evolutionFetch(
    `/message/sendMedia/${encodeURIComponent(instanceName)}`,
    {
      method: "POST",
      body: JSON.stringify({
        number,
        mediatype: "document",
        mimetype: input.mimetype ?? "application/pdf",
        fileName: input.fileName,
        caption: input.caption ?? "",
        media,
      }),
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
