import type { SupabaseClient } from "@supabase/supabase-js";
import type { InvoiceHistoryRow } from "@/lib/services/invoice-archive";
import {
  computeLabCostSplit,
  labDetailsFromSnapshot,
  labSplitFromHistoryRow,
} from "@/lib/invoices/lab-session-details";

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

async function enrichHistoryRowsWithLabSplit(
  admin: SupabaseClient,
  rows: InvoiceHistoryRow[]
): Promise<InvoiceHistoryRow[]> {
  const needsEnrich = rows.filter((row) => {
    if (labSplitFromHistoryRow(row)) return false;
    const lab = labDetailsFromSnapshot(row.snapshot_json);
    return lab.materialsCost > 0 && !!row.doctor_id;
  });

  if (needsEnrich.length === 0) return rows;

  const doctorIds = [
    ...new Set(
      needsEnrich
        .map((row) => row.doctor_id)
        .filter((id): id is string => Boolean(id))
    ),
  ];

  const { data: doctors } = await admin
    .from("doctors")
    .select("id, materials_share")
    .in("id", doctorIds);

  const materialsShareByDoctor = new Map(
    (doctors ?? []).map((d) => [
      d.id as string,
      Number(d.materials_share ?? 50),
    ])
  );

  return rows.map((row) => {
    if (labSplitFromHistoryRow(row)) return row;

    const lab = labDetailsFromSnapshot(row.snapshot_json);
    if (lab.materialsCost <= 0 || !row.doctor_id) return row;

    const pct = materialsShareByDoctor.get(row.doctor_id) ?? 50;
    const split = computeLabCostSplit(lab.materialsCost, pct);
    if (!split) return row;

    const baseSnapshot =
      row.snapshot_json && typeof row.snapshot_json === "object"
        ? (row.snapshot_json as Record<string, unknown>)
        : {};

    return {
      ...row,
      snapshot_json: {
        ...baseSnapshot,
        materialsCost: split.materialsCost,
        materialsSharePct: split.materialsSharePct,
        labDoctorShare: split.doctorShare,
        labClinicShare: split.clinicShare,
      },
    };
  });
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

  const enriched = await enrichHistoryRowsWithLabSplit(admin, rows);

  return { rows: enriched, total: count ?? enriched.length };
}
