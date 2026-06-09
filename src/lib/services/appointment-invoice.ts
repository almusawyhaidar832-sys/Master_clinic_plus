import type { SupabaseClient } from "@supabase/supabase-js";
import { calculateDoctorShare } from "@/lib/finance";
import { ensureAppointmentPatient } from "@/lib/services/ensure-appointment-patient";
import type { DoctorPercentage, MaterialsCostShare } from "@/types";

export interface AppointmentInvoiceInput {
  appointmentId: string;
  procedureName: string;
  operationTypeId?: string | null;
  totalAmount: number;
  paidAmount: number;
  materialsCost?: number;
  notes?: string | null;
  xrayStoragePath?: string | null;
  xrayFileName?: string | null;
  xrayMimeType?: string | null;
  createdBy: string;
}

export interface AppointmentInvoiceResult {
  invoiceId: string;
  operationId: string;
  patientId: string;
  doctorShare: number;
  clinicShare: number;
}

export async function createAppointmentInvoice(
  admin: SupabaseClient,
  input: AppointmentInvoiceInput
): Promise<AppointmentInvoiceResult> {
  const { data: appointment, error: apptErr } = await admin
    .from("appointments")
    .select(
      "id, clinic_id, doctor_id, patient_id, patient_name_ar, patient_phone, appointment_date"
    )
    .eq("id", input.appointmentId)
    .maybeSingle();

  if (apptErr || !appointment) {
    throw new Error("الموعد غير موجود");
  }

  const { data: doctor, error: docErr } = await admin
    .from("doctors")
    .select("id, percentage, materials_share, payment_type")
    .eq("id", appointment.doctor_id)
    .maybeSingle();

  if (docErr || !doctor) {
    throw new Error("بيانات الطبيب غير موجودة");
  }

  const patientCtx = await ensureAppointmentPatient(
    admin,
    appointment.id as string,
    appointment.clinic_id as string
  );
  const patientId = patientCtx.patientId;

  const materialsCost = Math.max(0, input.materialsCost ?? 0);
  const totalAmount = Math.max(0, input.totalAmount);
  const paidAmount = Math.min(Math.max(0, input.paidAmount), totalAmount);

  const split = calculateDoctorShare(
    totalAmount,
    String(doctor.percentage) as DoctorPercentage,
    materialsCost,
    String(doctor.materials_share) as MaterialsCostShare
  );

  const opPayload: Record<string, unknown> = {
    clinic_id: appointment.clinic_id,
    patient_id: patientId,
    doctor_id: appointment.doctor_id,
    operation_name_ar: input.procedureName.trim(),
    operation_date: appointment.appointment_date,
    total_amount: totalAmount,
    paid_amount: paidAmount,
    materials_cost: materialsCost,
    notes: input.notes?.trim() || null,
    created_by: input.createdBy,
  };

  if (input.operationTypeId) {
    opPayload.operation_type_id = input.operationTypeId;
  }

  const { data: operation, error: opErr } = await admin
    .from("patient_operations")
    .insert(opPayload)
    .select("id, doctor_share_amount, clinic_share_amount")
    .single();

  if (opErr || !operation) {
    throw new Error(opErr?.message ?? "تعذر تسجيل الجلسة المالية");
  }

  const invoicePayload: Record<string, unknown> = {
    clinic_id: appointment.clinic_id,
    patient_id: patientId,
    doctor_id: appointment.doctor_id,
    operation_id: operation.id,
    appointment_id: appointment.id,
    total_amount: totalAmount,
    paid_amount: paidAmount,
    invoice_date: appointment.appointment_date,
    notes: input.notes?.trim() || null,
    created_by: input.createdBy,
  };

  if (input.xrayStoragePath) {
    invoicePayload.xray_storage_path = input.xrayStoragePath;
    invoicePayload.xray_file_name = input.xrayFileName ?? null;
    invoicePayload.xray_mime_type = input.xrayMimeType ?? null;
  }

  const { data: invoice, error: invErr } = await admin
    .from("invoices")
    .insert(invoicePayload)
    .select("id")
    .single();

  if (invErr || !invoice) {
    await admin.from("patient_operations").delete().eq("id", operation.id);
    throw new Error(invErr?.message ?? "تعذر إنشاء الفاتورة");
  }

  await admin
    .from("appointments")
    .update({ status: "completed" })
    .eq("id", appointment.id);

  return {
    invoiceId: invoice.id,
    operationId: operation.id,
    patientId,
    doctorShare:
      Number(operation.doctor_share_amount) || split.doctorShare,
    clinicShare:
      Number(operation.clinic_share_amount) || split.clinicShare,
  };
}
