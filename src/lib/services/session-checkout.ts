import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import { opDebt, opName, type PatientOperation } from "@/types";
import { ensureAppointmentPatient } from "@/lib/services/ensure-appointment-patient";
import {
  syncAppointmentFromQueueStatus,
  syncQueueFromAppointmentStatus,
} from "@/lib/services/appointment-queue-sync";
import { updateQueueStatus, type QueueStatus } from "@/lib/queue/server";
import { trimDoctorQueueNotes } from "@/lib/queue/intake-notes";
import {
  isPersistedTreatmentCaseId,
  linkOperationToTreatmentCase,
  processCasePayment,
} from "@/lib/services/patient-treatment-cases";
import { todayISO } from "@/lib/utils";

export interface CheckoutProcedureLine {
  id: string;
  name: string;
  total_amount: number;
  paid_amount: number;
  remaining: number;
  session_kind: string | null;
}

export interface SessionCheckoutSummary {
  patientId: string;
  patientName: string;
  patientPhone: string | null;
  doctorId: string;
  doctorName: string;
  appointmentId: string | null;
  queueEntryId: string | null;
  procedures: CheckoutProcedureLine[];
  totalDue: number;
  treatmentCaseId: string | null;
}

function todayDate() {
  return todayISO();
}

async function resolveCheckoutContext(
  admin: SupabaseClient,
  clinicId: string,
  input: { appointmentId?: string | null; queueEntryId?: string | null }
): Promise<{
  patientId: string;
  patientName: string;
  patientPhone: string | null;
  doctorId: string;
  doctorName: string;
  appointmentId: string | null;
  queueEntryId: string | null;
}> {
  if (input.queueEntryId) {
    const { data: entry } = await admin
      .from("patient_queue")
      .select(
        "id, clinic_id, doctor_id, patient_id, patient_name, patient_phone, appointment_id, doctor:doctors(full_name_ar)"
      )
      .eq("id", input.queueEntryId)
      .eq("clinic_id", clinicId)
      .maybeSingle();

    if (!entry) throw new Error("دور الانتظار غير موجود");

    let patientId = entry.patient_id as string | null;
    let patientName = (entry.patient_name as string | null)?.trim() || "مراجع";
    let patientPhone = (entry.patient_phone as string | null) ?? null;

    if (!patientId && entry.appointment_id) {
      const ctx = await ensureAppointmentPatient(
        admin,
        entry.appointment_id as string,
        clinicId
      );
      patientId = ctx.patientId;
      patientName = ctx.patientName;
      patientPhone = ctx.patientPhone;
    }

    if (!patientId) {
      throw new Error(
        "لا يوجد ملف مريض — يجب على الطبيب تسجيل الإجراءات من إدخال الجلسة أولاً"
      );
    }

    const doctor = entry.doctor as { full_name_ar?: string } | null;

    return {
      patientId,
      patientName,
      patientPhone,
      doctorId: entry.doctor_id as string,
      doctorName: doctor?.full_name_ar?.trim() || "الطبيب",
      appointmentId: (entry.appointment_id as string | null) ?? null,
      queueEntryId: entry.id as string,
    };
  }

  if (input.appointmentId) {
    const ctx = await ensureAppointmentPatient(
      admin,
      input.appointmentId,
      clinicId
    );

    const { data: doctor } = await admin
      .from("doctors")
      .select("full_name_ar")
      .eq("id", ctx.doctorId)
      .maybeSingle();

    const { data: queueEntry } = await admin
      .from("patient_queue")
      .select("id")
      .eq("appointment_id", input.appointmentId)
      .eq("clinic_id", clinicId)
      .eq("queue_date", todayDate())
      .neq("status", "cancelled")
      .maybeSingle();

    return {
      patientId: ctx.patientId,
      patientName: ctx.patientName,
      patientPhone: ctx.patientPhone,
      doctorId: ctx.doctorId,
      doctorName: (doctor?.full_name_ar as string) || "الطبيب",
      appointmentId: ctx.appointmentId,
      queueEntryId: (queueEntry?.id as string | null) ?? null,
    };
  }

  throw new Error("appointment_id أو queue_entry_id مطلوب");
}

