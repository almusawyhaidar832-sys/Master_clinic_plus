import "server-only";
import { cookies } from "next/headers";
import { DEVELOPER_COOKIE, verifyDeveloperToken } from "@/lib/auth/developer-token";
import type { DeveloperSession } from "@/lib/auth/developer-token";

export async function getDeveloperSessionFromCookies(): Promise<DeveloperSession | null> {
  const cookieStore = await cookies();
  return verifyDeveloperToken(cookieStore.get(DEVELOPER_COOKIE)?.value);
}
