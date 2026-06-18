import type { SupabaseClient } from "@supabase/supabase-js";
import { NextResponse, type NextRequest } from "next/server";
import { getCurrentUser, signOutUser } from "@/lib/supabase/auth-helpers";
import {
  defaultPathForRole,
  getAuthPortalForPath,
  isRoleAllowedForPath,
  MCP_AUTH_PORTAL_HEADER,
  normalizeRole,
  portalIdFromPath,
} from "@/lib/auth/portal-access";
import {
  createServerAuthClient,
  createServerAuthClientFromAnySession,
} from "@/lib/supabase/create-auth-client";
import {
  DEVELOPER_CLINIC_HEADER,
  DEVELOPER_COOKIE,
  verifyDeveloperToken,
} from "@/lib/auth/developer-token";

/**
 * Middleware — session refresh + portal role guard.
 *
 * 1. Unauthenticated user on protected path → /login
 * 2. Authenticated user on wrong portal for their role → signOut + /login
 * 3. Each portal uses a separate auth cookie (no session collision)
 */
const PLATFORM_ADMIN_LOGIN_PATHS = ["/admin-login", "/developer/login"] as const;

function isPlatformAdminLoginPath(path: string): boolean {
  return (PLATFORM_ADMIN_LOGIN_PATHS as readonly string[]).includes(path);
}

type CookieMethods = {
  getAll: () => { name: string; value: string }[];
  setAll: (cookies: { name: string; value: string; options?: object }[]) => void;
};

async function resolveLandingPath(
  cookieMethods: CookieMethods
): Promise<string | null> {
  const anyClient = (await createServerAuthClientFromAnySession(
    cookieMethods
  )) as SupabaseClient;
  const user = await getCurrentUser(anyClient);
  if (!user) return null;

  const { data: profile, error: profileError } = await anyClient
    .from("profiles")
    .select("role")
    .eq("id", user.id)
    .maybeSingle();

  let role = normalizeRole(profile?.role as string | undefined);
  if (!role && !profileError) {
    const { data: rpcRole } = await anyClient.rpc("get_my_role");
    role = normalizeRole(rpcRole as string | undefined);
  }

  const landing = defaultPathForRole(role);
  return landing !== "/login" ? landing : null;
}

export async function updateSession(request: NextRequest) {
  const path = request.nextUrl.pathname;
  const devToken = request.cookies.get(DEVELOPER_COOKIE)?.value;
  const devSession = await verifyDeveloperToken(devToken);

  if (isPlatformAdminLoginPath(path)) {
    if (devSession) {
      return NextResponse.redirect(new URL("/developer", request.url));
    }
    return NextResponse.next();
  }

  if (path.startsWith("/developer")) {
    if (!devSession) {
      return NextResponse.redirect(new URL("/admin-login", request.url));
    }

    const headers = new Headers(request.headers);
    if (devSession.actingClinicId) {
      headers.set(DEVELOPER_CLINIC_HEADER, devSession.actingClinicId);
    }
    return NextResponse.next({ request: { headers } });
  }

  const portalId = portalIdFromPath(path) ?? "default";

  const requestHeaders = new Headers(request.headers);
  requestHeaders.set(MCP_AUTH_PORTAL_HEADER, portalId);
  if (devSession?.actingClinicId) {
    requestHeaders.set(DEVELOPER_CLINIC_HEADER, devSession.actingClinicId);
  }

  let supabaseResponse = NextResponse.next({
    request: { headers: requestHeaders },
  });

  const pendingCookies: {
    name: string;
    value: string;
    options?: object;
  }[] = [];

  const cookieMethods: CookieMethods = {
    getAll() {
      return request.cookies.getAll();
    },
    setAll(cookiesToSet: { name: string; value: string; options?: object }[]) {
      cookiesToSet.forEach((entry) => pendingCookies.push(entry));
      cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value));
      supabaseResponse = NextResponse.next({
        request: { headers: requestHeaders },
      });
      cookiesToSet.forEach(({ name, value, options }) =>
        supabaseResponse.cookies.set(name, value, options)
      );
    },
  };

  function withPendingCookies(response: NextResponse) {
    pendingCookies.forEach(({ name, value, options }) => {
      response.cookies.set(name, value, options);
    });
    return response;
  }

  const supabase = createServerAuthClient(
    cookieMethods,
    portalId === "default" ? "default" : portalId
  ) as SupabaseClient;

  const developerDashboardBypass =
    Boolean(devSession?.actingClinicId) &&
    (path.startsWith("/dashboard") || path.startsWith("/api/whatsapp"));

  const isPublic =
    path === "/" ||
    path.startsWith("/login") ||
    path.startsWith("/booking") ||
    path.startsWith("/queue-screen") ||
    path === "/admin-login" ||
    path.startsWith("/developer/login") ||
    path.startsWith("/api/");

  if (isPublic || developerDashboardBypass) {
    if (path === "/" || path.startsWith("/login")) {
      const landing = await resolveLandingPath(cookieMethods);
      if (landing) {
        return withPendingCookies(
          NextResponse.redirect(new URL(landing, request.url))
        );
      }
      if (path === "/") {
        return NextResponse.redirect(new URL("/login", request.url));
      }
    }

    await getCurrentUser(supabase);
    return supabaseResponse;
  }

  let activeClient = supabase;
  let user = await getCurrentUser(supabase);

  // Legacy: session stored under the default cookie before portal-scoped keys
  if (!user && portalId !== "default") {
    const legacy = createServerAuthClient(cookieMethods, "default") as SupabaseClient;
    const legacyUser = await getCurrentUser(legacy);
    if (legacyUser) {
      user = legacyUser;
      activeClient = legacy;
    }
  }

  if (!user) {
    const anyClient = (await createServerAuthClientFromAnySession(
      cookieMethods
    )) as SupabaseClient;
    const anyUser = await getCurrentUser(anyClient);
    if (anyUser) {
      user = anyUser;
      activeClient = anyClient;
    }
  }

  if (!user) {
    const url = request.nextUrl.clone();
    url.pathname = "/login";
    const portal = getAuthPortalForPath(path);
    if (portal) url.searchParams.set("portal", portal.loginPortalId);
    return NextResponse.redirect(url);
  }

  const portal = getAuthPortalForPath(path);
  if (portal) {
    const { data: profile, error: profileError } = await activeClient
      .from("profiles")
      .select("role")
      .eq("id", user.id)
      .maybeSingle();

    let role = normalizeRole(profile?.role as string | undefined);
    if (!role && !profileError) {
      const { data: rpcRole } = await activeClient.rpc("get_my_role");
      role = normalizeRole(rpcRole as string | undefined);
    }

    // DB unreachable — keep local session so PWA pages stay usable offline
    if (!role && profileError) {
      return supabaseResponse;
    }

    if (!isRoleAllowedForPath(role, path)) {
      await signOutUser(activeClient);
      if (activeClient !== supabase) await signOutUser(supabase);
      const url = request.nextUrl.clone();
      url.pathname = "/login";
      url.searchParams.set("portal", portal.loginPortalId);
      url.searchParams.set("reason", "role_mismatch");
      return NextResponse.redirect(url);
    }
  }

  return supabaseResponse;
}
