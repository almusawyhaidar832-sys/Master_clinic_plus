import type { SupabaseClient } from "@supabase/supabase-js";
import type { AuditLogRow } from "@/lib/audit/write-audit-log";
import { buildAuditChangeLines } from "@/lib/audit/audit-diff";

export interface AuditFeedFilters {
  action?: string | null;
  changedBy?: string | null;
  entityType?: string | null;
  limit?: number;
}

export interface AuditFeedItem {
  id: string;
  action: string;
  actionLabel: string;
  entityType: string;
  entityId: string;
  actorName: string;
  changedAt: string;
  financialAmount: number | null;
  note: string | null;
  summary: string;
  changes: string[];
}

const ACTION_LABELS: Record<string, string> = {
  create: "إنشاء",
  update: "تعديل",
  delete: "حذف",
  refund: "مرتجع",
};

const ENTITY_LABELS: Record<string, string> = {
  patient_operation: "جلسة مريض",
  session_refund: "مرتجع مالي",
  patient: "ملف مريض",
  appointment: "موعد",
  expense: "مصروف",
  financial_transaction: "حركة مالية",
  payroll: "رواتب",
};

function formatPayrollAuditDetail(row: AuditLogRow): string | null {
  if (row.entity_type !== "payroll") return null;
  const after = row.after_data as Record<string, unknown> | null;
  if (!after) return null;

  const month = after.month_year as string | undefined;
  const monthPart = month ? ` — ${month}` : "";

  if (after.kind === "assistant") {
    const doctor = Number(after.confirmed_doctor ?? 0);
    const clinic = Number(after.confirmed_clinic ?? 0);
    const parts: string[] = [];
    if (doctor > 0) parts.push(`طبيب ${doctor}`);
    if (clinic > 0) parts.push(`عيادة ${clinic}`);
    return parts.length
      ? `مساعد${monthPart}: ${parts.join("، ")}`
      : `مساعد${monthPart}`;
  }

  const confirmed = Number(after.confirmed_amount ?? 0);
  if (confirmed > 0) {
    return `قسيمة${monthPart}: ${confirmed}`;
  }

  return null;
}

function buildSummary(row: AuditLogRow): string {
  const entity = ENTITY_LABELS[row.entity_type] ?? row.entity_type;
  const action = ACTION_LABELS[row.action] ?? row.action;
  const note = row.note?.trim();
  const payrollDetail = formatPayrollAuditDetail(row);

  if (row.entity_type === "appointment") {
    const data = (row.before_data ?? row.after_data) as Record<string, unknown> | null;
    const patient = data?.patient_name_ar as string | undefined;
    const date = data?.appointment_date as string | undefined;
    const time = data?.start_time as string | undefined;
    const parts = [patient, date, time].filter(Boolean);
    const detail = parts.length ? ` — ${parts.join(" · ")}` : "";
    if (note) return `${action} موعد${detail}: ${note}`;
    return `${action} موعد${detail}`;
  }

  if (row.entity_type === "financial_transaction") {
    const after = row.after_data as Record<string, unknown> | null;
    const target = after?.target === "doctor" ? "طبيب" : "عيادة";
    const amount = Number(after?.amount ?? row.financial_amount ?? 0);
    const amountPart =
      amount > 0 ? ` — ${amount.toLocaleString("ar-IQ")} د.ع` : "";
    if (row.action === "delete") {
      return note ?? `حذف شحنات رصيد العيادة${amountPart}`;
    }
    return note ?? `شحن رصيد ${target}${amountPart}`;
  }

  if (note) return `${action} — ${entity}: ${note}${payrollDetail ? ` (${payrollDetail})` : ""}`;
  if (payrollDetail) return `${action} — ${entity}: ${payrollDetail}`;
  return `${action} — ${entity}`;
}

export async function fetchAuditFeed(
  supabase: SupabaseClient,
  clinicId: string,
  filters: AuditFeedFilters = {}
): Promise<AuditFeedItem[]> {
  const limit = Math.min(Math.max(filters.limit ?? 50, 1), 200);

  let query = supabase
    .from("audit_logs")
    .select(
      "id, clinic_id, entity_type, entity_id, action, changed_by, changed_at, before_data, after_data, note, financial_amount, actor_name, actor:profiles!changed_by(full_name)"
    )
    .eq("clinic_id", clinicId)
    .order("changed_at", { ascending: false })
    .limit(limit);

  if (filters.action) query = query.eq("action", filters.action);
  if (filters.changedBy) query = query.eq("changed_by", filters.changedBy);
  if (filters.entityType) query = query.eq("entity_type", filters.entityType);

  const { data, error } = await query;
  if (error || !data) return [];

  return (data as (AuditLogRow & {
    actor?: { full_name: string } | { full_name: string }[] | null;
  })[]).map((row) => {
    const actorRel = row.actor;
    const joinedName = Array.isArray(actorRel)
      ? actorRel[0]?.full_name
      : actorRel?.full_name;

    return {
      id: row.id,
      action: row.action,
      actionLabel: ACTION_LABELS[row.action] ?? row.action,
      entityType: row.entity_type,
      entityId: row.entity_id,
      actorName: row.actor_name?.trim() || joinedName?.trim() || "مستخدم",
      changedAt: row.changed_at,
      financialAmount:
        row.financial_amount != null ? Number(row.financial_amount) : null,
      note: row.note,
      summary: buildSummary(row),
      changes: buildAuditChangeLines(
        row.entity_type,
        row.before_data,
        row.after_data
      ),
    };
  });
}

export async function fetchAuditActors(
  supabase: SupabaseClient,
  clinicId: string
): Promise<{ id: string; full_name: string; role: string }[]> {
  const { data } = await supabase
    .from("profiles")
    .select("id, full_name, role")
    .eq("clinic_id", clinicId)
    .in("role", ["accountant", "super_admin", "doctor"])
    .order("full_name");

  return (data ?? []).map((p) => ({
    id: p.id as string,
    full_name: (p.full_name as string)?.trim() || "—",
    role: String(p.role ?? ""),
  }));
}
