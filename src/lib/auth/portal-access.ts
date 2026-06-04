import type { UserRole } from "@/types";

/** Login card id → internal portal id */
export type AuthPortalId = "doctor" | "accountant" | "admin";

export interface AuthPortal {
  id: AuthPortalId;
  pathPrefix: string;
  allowedRoles: UserRole[];
  loginPortalId: string;
}

export const AUTH_PORTALS: Record<AuthPortalId, AuthPortal> = {
  doctor: {
    id: "doctor",
    pathPrefix: "/doctor",
    allowedRoles: ["doctor"],
    loginPortalId: "doctor",
  },
  accountant: {
    id: "accountant",
    pathPrefix: "/dashboard",
    allowedRoles: ["accountant", "super_admin"],
    loginPortalId: "accountant",
  },
  admin: {
    id: "admin",
    pathPrefix: "/admin",
    allowedRoles: ["super_admin"],
    loginPortalId: "admin",
  },
};

const PORTAL_ORDER: AuthPortalId[] = ["doctor", "accountant", "admin"];

/** Legacy alias in some rows */
export function normalizeRole(
  role: string | null | undefined
): UserRole | null {
  const r = String(role ?? "")
    .trim()
    .toLowerCase();
  if (r === "admin") return "super_admin";
  if (r === "super_admin" || r === "accountant" || r === "doctor") return r;
  return null;
}

export function portalIdFromPath(pathname: string): AuthPortalId | null {
  if (pathname.startsWith("/doctor")) return "doctor";
  if (pathname.startsWith("/admin")) return "admin";
  if (pathname.startsWith("/dashboard")) return "accountant";
  return null;
}

export function getAuthPortalForPath(pathname: string): AuthPortal | null {
  const id = portalIdFromPath(pathname);
  return id ? AUTH_PORTALS[id] : null;
}

/** مسارات تعديل كلمة مرور الحساب — ليست إعدادات العيادة */
export function isProfileSettingsPath(pathname: string): boolean {
  return (
    pathname === "/doctor/profile" ||
    pathname === "/admin/profile" ||
    pathname === "/dashboard/profile"
  );
}

/** المدير (super_admin) والطبيب فقط — المحاسب ممنوع */
export function canRoleChangeOwnPassword(
  role: string | null | undefined
): boolean {
  const normalized = normalizeRole(role);
  return normalized === "doctor" || normalized === "super_admin";
}

export function isRoleAllowedForPath(
  role: string | null | undefined,
  pathname: string
): boolean {
  const normalized = normalizeRole(role);
  if (!normalized) return false;

  if (isProfileSettingsPath(pathname)) {
    return canRoleChangeOwnPassword(normalized);
  }

  const portal = getAuthPortalForPath(pathname);
  if (!portal) return true;
  return portal.allowedRoles.includes(normalized);
}

export function loginPortalToAuthPortalId(
  loginPortalId: string
): AuthPortalId | null {
  if (loginPortalId === "doctor") return "doctor";
  if (loginPortalId === "accountant") return "accountant";
  if (loginPortalId === "admin") return "admin";
  return null;
}

function supabaseProjectRef(): string {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
  const match = url.match(/https?:\/\/([^.]+)/);
  return match?.[1] ?? "masterclinic";
}

/** Separate auth storage per portal — avoids session overwrite between tabs */
export function authStorageKeyForPortal(
  portalId: AuthPortalId | "default"
): string {
  const ref = supabaseProjectRef();
  if (portalId === "default") return `sb-${ref}-auth-token`;
  return `sb-${ref}-${portalId}-auth-token`;
}

export function allAuthStorageKeys(): string[] {
  return [
    authStorageKeyForPortal("default"),
    ...PORTAL_ORDER.map((id) => authStorageKeyForPortal(id)),
  ];
}

export const MCP_AUTH_PORTAL_HEADER = "x-mcp-auth-portal";