export async function fetchSessionCheckoutSummary(
  admin: SupabaseClient,
  clinicId: string,
  input: { appointmentId?: string | null; queueEntryId?: string | null }
): Promise<SessionCheckoutSummary> {
  const ctx = await resolveCheckoutContext(admin, clinicId, input);
  const today = todayDate();

  const { data: operations } = await admin
    .from("patient_operations")
    .select(
      "id, operation_name_ar, operation_type, total_amount, paid_amount, remaining_debt, session_kind, treatment_case_id"
    )
    .eq("clinic_id", clinicId)
    .eq("patient_id", ctx.patientId)
    .eq("doctor_id", ctx.doctorId)
    .eq("operation_date", today)
    .order("created_at", { ascending: true });

  const rows = (operations ?? []) as PatientOperation[];
  const planRows = rows.filter(
    (op) =>
      (op.session_kind === "plan" || !op.session_kind) &&
      Number(op.total_amount ?? 0) > 0
  );

  const procedures: CheckoutProcedureLine[] = planRows.map((op) => ({
    id: op.id,
    name: opName(op),
    total_amount: Number(op.total_amount ?? 0),
    paid_amount: Number(op.paid_amount ?? 0),
    remaining: opDebt(op),
    session_kind: op.session_kind ?? null,
  }));

  let totalDue = procedures.reduce((sum, line) => sum + line.remaining, 0);
  const treatmentCaseId: string | null =
    planRows.find((op) => op.treatment_case_id)?.treatment_case_id ?? null;

  if (treatmentCaseId) {
    const { data: caseRow } = await admin
      .from("patient_treatment_cases")
      .select("final_price, total_paid")
      .eq("id", treatmentCaseId)
      .maybeSingle();

    if (caseRow) {
      const finalPrice = Number(caseRow.final_price ?? 0);
      const totalPaid = Number(caseRow.total_paid ?? 0);
      totalDue = Math.max(0, finalPrice - totalPaid);
    }
  }

  if (procedures.length === 0 && totalDue <= 0) {
    const { data: patient } = await admin
      .from("patients")
      .select("agreed_total, total_paid")
      .eq("id", ctx.patientId)
      .maybeSingle();

    if (patient) {
      const agreed = Number(patient.agreed_total ?? 0);
      const paid = Number(patient.total_paid ?? 0);
      if (agreed > paid) {
        totalDue = agreed - paid;
      }
    }
  }

  return {
    ...ctx,
    procedures,
    totalDue: Math.round(totalDue * 100) / 100,
    treatmentCaseId,
  };
}

export async function completeVisitAfterPayment(
  admin: SupabaseClient,
  clinicId: string,
  ctx: {
    appointmentId: string | null;
    queueEntryId: string | null;
  }
): Promise<void> {
  if (ctx.queueEntryId) {
    await updateQueueStatus(ctx.queueEntryId, "done", { clinicId });
    await syncAppointmentFromQueueStatus(admin, ctx.queueEntryId, "done");
    return;
  }

  if (ctx.appointmentId) {
    await admin
      .from("appointments")
      .update({ status: "completed" })
      .eq("id", ctx.appointmentId)
      .eq("clinic_id", clinicId);

    await syncQueueFromAppointmentStatus(
      admin,
      ctx.appointmentId,
      clinicId,
      "completed"
    );
  }
}

