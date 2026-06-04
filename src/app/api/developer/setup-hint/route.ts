import { NextResponse } from "next/server";
import {
  getPlatformDeveloperEmail,
  isDeveloperAuthConfigured,
} from "@/lib/auth/developer-gate";

function maskEmail(email: string): string {
  const at = email.indexOf("@");
  if (at < 2) return "***";
  return `${email.slice(0, 2)}***${email.slice(at)}`;
}

/** تلميح آمن للتطوير — أي بريد مسجّل في ADMIN_EMAIL */
export async function GET() {
  if (!isDeveloperAuthConfigured()) {
    return NextResponse.json({
      configured: false,
      emailHint: null,
    });
  }
  const email = getPlatformDeveloperEmail();
  return NextResponse.json({
    configured: true,
    emailHint: maskEmail(email),
    fullEmail:
      process.env.NODE_ENV === "development" ? email : undefined,
  });
}
