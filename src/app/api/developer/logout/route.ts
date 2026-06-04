import { NextResponse } from "next/server";
import { DEVELOPER_COOKIE } from "@/lib/auth/developer-gate";

export async function POST() {
  const res = NextResponse.json({ ok: true });
  res.cookies.set(DEVELOPER_COOKIE, "", { path: "/", maxAge: 0 });
  return res;
}
