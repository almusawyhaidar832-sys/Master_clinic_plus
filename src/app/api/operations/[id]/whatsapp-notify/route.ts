import { NextRequest, NextResponse } from "next/server";
import {
  createApiSessionClient,
  getApiCallerProfile,
} from "@/lib/auth/api-session";
import { getAdminClient } from "@/lib/supabase/admin";
import { loadSessionAutomationContext } from "@/lib/automation/session-context";
import { sendPatientSessionWhatsApp } from "@/lib/automation/run";

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
    try {
      const body = await req.json();
      treatmentCompleted = body?.treatmentCompleted === true;
    } catch {
      /* empty body */
    }

    const userSupabase = await createApiSessionClient();
    const ctx = await loadSessionAutomationContext(id, userSupabase);
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

    const result = await sendPatientSessionWhatsApp(id, { treatmentCompleted });

    return NextResponse.json({
      success: true,
      whatsapp: result,
      messageType: result.sent
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