export async function processSessionCheckout(
  admin: SupabaseClient,
  clinicId: string,
  createdBy: string,
  input: {
    appointmentId?: string | null;
    queueEntryId?: string | null;
    paidAmount: number;
  }
): Promise<{ operationId: string | null; totalDue: number }> {
  const summary = await fetchSessionCheckoutSummary(admin, clinicId, input);
  const paid = Math.max(0, input.paidAmount);

  if (paid <= 0 && summary.totalDue > 0) {
    throw new Error("أدخل مبلغ الدفع");
  }

  // مبلغ الدفع محسوب بالسيرفر (summary.totalDue) — لا نثق بأي شيء أكبر
  // منه قادم من العميل. تجاوزه (خطأ كتابة أو تلاعب) يضخّم حصة الطبيب مباشرة
  // عبر trigger حساب الحصص، فيرفع رصيد سحبه فعلياً بدون مقابل حقيقي.
  const CHECKOUT_OVERPAY_MARGIN = 1;
  if (paid > summary.totalDue + CHECKOUT_OVERPAY_MARGIN) {
    throw new Error(
      `المبلغ المدخل (${paid}) أكبر من المستحق الفعلي (${summary.totalDue}) — تحقق من المبلغ`
    );
  }

  let operationId: string | null = null;

  if (paid > 0) {
    const payload: Record<string, unknown> = {
      clinic_id: clinicId,
      patient_id: summary.patientId,
      doctor_id: summary.doctorId,
      operation_date: todayDate(),
      operation_name_ar: "دفعة — حساب نهائي",
      total_amount: 0,
      paid_amount: paid,
      session_kind: "payment",
      created_by: createdBy,
    };

    if (summary.treatmentCaseId) {
      payload.treatment_case_id = summary.treatmentCaseId;
    }

    const { data: op, error } = await admin
      .from("patient_operations")
      .insert(payload)
      .select("id")
      .single();

    if (error) {
      const fallback = { ...payload };
      delete fallback.session_kind;
      delete fallback.treatment_case_id;
      const retry = await admin
        .from("patient_operations")
        .insert(fallback)
        .select("id")
        .single();
      if (retry.error || !retry.data) {
        throw new Error(retry.error?.message ?? error.message);
      }
      operationId = retry.data.id as string;
    } else {
      operationId = op?.id as string;
    }

    if (
      operationId &&
      summary.treatmentCaseId &&
      isPersistedTreatmentCaseId(summary.treatmentCaseId)
    ) {
      await linkOperationToTreatmentCase(
        admin,
        operationId,
        summary.treatmentCaseId
      );
      const sync = await processCasePayment(admin, {
        caseId: summary.treatmentCaseId,
        paidDelta: paid,
      });
      if (!sync.ok) {
        throw new Error(sync.error ?? "تعذر تحديث ذمة الحالة بعد الدفع");
      }
    }
  }

  await completeVisitAfterPayment(admin, clinicId, {
    appointmentId: summary.appointmentId,
    queueEntryId: summary.queueEntryId,
  });

  return { operationId, totalDue: summary.totalDue };
}

async function loadQueueEntryForStatusChange(
  admin: SupabaseClient,
  queueEntryId: string,
  opts: { doctorId?: string; clinicId?: string }
) {
  let query = admin
    .from("patient_queue")
    .select("status, doctor_id, clinic_id")
    .eq("id", queueEntryId);

  if (opts.doctorId) query = query.eq("doctor_id", opts.doctorId);
  if (opts.clinicId) query = query.eq("clinic_id", opts.clinicId);

  const { data: entry } = await query.maybeSingle();
  if (!entry) throw new Error("الدور غير موجود");
  return entry;
}

/** الطبيب — إرسال الجلسة للمحاسبة (داخل الكشف → جاهز للفوترة) */
export async function markQueueReadyForBilling(
  admin: SupabaseClient,
  queueEntryId: string,
  opts: { doctorId?: string; clinicId?: string; doctorNotes?: string | null }
): Promise<QueueStatus> {
  const entry = await loadQueueEntryForStatusChange(admin, queueEntryId, opts);

  if (entry.status !== "in_progress") {
    throw new Error("يمكن إرسال الجلسة للمحاسبة للمراجع داخل الكشف فقط");
  }

  const doctorNotes = trimDoctorQueueNotes(opts.doctorNotes);
  if (doctorNotes) {
    const { error } = await admin
      .from("patient_queue")
      .update({ doctor_notes: doctorNotes })
      .eq("id", queueEntryId);
    if (error) throw new Error(error.message);
  }

  await updateQueueStatus(queueEntryId, "ready_for_billing", {
    doctorId: opts.doctorId,
    clinicId: opts.clinicId,
  });
  await syncAppointmentFromQueueStatus(admin, queueEntryId, "ready_for_billing");

  return "ready_for_billing";
}

