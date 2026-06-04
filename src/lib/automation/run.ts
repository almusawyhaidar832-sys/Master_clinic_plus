import "server-only";

import { getAdminClient } from "@/lib/supabase/admin";
import { deliverWhatsAppMessage } from "@/lib/whatsapp/send-message";
import { fetchClinicProfile } from "@/lib/services/clinic-profile";
import {
  notifyDoctorSessionPayment,
} from "@/lib/notifications/server";
import {
  sessionUpdateWhatsAppMessage,
  xrayLinkWhatsAppMessage,
  treatmentStatusAr,
  doctorPaymentAlertMessage,
} from "@/lib/automation/messages";
import { loadSessionAutomationContext } from "@/lib/automation/session-context";

const LOG = "[automation]";

export type SessionSavedOptions = {
  treatmentCompleted?: boolean;
  /** عند true لا يُرسل واتساب للمراجع (مثلاً عند التعديل فقط) */
  skipPatientWhatsApp?: boolean;
};

/** بعد حفظ جلسة — واتساب للمراجع + إشعار الطبيب */
export async function runSessionSavedAutomation(
  operationId: string,
  options: SessionSavedOptions = {}
): Promise<{ ok: boolean; errors: string[] }> {
  const errors: string[] = [];
  const ctx = await loadSessionAutomationContext(operationId);
  if (!ctx) {
    return { ok: false, errors: ["operation_not_found"] };
  }

  const admin = getAdminClient();
  const clinicProfile = await fetchClinicProfile(admin, ctx.clinicId);

  const completed =
    options.treatmentCompleted === true ||
    ctx.treatmentStatus === "completed" ||
    ctx.remainingBalance <= 0;

  const statusLabel = treatmentStatusAr(ctx.treatmentStatus, ctx.remainingBalance);

  if (!options.skipPatientWhatsApp && ctx.patientPhone) {
    const body = sessionUpdateWhatsAppMessage({
      clinic: clinicProfile,
      patientName: ctx.patientName,
      sessionNumber: ctx.sessionNumber,
      paidThisSession: ctx.paidAmount,
      remainingBalance: ctx.remainingBalance,
      treatmentStatus: statusLabel,
      procedureLabel: ctx.procedureLabel,
      teethSummary: ctx.teethSummary || undefined,
      treatmentCompleted: completed,
    });

    const waType = completed ? "treatment_completed" : "session_update";
    const wa = await deliverWhatsAppMessage(admin, {
      clinicId: ctx.clinicId,
      rawPhone: ctx.patientPhone,
      messageBody: body,
      messageType: waType,
    });
    if (!wa.ok && wa.configured) {
      errors.push(`patient_wa:${wa.providerError ?? wa.status}`);
    }
  }

  try {
    await notifyDoctorSessionPayment(operationId, {
      teethSummary: ctx.teethSummary,
      remainingBalance: ctx.remainingBalance,
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    errors.push(`doctor_notify:${msg}`);
    console.error(LOG, "doctor_notify", msg);
  }

  if (ctx.doctorPhone && (ctx.paidAmount > 0 || ctx.sessionKind === "payment")) {
    const alertBody = doctorPaymentAlertMessage({
      patientName: ctx.patientName,
      paidAmount: ctx.paidAmount,
      remainingBalance: ctx.remainingBalance,
      procedureLabel: ctx.procedureLabel,
      teethSummary: ctx.teethSummary || undefined,
      sessionNumber: ctx.sessionNumber,
    });
    const waDoc = await deliverWhatsAppMessage(admin, {
      clinicId: ctx.clinicId,
      rawPhone: ctx.doctorPhone,
      messageBody: alertBody,
      messageType: "doctor_payment_alert",
    });
    if (!waDoc.ok && waDoc.configured) {
      errors.push(`doctor_wa:${waDoc.providerError ?? waDoc.status}`);
    }
  }

  return { ok: errors.length === 0, errors };
}

const XRAY_BUCKET = "clinical-xrays";
const XRAY_LINK_TTL = 60 * 60 * 24;

/** بعد رفع أشعة — رابط للمراجع */
export async function runXrayUploadedAutomation(
  operationId: string,
  storagePath: string,
  fileName?: string | null
): Promise<{ ok: boolean; error?: string }> {
  const ctx = await loadSessionAutomationContext(operationId);
  if (!ctx?.patientPhone) {
    return { ok: false, error: "no_patient_phone" };
  }

  const admin = getAdminClient();
  const { data: signed, error: signErr } = await admin.storage
    .from(XRAY_BUCKET)
    .createSignedUrl(storagePath, XRAY_LINK_TTL);

  if (signErr || !signed?.signedUrl) {
    return { ok: false, error: signErr?.message ?? "signed_url_failed" };
  }

  const clinicProfile = await fetchClinicProfile(admin, ctx.clinicId);
  const body = xrayLinkWhatsAppMessage({
    clinic: clinicProfile,
    patientName: ctx.patientName,
    sessionNumber: ctx.sessionNumber,
    imageUrl: signed.signedUrl,
    fileName,
  });

  const wa = await deliverWhatsAppMessage(admin, {
    clinicId: ctx.clinicId,
    rawPhone: ctx.patientPhone,
    messageBody: body,
    messageType: "xray_link",
  });

  if (!wa.ok && wa.configured) {
    return { ok: false, error: wa.providerError ?? wa.status };
  }
  return { ok: true };
}
