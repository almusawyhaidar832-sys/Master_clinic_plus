import type { SupabaseClient } from "@supabase/supabase-js";
import { writeAuditLog } from "@/lib/audit/write-audit-log";
import { translateDbError } from "@/lib/db-errors";

const XRAY_BUCKET = "clinical-xrays";

export interface DeletePatientResult {
  ok: boolean;
  error?: string;
  deletedStorageFiles?: number;
}

async function deletePatientXrayStorage(
  admin: SupabaseClient,
  clinicId: string,
  operationIds: string[]
): Promise<number> {
  if (operationIds.length === 0) return 0;

  const paths = new Set<string>();

  const { data: xrays } = await admin
    .from("operation_xray_images")
    .select("storage_path")
    .in("operation_id", operationIds);

  for (const row of xrays ?? []) {
    if (typeof row.storage_path === "string" && row.storage_path.trim()) {
      paths.add(row.storage_path.trim());
    }
  }

  for (const opId of operationIds) {
    const prefix = `${clinicId}/${opId}`;
    const { data: listed } = await admin.storage.from(XRAY_BUCKET).list(prefix);
    for (const file of listed ?? []) {
      if (file.name) paths.add(`${prefix}/${file.name}`);
    }
  }

  if (paths.size === 0) return 0;

  const { error } = await admin.storage.from(XRAY_BUCKET).remove([...paths]);
  if (error) {
    console.warn("[deletePatient] storage remove:", error.message);
    return 0;
  }

  return paths.size;
}

/** حذف المريض وجميع سجلاته من العيادة — لا يمكن التراجع */
export async function deletePatientCompletely(
  admin: SupabaseClient,
  params: {
    clinicId: string;
    patientId: string;
    deletedBy?: string | null;
    actorName?: string | null;
  }
): Promise<DeletePatientResult> {
  const { clinicId, patientId, deletedBy, actorName } = params;

  const { data: patient, error: patientErr } = await admin
    .from("patients")
    .select(
      "id, clinic_id, full_name_ar, phone, phone_secondary, notes, total_paid, treatment_status, created_at"
    )
    .eq("id", patientId)
    .maybeSingle();

  if (patientErr) {
    return { ok: false, error: translateDbError(patientErr.message) };
  }
  if (!patient) {
    return { ok: false, error: "المريض غير موجود" };
  }
  if (String(patient.clinic_id) !== String(clinicId)) {
    return { ok: false, error: "المريض لا ينتمي لهذه العيادة" };
  }

  const { data: ops, error: opsErr } = await admin
    .from("patient_operations")
    .select("id")
    .eq("patient_id", patientId)
    .eq("clinic_id", clinicId);

  if (opsErr) {
    return { ok: false, error: translateDbError(opsErr.message) };
  }

  const operationIds = (ops ?? []).map((row) => String(row.id));

  if (operationIds.length > 0) {
    const { error: waErr } = await admin
      .from("whatsapp_messages")
      .delete()
      .in("related_operation_id", operationIds);
    if (waErr) {
      console.warn("[deletePatient] whatsapp cleanup:", waErr.message);
    }
  }

  const deletedStorageFiles = await deletePatientXrayStorage(
    admin,
    clinicId,
    operationIds
  );

  const cleanupTables = [
    { table: "appointments", column: "patient_id" },
    { table: "patient_queue", column: "patient_id" },
    { table: "medical_logs", column: "patient_id" },
    { table: "patient_doctor_transfers", column: "patient_id" },
    { table: "invoices_history", column: "patient_id" },
    { table: "invoices", column: "patient_id" },
  ] as const;

  for (const { table, column } of cleanupTables) {
    const { error } = await admin.from(table).delete().eq(column, patientId);
    if (error && !error.message.includes("does not exist")) {
      console.warn(`[deletePatient] ${table} cleanup:`, error.message);
    }
  }

  await writeAuditLog(admin, {
    clinicId,
    entityType: "patient",
    entityId: patientId,
    action: "delete",
    changedBy: deletedBy,
    actorName,
    before: patient as Record<string, unknown>,
    note: `حذف نهائي للمريض: ${patient.full_name_ar}`,
  });

  const { error: delErr } = await admin
    .from("patients")
    .delete()
    .eq("id", patientId)
    .eq("clinic_id", clinicId);

  if (delErr) {
    return { ok: false, error: translateDbError(delErr.message) };
  }

  return { ok: true, deletedStorageFiles };
}
