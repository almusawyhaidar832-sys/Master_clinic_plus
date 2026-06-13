import type { SupabaseClient } from "@supabase/supabase-js";

export type AuditEntityType =
  | "patient_operation"
  | "session_refund"
  | "patient"
  | "appointment"
  | "operation_xray_image"
  | "operation_tooth_records"
  | "expense"
  | "withdrawal"
  | "payroll";

export type AuditAction = "create" | "update" | "delete" | "refund";

export interface AuditLogRow {
  id: string;
  clinic_id: string;
  entity_type: string;
  entity_id: string;
  action: string;
  changed_by: string | null;
  changed_at: string;
  before_data: Record<string, unknown> | null;
  after_data: Record<string, unknown> | null;
  note: string | null;
  financial_amount: number | null;
  actor_name: string | null;
}

export async function writeAuditLog(
  supabase: SupabaseClient,
  params: {
    clinicId: string;
    entityType: AuditEntityType;
    entityId: string;
    action: AuditAction;
    changedBy?: string | null;
    actorName?: string | null;
    financialAmount?: number | null;
    before?: Record<string, unknown> | null;
    after?: Record<string, unknown> | null;
    note?: string;
  }
): Promise<{ ok: boolean; error?: string }> {
  const payload: Record<string, unknown> = {
    clinic_id: params.clinicId,
    entity_type: params.entityType,
    entity_id: params.entityId,
    action: params.action,
    changed_by: params.changedBy ?? null,
    before_data: params.before ?? null,
    after_data: params.after ?? null,
    note: params.note ?? null,
  };

  if (params.actorName != null) {
    payload.actor_name = params.actorName;
  }
  if (params.financialAmount != null && Number.isFinite(params.financialAmount)) {
    payload.financial_amount = params.financialAmount;
  }

  const { error } = await supabase.from("audit_logs").insert(payload);

  if (error) {
    const missing =
      error.message.includes("audit_logs") ||
      error.message.includes("schema cache");
    if (missing) {
      console.warn("[audit] جدول audit_logs غير موجود — شغّل migration 20260608000000");
      return { ok: false, error: "audit_table_missing" };
    }
    const missingCol =
      error.message.includes("financial_amount") ||
      error.message.includes("actor_name");
    if (missingCol) {
      const { error: retryErr } = await supabase.from("audit_logs").insert({
        clinic_id: params.clinicId,
        entity_type: params.entityType,
        entity_id: params.entityId,
        action: params.action,
        changed_by: params.changedBy ?? null,
        before_data: params.before ?? null,
        after_data: params.after ?? null,
        note: params.note ?? null,
      });
      if (retryErr) return { ok: false, error: retryErr.message };
      return { ok: true };
    }
    return { ok: false, error: error.message };
  }
  return { ok: true };
}

/** Resolve display name for audit actor */
export async function resolveActorName(
  supabase: SupabaseClient,
  profileId: string | null | undefined,
  fallback?: string | null
): Promise<string | null> {
  if (fallback?.trim()) return fallback.trim();
  if (!profileId) return null;
  const { data } = await supabase
    .from("profiles")
    .select("full_name")
    .eq("id", profileId)
    .maybeSingle();
  return data?.full_name?.trim() ?? null;
}
