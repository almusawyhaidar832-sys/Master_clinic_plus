import type { SupabaseClient } from "@supabase/supabase-js";
import { BALANCE_TOPUP_CLINIC_TYPE } from "@/lib/services/balance-topup";

export interface ClearClinicTopUpsResult {
  ok: boolean;
  deletedTransactions: number;
  deletedAuditLogs: number;
  error?: string;
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
