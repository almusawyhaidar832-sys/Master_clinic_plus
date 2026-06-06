import { NextRequest, NextResponse } from "next/server";
import {
  createApiSessionClient,
  getApiCallerProfile,
} from "@/lib/auth/api-session";
import { getAdminClient } from "@/lib/supabase/admin";
import {
  loadSessionAutomationContext,
  type WhatsAppMessageSnapshot,
} from "@/lib/automation/session-context";
import { runSessionSavedAutomation } from "@/lib/automation/run";

/** POST — إرسال واتساب المراجع بعد حفظ جلسة (Evolution + instance العيادة) */
export async function POST(
  req: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  try {
    const profile = await getApiCallerProfile();
    if (!profile?.clinic_id) {
      return NextResponse.json({ error: "غير مصرح" }, { status: 401 });
    }

    const { id } = await context.params;
    const admin = getAdminClient();

    const { data: op } = await admin
      .from("patient_operations")
      .select("id, clinic_id")
      .eq("id", id)
      .maybeSingle();

    if (!op || op.clinic_id !== profile.clinic_id) {
      return NextResponse.json({ error: "الجلسة غير موجودة" }, { status: 404 });
    }

    let treatmentCompleted = false;
    let treatmentCaseId: string | null = null;
    let messageSnapshot: WhatsAppMessageSnapshot | null = null;
    try {
      const body = await req.json();
      treatmentCompleted = body?.treatmentCompleted === true;
      if (typeof body?.treatmentCaseId === "string" && body.treatmentCaseId.trim()) {
        treatmentCaseId = body.treatmentCaseId.trim();
      }
      const raw = body?.messageSnapshot;
      if (raw && typeof raw === "object") {
        const rem = Number(raw.remainingBalance);
        const sn = Number(raw.sessionNumber);
        const total = Number(raw.totalSessionsInCase);
        const paid = Number(raw.paidThisSession);
        const finalP = Number(raw.caseFinalPrice);
        const totalPaid = Number(raw.caseTotalPaid);
        const label = String(raw.procedureLabel ?? "").trim();
        if (
          label &&
          (finalP > 0 || rem > 0 || (Number.isFinite(paid) && paid > 0))
        ) {
          messageSnapshot = {
            remainingBalance: Math.max(0, rem),
            sessionNumber:
              Number.isFinite(sn) && sn >= 1 ? Math.max(1, Math.round(sn)) : 0,
            totalSessionsInCase:
              Number.isFinite(total) && total >= 1
                ? Math.max(1, Math.round(total))
                : 0,
            procedureLabel: label,
            paidThisSession: Number.isFinite(paid) ? Math.max(0, paid) : 0,
            caseFinalPrice: Number.isFinite(finalP) ? Math.max(0, finalP) : 0,
            caseTotalPaid: Number.isFinite(totalPaid)
              ? Math.max(0, totalPaid)
              : 0,
          };
        }
      }
    } catch {
      /* empty body */
    }

    const userSupabase = await createApiSessionClient();
    const ctx = await loadSessionAutomationContext(id, userSupabase, {
      treatmentCaseId,
    });
    if (!ctx) {
      return NextResponse.json({
        success: false,
        whatsapp: {
          sent: false,
          errors: ["operation_context_load_failed"],
        },
        error: "تعذر قراءة بيانات الجلسة من قاعدة البيانات",
      });
    }

    const result = await runSessionSavedAutomation(id, {
      treatmentCompleted,
      treatmentCaseId: treatmentCaseId ?? ctx.treatmentCaseId,
      messageSnapshot,
    });

    return NextResponse.json({
      success: true,
      whatsapp: result.whatsapp,
      messageType: result.whatsapp.sent
        ? treatmentCompleted
          ? "treatment_completed"
          : "session_update"
        : null,
    });
  } catch (err) {
    console.error("[operations/whatsapp-notify]", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "خطأ" },
      { status: 500 }
    );
  }
}
