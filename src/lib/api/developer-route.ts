import { NextResponse } from "next/server";
import { getAdminClient } from "@/lib/supabase/admin";

export function developerApiError(message: string, status = 500) {
  return NextResponse.json({ error: message }, { status });
}

export function getDeveloperAdminClient() {
  try {
    return getAdminClient();
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Supabase admin غير مضبوط";
    throw new Error(msg);
  }
}

export async function withDeveloperAdmin<T>(
  handler: (admin: ReturnType<typeof getAdminClient>) => Promise<T>
): Promise<NextResponse> {
  try {
    const admin = getDeveloperAdminClient();
    const result = await handler(admin);
    return NextResponse.json(result);
  } catch (e) {
    console.error("[developer-api]", e);
    const message =
      e instanceof Error ? e.message : "خطأ داخلي في خادم المطور";
    return developerApiError(message, 500);
  }
}
