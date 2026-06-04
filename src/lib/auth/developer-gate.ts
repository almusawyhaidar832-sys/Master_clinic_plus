import { scryptSync, timingSafeEqual } from "crypto";
import type { NextRequest } from "next/server";
import {
  DEVELOPER_COOKIE,
  getPlatformDeveloperEmail,
  getPlatformDeveloperSecret,
  verifyDeveloperToken,
  type DeveloperSession,
} from "@/lib/auth/developer-token";

export {
  DEVELOPER_COOKIE,
  DEVELOPER_CLINIC_HEADER,
  getPlatformDeveloperEmail,
  getPlatformDeveloperSecret,
  signDeveloperToken,
  verifyDeveloperToken,
  type DeveloperSession,
} from "@/lib/auth/developer-token";

const SCRYPT_KEY_LEN = 64;

function envValue(key: string): string {
  return (process.env[key] ?? "").trim().replace(/\r$/, "");
}

export function isDeveloperAuthConfigured(): boolean {
  const email = getPlatformDeveloperEmail();
  const secret = getPlatformDeveloperSecret();
  const hasPassword =
    Boolean(
      envValue("PLATFORM_DEVELOPER_PASSWORD_HASH") ||
        envValue("ADMIN_PASSWORD_HASH")
    ) ||
    Boolean(
      envValue("PLATFORM_DEVELOPER_PASSWORD") || envValue("ADMIN_PASSWORD")
    );
  return Boolean(email && secret && hasPassword);
}

/** لتوليد HASH: node scripts/hash-developer-password.mjs "..." */
export function hashDeveloperPassword(password: string): string | null {
  const secret = getPlatformDeveloperSecret();
  if (!secret || !password) return null;
  return scryptSync(password, secret, SCRYPT_KEY_LEN).toString("hex");
}

export function verifyDeveloperPassword(password: string): boolean {
  if (!password) return false;
  const secret = getPlatformDeveloperSecret();
  if (!secret) return false;

  const hashHex =
    envValue("PLATFORM_DEVELOPER_PASSWORD_HASH") ||
    envValue("ADMIN_PASSWORD_HASH");

  if (hashHex) {
    try {
      const computed = scryptSync(password, secret, SCRYPT_KEY_LEN);
      const expected = Buffer.from(hashHex, "hex");
      if (computed.length !== expected.length) return false;
      return timingSafeEqual(computed, expected);
    } catch {
      return false;
    }
  }

  const plain =
    envValue("PLATFORM_DEVELOPER_PASSWORD") || envValue("ADMIN_PASSWORD");
  if (!plain) return false;
  if (password.length !== plain.length) return false;
  try {
    return timingSafeEqual(Buffer.from(password), Buffer.from(plain));
  } catch {
    return password === plain;
  }
}

export function verifyDeveloperEmailInput(email: string): boolean {
  const normalized = email.trim().toLowerCase();
  const expected = getPlatformDeveloperEmail();
  if (!expected || normalized.length !== expected.length) return false;
  try {
    return timingSafeEqual(Buffer.from(normalized), Buffer.from(expected));
  } catch {
    return normalized === expected;
  }
}

export function getDeveloperTokenFromRequest(
  request: NextRequest
): string | undefined {
  return request.cookies.get(DEVELOPER_COOKIE)?.value;
}

export async function getDeveloperSessionFromRequest(
  request: NextRequest
): Promise<DeveloperSession | null> {
  return verifyDeveloperToken(getDeveloperTokenFromRequest(request));
}

export function developerCookieOptions(maxAgeSec = 30 * 24 * 60 * 60) {
  return {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "strict" as const,
    path: "/",
    maxAge: maxAgeSec,
  };
}

export async function requireDeveloperSession(
  request: NextRequest
): Promise<DeveloperSession | { error: string; status: number }> {
  if (!isDeveloperAuthConfigured()) {
    return {
      error:
        "بوابة المدير العام غير مفعّلة — أضف ADMIN_EMAIL و PLATFORM_DEVELOPER_SECRET و PLATFORM_DEVELOPER_PASSWORD_HASH في .env",
      status: 503,
    };
  }
  const session = await getDeveloperSessionFromRequest(request);
  if (!session) {
    return { error: "غير مصرح — سجّل دخول المطور", status: 401 };
  }
  return session;
}
