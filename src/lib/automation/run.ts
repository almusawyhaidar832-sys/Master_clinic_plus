import "server-only";

import { getAdminClient } from "@/lib/supabase/admin";
import { getClinicDisplayName } from "@/lib/services/clinic-profile";
import { notifyDoctorSessionPayment } from "@/lib/notifications/server";
import { sendUnifiedWhatsApp } from "@/lib/automation/notification-service";
import {
  loadSessionAutomationContext,
  type WhatsAppMessageSnapshot,
} from "@/lib/automation/session-context";
import { resolveSessionWhatsAppKind } from "@/lib/automation/messages";
import { resolveWhatsAppSessionMeta } from "@/lib/automation/whatsapp-session";
import { FINANCIAL_EPSILON } from "@/lib/services/patient-financial-plan";

const LOG = "[automation]";

export type SessionSavedOptions = {
  treatmentCompleted?: boolean;
  skipPatientWhatsApp?: boolean;
  treatmentCaseId?: string | null;
  messageSnapshot?: WhatsAppMessageSnapshot | null;
  queueEntryId?: string | null;
};

export type UnifiedWhatsAppOutcome = {
  sent: boolean;
  skipped?: string;
  pending?: boolean;
  errors: string[];
  patientBody?: string | null;
  doctorSent?: boolean;
};

/**
 * بعد تحديث الحالة — نقطة الدخول الوحيدة لإرسال واتساب (مراجع + طبيب).
 */
export async function runSessionSavedAutomation(
  operationId: string,
  options: SessionSavedOptions = {}
): Promise<{
  ok: boolean;
  errors: string[];
  whatsapp: UnifiedWhatsAppOutcome;
}> {
  const errors: string[] = [];
  const ctx = await loadSessionAutomationContext(operationId, undefined, {
    treatmentCaseId: options.treatmentCaseId,
  });

  if (!ctx) {
    return {
      ok: false,
      errors: ["operation_not_found"],
      whatsapp: {
        sent: false,
        skipped: "operation_not_found",
        errors: ["operation_not_found"],
      },
    };
  }

  const admin = getAdminClient();
  const caseId =
    options.treatmentCaseId?.trim() ||
    ctx.treatmentCaseId?.trim() ||
    null;

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

  const waType = await resolvePatientMessageType(
    admin,
    operationId,
    ctx.patientId,
    caseId,
    options
  );

  const sendDoctor =
    Boolean(ctx.doctorPhone?.trim()) &&
    (ctx.paidAmount > 0 || ctx.sessionKind === "payment");

  const wa = await sendUnifiedWhatsApp({
    supabase: admin,
    operationId,
    caseId,
    clinicId: ctx.clinicId,
    clinicName: getClinicDisplayName(ctx.clinic),
    patientName: ctx.patientName,
    doctorName: ctx.doctorName,
    patientPhone: options.skipPatientWhatsApp ? null : ctx.patientPhone,
    doctorPhone: sendDoctor ? ctx.doctorPhone : null,
    skipPatient: Boolean(options.skipPatientWhatsApp) || !ctx.patientPhone?.trim(),
    skipDoctor: !sendDoctor,
    patientMessageType: waType,
    queueEntryId: options.queueEntryId ?? null,
  });

  if (wa.skipped) {
    errors.push(wa.skipped);
  }
  if (wa.errors.length) {
    errors.push(...wa.errors.filter((e) => e !== "whatsapp_not_configured"));
  }

  return {
    ok: errors.length === 0,
    errors,
    whatsapp: {
      sent: wa.patientSent,
      pending: wa.patientPending,
      skipped: wa.skipped,
      errors: wa.errors,
      patientBody: wa.patientBody,
      doctorSent: wa.doctorSent,
    },
  };
}

async function resolvePatientMessageType(
  admin: ReturnType<typeof getAdminClient>,
  operationId: string,
  patientId: string,
  caseId: string | null,
  options: SessionSavedOptions
): Promise<"session_update" | "treatment_completed"> {
  const sessionMeta = await resolveWhatsAppSessionMeta(admin, {
    operationId,
    patientId,
    treatmentCaseId: caseId,
  });

  let remainingBalance = sessionMeta.remainingBalance;
  let caseFinalPrice = sessionMeta.caseFinalPrice;
  let caseTotalPaid = sessionMeta.caseTotalPaid;
  let sessionNumber = sessionMeta.sessionNumber;

  const snap = options.messageSnapshot;
  if (snap) {
    if (snap.caseFinalPrice > FINANCIAL_EPSILON) {
      caseFinalPrice = snap.caseFinalPrice;
      caseTotalPaid = Math.max(0, snap.caseTotalPaid);
      remainingBalance = Math.max(0, snap.remainingBalance);
    } else if (snap.remainingBalance > FINANCIAL_EPSILON) {
      remainingBalance = snap.remainingBalance;
    }
    if (snap.sessionNumber >= 1) {
      sessionNumber = Math.max(1, Math.round(snap.sessionNumber));
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

  const kind = resolveSessionWhatsAppKind(sessionNumber, completed);
  return kind === "completed" ? "treatment_completed" : "session_update";
}

/** @deprecated استخدم runSessionSavedAutomation */
export async function sendPatientSessionWhatsApp(
  operationId: string,
  options: SessionSavedOptions = {}
): Promise<UnifiedWhatsAppOutcome> {
  const result = await runSessionSavedAutomation(operationId, options);
  return result.whatsapp;
}
