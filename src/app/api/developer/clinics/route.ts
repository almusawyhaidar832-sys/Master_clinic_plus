import { NextRequest, NextResponse } from "next/server";
import { requireDeveloperSession } from "@/lib/auth/developer-gate";
import {
  developerApiError,
  getDeveloperAdminClient,
} from "@/lib/api/developer-route";
import { fetchPlatformClinics } from "@/lib/services/developer-platform-data";
import { createPlatformClinic } from "@/lib/services/platform-clinic";

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
    const { clinics, error } = await fetchPlatformClinics(admin);
    if (error) {
      return developerApiError(error, 500);
    }

    return NextResponse.json({ clinics });
  } catch (e) {
    console.error("[api/developer/clinics GET]", e);
    const message = e instanceof Error ? e.message : "خطأ داخلي";
    return developerApiError(message, 500);
  }
}

export async function POST(request: NextRequest) {
  try {
    const session = await requireDeveloperSession(request);
    if ("error" in session) {
      return NextResponse.json(
        { error: session.error },
        { status: session.status }
      );
    }

    const body = await request.json();
    const admin = getDeveloperAdminClient();
    const result = await createPlatformClinic(admin, {
      clinic_name: body.clinic_name,
      clinic_name_ar: body.clinic_name_ar,
      clinic_phone: body.clinic_phone,
      specialty: body.specialty,
      admin_full_name: body.admin_full_name,
      admin_username: body.admin_username,
      admin_password: body.admin_password,
      provision_evolution: body.provision_evolution !== false,
    });

    if (!result.ok) {
      return NextResponse.json(
        { error: result.error },
        { status: result.status }
      );
    }

    return NextResponse.json({
      success: true,
      ...result.data,
      message: `تم إنشاء عيادة «${result.data.clinic_name}» — دخول المالك: ${result.data.admin_username}${
        result.data.instance_name
          ? ` — Evolution: ${result.data.instance_name}`
          : ""
      }`,
    });
  } catch (e) {
    console.error("[api/developer/clinics POST]", e);
    const message = e instanceof Error ? e.message : "خطأ داخلي";
    return developerApiError(message, 500);
  }
}
