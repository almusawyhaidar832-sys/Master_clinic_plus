import type { PostgrestError, SupabaseClient } from "@supabase/supabase-js";

export type WithdrawalStatusUpdate = "approved" | "paid" | "rejected";

export function buildWithdrawalStatusUpdate(
  status: WithdrawalStatusUpdate,
  processedBy: string
) {
  return {
    status,
    processed_at: new Date().toISOString(),
    processed_by: processedBy,
  };
}

function isMissingColumnError(error: PostgrestError, column: string): boolean {
  const msg = error.message.toLowerCase();
  return (
    msg.includes(`'${column}' column`) ||
    msg.includes(`"${column}" column`) ||
    (msg.includes("column") && msg.includes(column.toLowerCase()))
  );
}

const PROCESSED_BY_MIGRATION_HINT =
  "شغّل ملف SQL: supabase/migrations/20260602150000_withdrawals_processed_columns.sql في Supabase";

/** Updates withdrawal status; retries without optional columns if schema is outdated */
export async function applyWithdrawalStatusUpdate(
  supabase: SupabaseClient,
  id: string,
  status: WithdrawalStatusUpdate,
  processedBy: string
): Promise<{ error: PostgrestError | null; missingProcessedBy?: boolean }> {
  const full = buildWithdrawalStatusUpdate(status, processedBy);

  let result = await supabase
    .from("doctor_withdrawals")
    .update(full)
    .eq("id", id);

  if (!result.error) return { error: null };

  if (isMissingColumnError(result.error, "processed_by")) {
    const { processed_by: _by, ...withoutBy } = full;
    result = await supabase
      .from("doctor_withdrawals")
      .update(withoutBy)
      .eq("id", id);

    if (!result.error) {
      return { error: null, missingProcessedBy: true };
    }

    if (isMissingColumnError(result.error, "processed_at")) {
      result = await supabase
        .from("doctor_withdrawals")
        .update({ status })
        .eq("id", id);

      if (!result.error) {
        return { error: null, missingProcessedBy: true };
      }
    }

    const err = result.error;
    return {
      error: err
        ? Object.assign(err, {
            message: `عمود processed_by غير موجود في قاعدة البيانات. ${PROCESSED_BY_MIGRATION_HINT}`,
          })
        : null,
    };
  }

  if (isMissingColumnError(result.error, "processed_at")) {
    const { processed_at: _at, ...withoutAt } = full;
    result = await supabase
      .from("doctor_withdrawals")
      .update(withoutAt)
      .eq("id", id);

    if (!result.error) return { error: null };
  }

  return { error: result.error };
}
