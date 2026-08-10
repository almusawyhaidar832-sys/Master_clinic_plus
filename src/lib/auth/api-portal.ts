import {
  AUTH_PORTALS,
  MCP_AUTH_PORTAL_HEADER,
  normalizeRole,
  portalIdFromPath,
  type AuthPortalId,
} from "@/lib/auth/portal-access";
import { isStaffRole } from "@/lib/withdrawals/update-status-client";

/** Prefer portal from client header or Referer — avoids wrong session when multiple portals are logged in */
export function resolvePortalFromRequest(req?: Request): AuthPortalId | null {
  if (!req) return null;

  const header =
    req.headers.get("x-auth-portal") ??
    req.headers.get(MCP_AUTH_PORTAL_HEADER);
  if (header && header in AUTH_PORTALS) {
    return header as AuthPortalId;
  }

  const referer = req.headers.get("referer") ?? "";
  try {
    return portalIdFromPath(new URL(referer).pathname);
  } catch {
    return null;
  }
}

/** Accountant / owner — accepts legacy role alias "admin" */
export function isApiStaffRole(role: string | null | undefined): boolean {
  if (isStaffRole(role)) return true;
  const normalized = normalizeRole(role);
  return normalized === "accountant" || normalized === "super_admin";
}

export function isApiDoctorRole(role: string | null | undefined): boolean {
  return normalizeRole(role) === "doctor";
}

export function isApiAssistantRole(role: string | null | undefined): boolean {
  return normalizeRole(role) === "assistant";
}

/** Headers for client fetch — pin the correct portal session on API routes */
export function authPortalHeaders(
  portal: AuthPortalId
): Record<string, string> {
  return { "x-auth-portal": portal };
}

/**
 * بوابة الصفحة الحالية في المتصفح — للمكوّنات المشتركة بين أكثر من بوابة
 * (مثل كشف الحساب اليومي وطلبات السحب). تثبيت بوابة واحدة فيها يكسرها عند
 * البوابة الأخرى لأن كل بوابة لها كوكي جلسة مستقل.
 */
export function currentAuthPortal(
  fallback: AuthPortalId = "accountant"
): AuthPortalId {
  if (typeof window === "undefined") return fallback;
  return portalIdFromPath(window.location.pathname) ?? fallback;
}
