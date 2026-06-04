/**
 * توكن جلسة المدير العام — Web Crypto فقط (يعمل في Edge middleware و Node).
 */

export const DEVELOPER_COOKIE = "mcp_platform_developer";
export const DEVELOPER_CLINIC_HEADER = "x-mcp-developer-clinic-id";

const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000;

export type DeveloperSession = {
  email: string;
  exp: number;
  actingClinicId: string | null;
};

function envValue(key: string): string {
  return (process.env[key] ?? "").trim().replace(/\r$/, "");
}

export function getPlatformDeveloperEmail(): string {
  return (
    envValue("ADMIN_EMAIL").toLowerCase() ||
    envValue("PLATFORM_DEVELOPER_EMAIL").toLowerCase() ||
    ""
  );
}

export function getPlatformDeveloperSecret(): string | null {
  const secret = envValue("PLATFORM_DEVELOPER_SECRET");
  if (!secret || secret.length < 16) return null;
  return secret;
}

function bytesToBase64Url(bytes: Uint8Array): string {
  if (typeof Buffer !== "undefined") {
    return Buffer.from(bytes).toString("base64url");
  }
  let binary = "";
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]!);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function stringToBase64Url(str: string): string {
  return bytesToBase64Url(new TextEncoder().encode(str));
}

function base64UrlToString(b64: string): string {
  if (typeof Buffer !== "undefined") {
    return Buffer.from(b64, "base64url").toString("utf8");
  }
  const pad =
    b64.length % 4 === 0 ? "" : "=".repeat(4 - (b64.length % 4));
  const std = b64.replace(/-/g, "+").replace(/_/g, "/") + pad;
  const binary = atob(std);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return new TextDecoder().decode(bytes);
}

async function hmacSha256Base64Url(
  secret: string,
  data: string
): Promise<string> {
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw",
    enc.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const sig = await crypto.subtle.sign("HMAC", key, enc.encode(data));
  return bytesToBase64Url(new Uint8Array(sig));
}

function timingSafeEqualStr(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) {
    diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return diff === 0;
}

export async function signDeveloperToken(
  payload: Pick<DeveloperSession, "email" | "actingClinicId"> & {
    exp?: number;
  }
): Promise<string | null> {
  const secret = getPlatformDeveloperSecret();
  if (!secret) return null;

  const body: DeveloperSession = {
    email: payload.email.trim().toLowerCase(),
    exp: payload.exp ?? Date.now() + SESSION_TTL_MS,
    actingClinicId: payload.actingClinicId ?? null,
  };

  const data = stringToBase64Url(JSON.stringify(body));
  const sig = await hmacSha256Base64Url(secret, data);
  return `${data}.${sig}`;
}

export async function verifyDeveloperToken(
  token: string | undefined | null
): Promise<DeveloperSession | null> {
  if (!token?.includes(".")) return null;
  const secret = getPlatformDeveloperSecret();
  if (!secret) return null;

  const [data, sig] = token.split(".");
  if (!data || !sig) return null;

  const expected = await hmacSha256Base64Url(secret, data);
  if (!timingSafeEqualStr(sig, expected)) return null;

  try {
    const payload = JSON.parse(base64UrlToString(data)) as DeveloperSession;
    if (!payload.email || payload.exp < Date.now()) return null;
    if (payload.email !== getPlatformDeveloperEmail()) return null;
    return {
      email: payload.email,
      exp: payload.exp,
      actingClinicId: payload.actingClinicId ?? null,
    };
  } catch {
    return null;
  }
}
