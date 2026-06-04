import { NextRequest, NextResponse } from "next/server";
import { requireDeveloperSession } from "@/lib/auth/developer-gate";
import {
  developerApiError,
  getDeveloperAdminClient,
} from "@/lib/api/developer-route";
import { fetchPlatformStats } from "@/lib/services/developer-platform-data";

export const runtime = "nodejs";

export async function GET(request: NextRequest) {
  try {
    const session = await requireDeveloperSession(request);
    if ("error" in session) {
      return NextResponse.json(
        { error: session.error },
        { status: session.status }
      );
    }

    const admin = getDeveloperAdminClient();
    const stats = await fetchPlatformStats(admin);
    if (stats.error) {
      return developerApiError(stats.error, 500);
    }

    return NextResponse.json({
      totalClinics: stats.totalClinics,
      activeClinics: stats.activeClinics,
      totalPatients: stats.totalPatients,
      whatsappConnected: stats.whatsappConnected,
    });
  } catch (e) {
    console.error("[api/developer/stats]", e);
    const message = e instanceof Error ? e.message : "خطأ داخلي";
    return developerApiError(message, 500);
  }
}
