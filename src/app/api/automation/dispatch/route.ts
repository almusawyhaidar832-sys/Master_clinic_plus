import { NextRequest, NextResponse } from "next/server";
import { getApiCallerProfile } from "@/lib/auth/api-session";
import {
  runSessionSavedAutomation,
  runXrayUploadedAutomation,
} from "@/lib/automation/run";

/**
 * POST /api/automation/dispatch
 * Body:
 *   { event: "session_saved", operationId: string, treatmentCompleted?: boolean }
 *   { event: "xray_uploaded", operationId: string, storagePath: string, fileName?: string }
 */
function isInternalAutomation(req: NextRequest): boolean {
  const secret = process.env.INTERNAL_AUTOMATION_SECRET?.trim();
  if (!secret) return false;
  const auth = req.headers.get("authorization") ?? "";
  return auth === `Bearer ${secret}`;
}

export async function POST(req: NextRequest) {
  try {
    const internal = isInternalAutomation(req);
    const profile = internal ? null : await getApiCallerProfile();
    if (!internal && !profile?.clinic_id) {
      return NextResponse.json({ error: "غير مصرح" }, { status: 401 });
    }

    const body = await req.json();
    const {
      event,
      operationId,
      treatmentCompleted,
      storagePath,
      fileName,
      skipPatientWhatsApp,
    } = body as {
      event: string;
      operationId?: string;
      treatmentCompleted?: boolean;
      storagePath?: string;
      fileName?: string | null;
      skipPatientWhatsApp?: boolean;
    };

    if (!event || !operationId) {
      return NextResponse.json(
        { error: "event و operationId مطلوبان" },
        { status: 400 }
      );
    }

    switch (event) {
      case "session_saved": {
        const result = await runSessionSavedAutomation(operationId, {
          treatmentCompleted: Boolean(treatmentCompleted),
          skipPatientWhatsApp: Boolean(skipPatientWhatsApp),
        });
        return NextResponse.json({
          success: true,
          ok: result.ok,
          errors: result.errors,
          whatsapp: result.whatsapp,
        });
      }
      case "xray_uploaded": {
        if (!storagePath) {
          return NextResponse.json(
            { error: "storagePath مطلوب" },
            { status: 400 }
          );
        }
        const result = await runXrayUploadedAutomation(
          operationId,
          storagePath,
          fileName
        );
        return NextResponse.json({
          success: result.ok,
          error: result.error,
        });
      }
      default:
        return NextResponse.json({ error: "حدث غير معروف" }, { status: 400 });
    }
  } catch (err) {
    console.error("[automation/dispatch]", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "خطأ" },
      { status: 500 }
    );
  }
}
