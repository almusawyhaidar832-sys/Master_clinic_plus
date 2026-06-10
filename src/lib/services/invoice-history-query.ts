import type { SupabaseClient } from "@supabase/supabase-js";
import type { InvoiceHistoryRow } from "@/lib/services/invoice-archive";

export interface InvoiceHistoryFilters {
  clinicId: string;
  doctorId?: string | null;
  dateFrom?: string | null;
  dateTo?: string | null;
  limit?: number;
  offset?: number;
}

export interface InvoiceHistoryQueryResult {
  rows: InvoiceHistoryRow[];
  total: number;
}

export async function fetchInvoiceHistory(
  admin: SupabaseClient,
  filters: InvoiceHistoryFilters
): Promise<InvoiceHistoryQueryResult> {
  const limit = Math.min(Math.max(filters.limit ?? 50, 1), 200);
  const offset = Math.max(filters.offset ?? 0, 0);

  let query = admin
    .from("invoices_history")
    .select("*", { count: "exact" })
    .eq("clinic_id", filters.clinicId)
    .order("invoice_date", { ascending: false })
    .order("finalized_at", { ascending: false });

  if (filters.doctorId) {
    query = query.eq("doctor_id", filters.doctorId);
  }
  if (filters.dateFrom) {
    query = query.gte("invoice_date", filters.dateFrom);
  }
  if (filters.dateTo) {
    query = query.lte("invoice_date", filters.dateTo);
  }

  query = query.range(offset, offset + limit - 1);

  const { data, count, error } = await query;

  if (error) {
    throw new Error(error.message);
  }

  const rows = (data ?? []).map((row) => ({
    ...row,
    total_amount: Number(row.total_amount ?? 0),
    paid_amount: Number(row.paid_amount ?? 0),
    remaining_amount: Number(row.remaining_amount ?? 0),
    doctor_share: Number(row.doctor_share ?? 0),
    clinic_share: Number(row.clinic_share ?? 0),
    snapshot_json: row.snapshot_json as InvoiceHistoryRow["snapshot_json"],
  })) as InvoiceHistoryRow[];

  return { rows, total: count ?? rows.length };
}