/** جاهز للفوترة → جاهز للدفع */
export async function advanceQueueBillingToPayment(
  admin: SupabaseClient,
  queueEntryId: string,
  opts: { doctorId?: string; clinicId?: string }
): Promise<QueueStatus> {
  const entry = await loadQueueEntryForStatusChange(admin, queueEntryId, opts);

  if (entry.status !== "ready_for_billing") {
    throw new Error("المراجع ليس في مرحلة جاهز للمحاسبة");
  }

  await updateQueueStatus(queueEntryId, "ready_for_payment", {
    doctorId: opts.doctorId,
    clinicId: opts.clinicId,
  });
  await syncAppointmentFromQueueStatus(admin, queueEntryId, "ready_for_payment");

  return "ready_for_payment";
}

/**
 * المحاسب/المساعد — إنهاء الجلسة وتمريرها للدفع
 * (in_progress → ready_for_billing → ready_for_payment)
 */
export async function completeSessionForAccounting(
  admin: SupabaseClient,
  queueEntryId: string,
  opts: { clinicId?: string; doctorId?: string }
): Promise<QueueStatus> {
  const entry = await loadQueueEntryForStatusChange(admin, queueEntryId, opts);

  if (entry.status === "ready_for_payment") {
    return "ready_for_payment";
  }

  if (entry.status === "ready_for_billing") {
    return advanceQueueBillingToPayment(admin, queueEntryId, opts);
  }

  if (entry.status !== "in_progress") {
    throw new Error("يمكن إنهاء الجلسة للمراجع داخل الكشف أو الجاهز للمحاسبة فقط");
  }

  await markQueueReadyForBilling(admin, queueEntryId, opts);
  return advanceQueueBillingToPayment(admin, queueEntryId, opts);
}

export async function markQueueReadyForPayment(
  admin: SupabaseClient,
  queueEntryId: string,
  opts: { doctorId?: string; clinicId?: string }
): Promise<QueueStatus> {
  return completeSessionForAccounting(admin, queueEntryId, opts);
}

function todayIsoDate() {
  return new Date().toISOString().split("T")[0];
}

/** إرسال جلسة الموعد للمحاسبة — للطبيب */
export async function markAppointmentReadyForBilling(
  admin: SupabaseClient,
  clinicId: string,
  appointmentId: string,
  opts?: { doctorId?: string }
): Promise<QueueStatus> {
  const entryId = await resolveTodayQueueEntryForAppointment(
    admin,
    clinicId,
    appointmentId
  );

  return markQueueReadyForBilling(admin, entryId, {
    clinicId,
    doctorId: opts?.doctorId,
  });
}

/** إنهاء الكشف من الموعد — للمحاسب / المساعد */
export async function markAppointmentReadyForPayment(
  admin: SupabaseClient,
  clinicId: string,
  appointmentId: string,
  opts?: { doctorId?: string }
): Promise<QueueStatus> {
  const entryId = await resolveTodayQueueEntryForAppointment(
    admin,
    clinicId,
    appointmentId
  );

  return completeSessionForAccounting(admin, entryId, {
    clinicId,
    doctorId: opts?.doctorId,
  });
}

async function resolveTodayQueueEntryForAppointment(
  admin: SupabaseClient,
  clinicId: string,
  appointmentId: string
): Promise<string> {
  const { data: entry } = await admin
    .from("patient_queue")
    .select("id")
    .eq("appointment_id", appointmentId)
    .eq("clinic_id", clinicId)
    .eq("queue_date", todayIsoDate())
    .neq("status", "cancelled")
    .neq("status", "done")
    .maybeSingle();

  if (!entry?.id) {
    throw new Error("لا يوجد دور في الانتظار لهذا الموعد");
  }

  return entry.id as string;
}
