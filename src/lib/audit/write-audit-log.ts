import type { SupabaseClient } from "@supabase/supabase-js";

export type AuditEntityType =
  | "patient_operation"
  | "patient"
  | "operation_xray_image"
  | "operation_tooth_records";

export type AuditAction = "create" | "update" | "delete";

export async function writeAuditLog(
  supabase: SupabaseClient,
  params: {
    clinicId: string;
    entityType: AuditEntityType;
    entityId: string;
    action: AuditAction;
    changedBy?: string | null;
    before?: Record<string, unknown> | null;
    after?: Record<string, unknown> | null;
    note?: string;
  }
): Promise<{ ok: boolean; error?: string }> {
  const { error } = await supabase.from("audit_logs").insert({
    clinic_id: params.clinicId,
    entity_type: params.entityType,
    entity_id: params.entityId,
    action: params.action,
    changed_by: params.changedBy ?? null,
    before_data: params.before ?? null,
    after_data: params.after ?? null,
    note: params.note ?? null,
  });

  if (error) {
    const missing =
      error.message.includes("audit_logs") ||
      error.message.includes("schema cache");
    if (missing) {
      console.warn("[audit] جدول audit_logs غير موجود — شغّل migration 20260608000000");
      return { ok: false, error: "audit_table_missing" };
    }
    return { ok: false, error: error.message };
  }
  return { ok: true };
}
