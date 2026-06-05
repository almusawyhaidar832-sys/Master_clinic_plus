import "server-only";

import { getAdminClient } from "@/lib/supabase/admin";
import { deliverWhatsAppMessage } from "@/lib/whatsapp/send-message";
import { fetchClinicProfile } from "@/lib/services/clinic-profile";
import {
  notifyDoctorSessionPayment,
} from "@/lib/notifications/server";
import {
  patientSessionWhatsAppMessage,
  resolveSessionWhatsAppKind,
  xrayLinkWhatsAppMessage,
  treatmentStatusAr,
  doctorPaymentAlertMessage,
} from "@/lib/automation/messages";
import {
  loadSessionAutomationContext,
  type WhatsAppMessageSnapshot,
} from "@/lib/automation/session-context";
import { resolveWhatsAppSessionMeta } from "@/lib/automation/whatsapp-session";
import { FINANCIAL_EPSILON } from "@/lib/services/patient-financial-plan";

const LOG = "[automation]";

export type SessionSavedOptions = {
  treatmentCompleted?: boolean;
  /** عند true لا يُرسل واتساب للمراجع (مثلاً عند التعديل فقط) */
  skipPatientWhatsApp?: boolean;
  /** معرّف الحالة من الواجهة — لرسالة واتساب دقيقة */
  treatmentCaseId?: string | null;
  /** لقطة مالية من الواجهة بعد الحفظ — مصدر الحقيقة للرسالة */
  messageSnapshot?: WhatsAppMessageSnapshot | null;
};

/** بعد حفظ جلسة — واتساب للمراجع + إشعار الطبيب */
export async function runSessionSavedAutomation(
  operationId: string,
  options: SessionSavedOptions = {}
): Promise<{
  ok: boolean;
  errors: string[];
  whatsapp: Awaited<ReturnType<typeof sendPatientSessionWhatsApp>>;
}> {
  const errors: string[] = [];
  const ctx = await loadSessionAutomationContext(operationId, undefined, {
    treatmentCaseId: options.treatmentCaseId,
  });
  if (!ctx) {
    return {
      ok: false,
      errors: ["operation_not_found"],
      whatsapp: { sent: false, skipped: "operation_not_found", errors: ["operation_not_found"] },
    };
  }

  const admin = getAdminClient();

  const patientWa = await sendPatientSessionWhatsApp(operationId, {
    treatmentCompleted: options.treatmentCompleted,
    skipPatientWhatsApp: options.skipPatientWhatsApp,
    treatmentCaseId: options.treatmentCaseId ?? ctx.treatmentCaseId,
    messageSnapshot: options.messageSnapshot,
  });
  if (!patientWa.sent && patientWa.errors.length) {
    errors.push(`patient_wa:${patientWa.errors.join(",")}`);
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
      totalSessionsInCase: ctx.totalSessionsInCase,
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

  return { ok: errors.length === 0, errors, whatsapp: patientWa };
}

/** إرسال واتساب للمراجع بعد حفظ جلسة — يُستدعى من الواجهة أو API */
export async function sendPatientSessionWhatsApp(
  operationId: string,
  options: SessionSavedOptions = {}
): Promise<{
  sent: boolean;
  skipped?: string;
  pending?: boolean;
  errors: string[];
}> {
  const ctx = await loadSessionAutomationContext(operationId, undefined, {
    treatmentCaseId: options.treatmentCaseId,
  });
  if (!ctx) {
    return { sent: false, skipped: "operation_not_found", errors: ["operation_not_found"] };
  }
  if (options.skipPatientWhatsApp) {
    return { sent: false, skipped: "skipped_by_option", errors: [] };
  }
  if (!ctx.patientPhone?.trim()) {
    return { sent: false, skipped: "no_patient_phone", errors: [] };
  }

  const admin = getAdminClient();
  const clinicProfile = await fetchClinicProfile(admin, ctx.clinicId);

  const explicitCaseId =
    options.treatmentCaseId?.trim() || ctx.treatmentCaseId?.trim() || null;

  const sessionMeta = await resolveWhatsAppSessionMeta(admin, {
    operationId: ctx.operationId,
    patientId: ctx.patientId,
    treatmentCaseId: explicitCaseId,
  });

  const snap = options.messageSnapshot;
  let resolvedCaseId = sessionMeta.caseId ?? explicitCaseId;
  let sessionNumber = sessionMeta.sessionNumber;
  let procedureLabel = sessionMeta.procedureLabel;
  let totalSessionsInCase = sessionMeta.totalSessionsInCase;
  let remainingBalance = sessionMeta.remainingBalance;
  let paidThisSession = sessionMeta.paidThisSession;
  let caseFinalPrice = sessionMeta.caseFinalPrice;
  let caseTotalPaid = sessionMeta.caseTotalPaid;

  if (snap) {
    if (snap.procedureLabel.trim()) procedureLabel = snap.procedureLabel.trim();
    if (Number.isFinite(snap.paidThisSession)) {
      paidThisSession = Math.max(0, snap.paidThisSession);
    }
    if (snap.caseFinalPrice > FINANCIAL_EPSILON) {
      caseFinalPrice = snap.caseFinalPrice;
      caseTotalPaid = Math.max(0, snap.caseTotalPaid);
      remainingBalance = Math.max(0, snap.remainingBalance);
    } else if (snap.remainingBalance > FINANCIAL_EPSILON) {
      remainingBalance = snap.remainingBalance;
    }
    if (snap.sessionNumber >= 1) {
      sessionNumber = Math.max(1, Math.round(snap.sessionNumber));
      totalSessionsInCase =
        snap.totalSessionsInCase >= 1
          ? Math.max(sessionNumber, Math.round(snap.totalSessionsInCase))
          : sessionNumber;
    }
  }

  const snapSaysOpen =
    !!snap &&
    snap.caseFinalPrice > FINANCIAL_EPSILON &&
    snap.remainingBalance > FINANCIAL_EPSILON;
  const completed =
    !snapSaysOpen &&
    (options.treatmentCompleted === true ||
      (caseFinalPrice > FINANCIAL_EPSILON &&
        caseTotalPaid > FINANCIAL_EPSILON &&
        remainingBalance <= FINANCIAL_EPSILON));

  const statusLabel = treatmentStatusAr(
    ctx.treatmentStatus,
    remainingBalance,
    caseFinalPrice
  );
  const kind = resolveSessionWhatsAppKind(sessionNumber, completed);

  const body = patientSessionWhatsAppMessage({
    clinic: clinicProfile,
    patientName: ctx.patientName,
    doctorName: ctx.doctorName,
    sessionNumber,
    totalSessionsInCase,
    paidThisSession,
    remainingBalance,
    treatmentStatus: statusLabel,
    procedureLabel,
    teethSummary: ctx.teethSummary || undefined,
    kind,
    caseId: resolvedCaseId,
    currentOperationId: ctx.operationId,
    sessionCountFromDb: sessionNumber,
    caseFinalPrice,
  });

  const waType =
    kind === "completed" ? "treatment_completed" : "session_update";
  const wa = await deliverWhatsAppMessage(admin, {
    clinicId: ctx.clinicId,
    rawPhone: ctx.patientPhone,
    messageBody: body,
    messageType: waType,
  });

  if (!wa.configured) {
    return { sent: false, pending: true, errors: ["whatsapp_not_configured"] };
  }
  if (!wa.ok) {
    return {
      sent: false,
      errors: [wa.providerError ?? wa.status],
    };
  }
  return { sent: wa.status === "sent", pending: wa.status === "pending", errors: [] };
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
    totalSessionsInCase: ctx.totalSessionsInCase,
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
