import { NextRequest, NextResponse } from "next/server";
import {
  createApiSessionClient,
  getApiCallerProfile,
  isApiAssistantRole,
  isApiStaffRole,
} from "@/lib/auth/api-session";
import { getAdminClient } from "@/lib/supabase/admin";
import { getClinicDisplayName } from "@/lib/services/clinic-profile";
import { sendUnifiedWhatsApp } from "@/lib/automation/notification-service";
import { isPersistedTreatmentCaseId } from "@/lib/services/patient-treatment-cases";
import { getPatientDisplayPhone } from "@/lib/phone";
import {
  resolveWhatsAppClinic,
  whatsappNoClinicError,
} from "@/lib/whatsapp/resolve-clinic";

/** POST { operation_id, phone? } — رسالة كاملة: مخطط + ملاحظات + أشعة + مبالغ */
export async function POST(req: NextRequest) {
  try {
    const profile = await getApiCallerProfile(req);
    if (!profile?.clinic_id) {
      return NextResponse.json({ error: "غير مصرح" }, { status: 401 });
    }

    const role = String(profile.role ?? "");
    if (!isApiStaffRole(role) && !isApiAssistantRole(role)) {
      return NextResponse.json({ error: "غير مصرح" }, { status: 403 });
    }

    const body = await req.json().catch(() => ({}));
    const operationId = String(body?.operation_id ?? "").trim();
    if (!operationId) {
      return NextResponse.json({ error: "operation_id مطلوب" }, { status: 400 });
    }

    const supabase = await createApiSessionClient(req);
    const resolved = await resolveWhatsAppClinic(supabase, profile.clinic_id);
    if (!resolved) {
      return NextResponse.json(whatsappNoClinicError(), { status: 400 });
    }

    const admin = getAdminClient();
    const { data: op } = await admin
      .from("patient_operations")
      .select(
        `id, clinic_id, patient_id, doctor_id, treatment_case_id,
         patient:patients(full_name_ar, phone, phone_number),
         doctor:doctors(full_name_ar)`
      )
      .eq("id", operationId)
      .eq("clinic_id", profile.clinic_id)
      .maybeSingle();

    if (!op) {
      return NextResponse.json({ error: "الجلسة غير موجودة" }, { status: 404 });
    }

    const patient = op.patient as {
      full_name_ar?: string;
      phone?: string | null;
      phone_number?: string | null;
    } | null;
    const doctor = op.doctor as { full_name_ar?: string } | null;

    const phone =
      String(body?.phone ?? "").trim() ||
      getPatientDisplayPhone(patient ?? {}) ||
      "";

    if (!phone) {
      return NextResponse.json(
        { error: "لا يوجد رقم جوال للمراجع" },
        { status: 400 }
      );
    }

    const caseId = String(op.treatment_case_id ?? "").trim() || null;
    const clinicName = getClinicDisplayName(resolved.clinic);

    const queueEntryId = String(body?.queue_entry_id ?? "").trim() || null;

    const wa = await sendUnifiedWhatsApp({
      supabase: admin,
      operationId,
      caseId: caseId && isPersistedTreatmentCaseId(caseId) ? caseId : null,
      clinicId: resolved.clinicId,
      clinicName,
      patientName: patient?.full_name_ar?.trim() || "مراجع",
      doctorName: doctor?.full_name_ar?.trim() || "فريقنا الطبي",
      patientPhone: phone,
      skipDoctor: true,
      patientMessageType: "session_update",
      queueEntryId,
    });

    if (!wa.patientSent && !wa.patientPending) {
      return NextResponse.json(
        {
          error: wa.errors[0] ?? "تعذر إرسال الواتساب",
          configured: !wa.errors.includes("whatsapp_not_configured"),
        },
        { status: 502 }
      );
    }

    return NextResponse.json({
      ok: true,
      message: wa.patientBody,
      status: wa.patientPending ? "pending" : "sent",
      configured: !wa.patientPending || wa.errors.length === 0,
    });
  } catch (err) {
    console.error("[whatsapp/send-session]", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "خطأ" },
      { status: 500 }
    );
  }
}
