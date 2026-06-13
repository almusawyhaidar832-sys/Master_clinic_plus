import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";
import { performPortalLogin, portalLoginDestination } from "@/lib/auth/portal-login";
import { createServerAuthClient } from "@/lib/supabase/create-auth-client";
import { loginPortalToAuthPortalId } from "@/lib/auth/portal-access";

/**
 * Portal login via server cookies — reliable on mobile Safari/PWA where
 * client-only signIn can redirect before the session cookie is persisted.
 */
export async function POST(request: NextRequest) {
  let body: { username?: string; password?: string; portal?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "طلب غير صالح" }, { status: 400 });
  }

  const username = String(body.username ?? "").trim();
  const password = String(body.password ?? "");
  const portal = String(body.portal ?? "doctor");
  const destination = portalLoginDestination(portal);

  if (!destination) {
    return NextResponse.json({ error: "بوابة الدخول غير معروفة" }, { status: 400 });
  }

  const authPortal = loginPortalToAuthPortalId(portal)!;
  const cookieStore = await cookies();
  const responseCookies: {
    name: string;
    value: string;
    options?: object;
  }[] = [];

  const supabase = createServerAuthClient(
    {
      getAll: () => cookieStore.getAll(),
      setAll: (cookiesToSet) => {
        cookiesToSet.forEach((entry) => responseCookies.push(entry));
        try {
          cookiesToSet.forEach(({ name, value, options }) =>
            cookieStore.set(name, value, options)
          );
        } catch {
          /* ignore when cookie store is read-only */
        }
      },
    },
    authPortal
  );

  const result = await performPortalLogin(supabase, {
    username,
    password,
    portal,
    destination,
  });

  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: result.status });
  }

  const response = NextResponse.json({
    ok: true,
    role: result.role,
    redirect: result.redirect,
  });

  responseCookies.forEach(({ name, value, options }) => {
    response.cookies.set(name, value, options);
  });

  return response;
}
