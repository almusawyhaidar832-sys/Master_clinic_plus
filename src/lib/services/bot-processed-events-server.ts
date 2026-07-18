import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

/** سجلّ عزل تكرار عام (idempotency) لأحداث خارجية — غير مرتبط بنوع حدث معيّن */
export interface ProcessedEventRow {
  id: string;
  clinic_id: string;
  idempotency_key: string;
  processed_at: string;
  created_at: string;
}

const UNIQUE_VIOLATION = "23505";

const EVENT_COLUMNS = "id, clinic_id, idempotency_key, processed_at, created_at";

/** يبحث عن حدث مُعالَج مسبقاً بهذا المفتاح لهذه العيادة — null إن لم يوجد */
export async function getProcessedEvent(
  admin: SupabaseClient,
  clinicId: string,
  idempotencyKey: string
): Promise<ProcessedEventRow | null> {
  const { data, error } = await admin
    .from("bot_processed_events")
    .select(EVENT_COLUMNS)
    .eq("clinic_id", clinicId)
    .eq("idempotency_key", idempotencyKey)
    .maybeSingle();

  if (error) throw new Error(error.message);
  return (data as ProcessedEventRow | null) ?? null;
}

/**
 * يسجّل حدثاً كمُعالَج — إذا كان موجوداً مسبقاً (نفس clinic_id + idempotency_key)
 * يرجع السجل الموجود بدون خطأ وبدون تكرار (created: false).
 */
export async function recordProcessedEvent(
  admin: SupabaseClient,
  clinicId: string,
  idempotencyKey: string
): Promise<{ record: ProcessedEventRow; created: boolean }> {
  const { data, error } = await admin
    .from("bot_processed_events")
    .insert({ clinic_id: clinicId, idempotency_key: idempotencyKey })
    .select(EVENT_COLUMNS)
    .maybeSingle();

  if (!error && data) {
    return { record: data as ProcessedEventRow, created: true };
  }

  const isDuplicate = (error as { code?: string } | null)?.code === UNIQUE_VIOLATION;
  if (isDuplicate) {
    const existing = await getProcessedEvent(admin, clinicId, idempotencyKey);
    if (existing) return { record: existing, created: false };
  }

  throw new Error(error?.message ?? "تعذّر تسجيل الحدث");
}
