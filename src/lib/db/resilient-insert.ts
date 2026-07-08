import type { SupabaseClient } from "@supabase/supabase-js";

type AnyRow = Record<string, unknown>;

/**
 * يستخرج اسم العمود المفقود من رسالة PostgREST:
 * "Could not find the 'created_by' column of 'expenses' in the schema cache"
 */
function extractMissingColumn(message: string | null | undefined): string | null {
  if (!message) return null;
  const m = message.match(/Could not find the '([^']+)' column/i);
  return m?.[1] ?? null;
}

/** هل الخطأ بسبب عمود غير موجود في الـ schema cache؟ */
export function isMissingColumnError(
  error: { code?: string; message?: string } | null | undefined
): boolean {
  if (!error) return false;
  if (error.code === "PGRST204") return true;
  return extractMissingColumn(error.message) != null;
}

export interface ResilientInsertResult<T> {
  data: T | null;
  error: { message: string; code?: string } | null;
  /** الأعمدة الاختيارية التي أُسقطت لأن قاعدة البيانات لا تعرفها */
  droppedColumns: string[];
}

/**
 * إدراج مقاوم لاختلاف السكيمة: إذا رفض PostgREST عموداً اختيارياً غير موجود
 * (schema cache قديم أو عمود لم يُضَف بعد)، يُسقط ذلك العمود ويُعيد المحاولة
 * تلقائياً بدل أن يفشل الحفظ بالكامل.
 *
 * الأعمدة الإلزامية لا تُسقط أبداً — أي مشكلة فيها تُعاد كخطأ حقيقي.
 */
export async function insertResilient<T = { id: string }>(
  client: SupabaseClient,
  table: string,
  row: AnyRow,
  opts: {
    /** ما يُختار بعد الإدراج (افتراضي: "id") */
    select?: string;
    /** الأعمدة التي يجوز إسقاطها عند غيابها من السكيمة */
    optionalColumns: string[];
    /** إرجاع صف واحد (افتراضي: true) */
    single?: boolean;
  }
): Promise<ResilientInsertResult<T>> {
  const select = opts.select ?? "id";
  const single = opts.single ?? true;
  const optional = new Set(opts.optionalColumns);
  const current: AnyRow = { ...row };
  const dropped: string[] = [];

  // نحاول مرة لكل عمود اختياري + مرة أخيرة
  for (let attempt = 0; attempt <= optional.size; attempt++) {
    const query = client.from(table).insert(current).select(select);
    const res = single ? await query.single() : await query;

    if (!res.error) {
      return { data: res.data as T, error: null, droppedColumns: dropped };
    }

    const missing = extractMissingColumn(res.error.message);
    if (missing && optional.has(missing) && missing in current) {
      delete current[missing];
      dropped.push(missing);
      if (process.env.NODE_ENV !== "production") {
        console.warn(
          `[insertResilient] عمود '${missing}' غير موجود في '${table}' — أُسقط وأُعيدت المحاولة`
        );
      }
      continue;
    }

    return {
      data: null,
      error: { message: res.error.message, code: res.error.code },
      droppedColumns: dropped,
    };
  }

  return {
    data: null,
    error: { message: `تعذر الإدراج في ${table} بعد إسقاط الأعمدة الاختيارية` },
    droppedColumns: dropped,
  };
}
