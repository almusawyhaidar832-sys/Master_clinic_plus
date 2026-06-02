import type { SupabaseClient } from "@supabase/supabase-js";
import { NextResponse, type NextRequest } from "next/server";
import { getCurrentUser, signOutUser } from "@/lib/supabase/auth-helpers";
import {
  getAuthPortalForPath,
  isRoleAllowedForPath,
  MCP_AUTH_PORTAL_HEADER,
  normalizeRole,
  portalIdFromPath,
} from "@/lib/auth/portal-access";
import { createServerAuthClient } from "@/lib/supabase/create-auth-client";

/**
 * Middleware — session refresh + portal role guard.
 *
 * 1. Unauthenticated user on protected path → /login
 * 2. Authenticated user on wrong portal for their role → signOut + /login
 * 3. Each portal uses a separate auth cookie (no session collision)
 */
export async function updateSession(request: NextRequest) {
  const path = request.nextUrl.pathname;
  const portalId = portalIdFromPath(path) ?? "default";

  const requestHeaders = new Headers(request.headers);
  requestHeaders.set(MCP_AUTH_PORTAL_HEADER, portalId);

  let supabaseResponse = NextResponse.next({
    request: { headers: requestHeaders },
  });

  const cookieMethods = {
    getAll() {
      return request.cookies.getAll();
    },
    setAll(cookiesToSet: { name: string; value: string; options?: object }[]) {
      cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value));
      supabaseResponse = NextResponse.next({
        request: { headers: requestHeaders },
      });
      cookiesToSet.forEach(({ name, value, options }) =>
        supabaseResponse.cookies.set(name, value, options)
      );
    },
  };

  const supabase = createServerAuthClient(
    cookieMethods,
    portalId === "default" ? "default" : portalId
  ) as SupabaseClient;

  const isPublic =
    path === "/" ||
    path.startsWith("/login") ||
    path.startsWith("/booking") ||
    path.startsWith("/queue-screen") ||
    path.startsWith("/api/");

  if (isPublic) {
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
    const url = request.nextUrl.clone();
    url.pathname = "/login";
    const portal = getAuthPortalForPath(path);
    if (portal) url.searchParams.set("portal", portal.loginPortalId);
    return NextResponse.redirect(url);
  }

  const portal = getAuthPortalForPath(path);
  if (portal) {
    const { data: profile } = await activeClient
      .from("profiles")
      .select("role")
      .eq("id", user.id)
      .maybeSingle();

    let role = normalizeRole(profile?.role as string | undefined);
    if (!role) {
      const { data: rpcRole } = await activeClient.rpc("get_my_role");
      role = normalizeRole(rpcRole as string | undefined);
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
