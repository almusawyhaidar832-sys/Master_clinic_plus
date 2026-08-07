import type { SupabaseClient } from "@supabase/supabase-js";
import {
  BALANCE_TOPUP_CLINIC_TYPE,
  BALANCE_TOPUP_DOCTOR_TYPE,
} from "@/lib/services/balance-topup";

export interface ClearClinicTopUpsResult {
  ok: boolean;
  deletedTransactions: number;
  deletedAuditLogs: number;
  error?: string;
}

export interface DeleteBalanceTopUpResult {
  ok: boolean;
  target?: "clinic" | "doctor";
  amount?: number;
  doctorId?: string | null;
  deletedAuditLogs: number;
  error?: string;
}

const TOPUP_TYPES = [BALANCE_TOPUP_CLINIC_TYPE, BALANCE_TOPUP_DOCTOR_TYPE] as const;

/** يحذف شحنة رصيد واحدة (عيادة أو طبيب) + سجل المراقبة المرتبط فقط */
export async function deleteBalanceTopUpTransaction(
  admin: SupabaseClient,
  clinicId: string,
  transactionId: string
): Promise<DeleteBalanceTopUpResult> {
  const { data: tx, error: fetchErr } = await admin
    .from("transactions")
    .select("id, clinic_id, doctor_id, amount, type, reference_id")
    .eq("id", transactionId)
    .eq("clinic_id", clinicId)
    .maybeSingle();

  if (fetchErr) {
    return { ok: false, deletedAuditLogs: 0, error: fetchErr.message };
  }
  if (!tx) {
    return { ok: false, deletedAuditLogs: 0, error: "الشحنة غير موجودة" };
  }

  const txType = String(tx.type ?? "");
  if (!TOPUP_TYPES.includes(txType as (typeof TOPUP_TYPES)[number])) {
    return {
      ok: false,
      deletedAuditLogs: 0,
      error: "هذه الحركة ليست شحن رصيد",
    };
  }

  const refId = tx.reference_id != null ? String(tx.reference_id) : null;
  const auditEntityIds = [String(tx.id), ...(refId ? [refId] : [])];

  const { data: auditRows, error: auditFetchErr } = await admin
    .from("audit_logs")
    .select("id")
    .eq("clinic_id", clinicId)
    .eq("entity_type", "financial_transaction")
    .in("entity_id", auditEntityIds);

  if (auditFetchErr) {
    return { ok: false, deletedAuditLogs: 0, error: auditFetchErr.message };
  }

  const auditIds = (auditRows ?? []).map((r) => String(r.id));
  if (auditIds.length > 0) {
    const { error: auditDelErr } = await admin
      .from("audit_logs")
      .delete()
      .in("id", auditIds);
    if (auditDelErr) {
      return { ok: false, deletedAuditLogs: 0, error: auditDelErr.message };
    }
  }

  const { error: txDelErr } = await admin
    .from("transactions")
    .delete()
    .eq("id", transactionId)
    .eq("clinic_id", clinicId);

  if (txDelErr) {
    return { ok: false, deletedAuditLogs: 0, error: txDelErr.message };
  }

  const target =
    txType === BALANCE_TOPUP_CLINIC_TYPE ? ("clinic" as const) : ("doctor" as const);

  return {
    ok: true,
    target,
    amount: Math.max(0, Number(tx.amount ?? 0)),
    doctorId: tx.doctor_id != null ? String(tx.doctor_id) : null,
    deletedAuditLogs: auditIds.length,
  };
}

/** يحذف كل شحنات رصيد العيادة + سجل المراقبة المرتبط */
export async function clearClinicBalanceTopups(
  admin: SupabaseClient,
  clinicId: string,
  opts?: { from?: string; to?: string }
): Promise<ClearClinicTopUpsResult> {
  let txQuery = admin
    .from("transactions")
    .select("id, reference_id")
    .eq("clinic_id", clinicId)
    .eq("type", BALANCE_TOPUP_CLINIC_TYPE);

  if (opts?.from) txQuery = txQuery.gte("transaction_date", opts.from);
  if (opts?.to) txQuery = txQuery.lte("transaction_date", opts.to);

  const { data: txRows, error: fetchErr } = await txQuery;
  if (fetchErr) {
    return {
      ok: false,
      deletedTransactions: 0,
      deletedAuditLogs: 0,
      error: fetchErr.message,
    };
  }

  const txIds = (txRows ?? []).map((r) => String(r.id));
  const refIds = (txRows ?? [])
    .map((r) => (r.reference_id != null ? String(r.reference_id) : null))
    .filter((id): id is string => Boolean(id));

  const auditIdSet = new Set<string>();

  if (refIds.length > 0) {
    const { data: auditByRef, error: auditFetchErr } = await admin
      .from("audit_logs")
      .select("id")
      .eq("clinic_id", clinicId)
      .eq("entity_type", "financial_transaction")
      .in("entity_id", refIds);

    if (auditFetchErr) {
      return {
        ok: false,
        deletedTransactions: 0,
        deletedAuditLogs: 0,
        error: auditFetchErr.message,
      };
    }

    for (const row of auditByRef ?? []) {
      auditIdSet.add(String(row.id));
    }
  }

  const { data: auditTopups, error: auditTopupFetchErr } = await admin
    .from("audit_logs")
    .select("id")
    .eq("clinic_id", clinicId)
    .eq("entity_type", "financial_transaction")
    .filter("after_data->>type", "eq", BALANCE_TOPUP_CLINIC_TYPE);

  if (auditTopupFetchErr) {
    return {
      ok: false,
      deletedTransactions: 0,
      deletedAuditLogs: 0,
      error: auditTopupFetchErr.message,
    };
  }

  for (const row of auditTopups ?? []) {
    auditIdSet.add(String(row.id));
  }

  const auditIds = [...auditIdSet];
  if (auditIds.length > 0) {
    const { error: auditDelErr } = await admin
      .from("audit_logs")
      .delete()
      .in("id", auditIds);
    if (auditDelErr) {
      return {
        ok: false,
        deletedTransactions: 0,
        deletedAuditLogs: 0,
        error: auditDelErr.message,
      };
    }
  }

  const deletedAuditLogs = auditIds.length;

  if (txIds.length > 0) {
    const { error: txDelErr } = await admin
      .from("transactions")
      .delete()
      .in("id", txIds);
    if (txDelErr) {
      return {
        ok: false,
        deletedTransactions: 0,
        deletedAuditLogs: 0,
        error: txDelErr.message,
      };
    }
  }

  return {
    ok: true,
    deletedTransactions: txIds.length,
    deletedAuditLogs,
  };
}
