/**
 * PostgREST (Supabase) يرجّع 1000 صف كحد أقصى لكل طلب بدون أي خطأ —
 * أي مجموع مالي على استعلام واحد يصير ناقص بصمت بعد ما تكبر البيانات.
 * هذا المساعد يجلب كل الصفحات. الاستعلام لازم يكون بترتيب ثابت (ORDER BY
 * على عمود فريد مثل id) حتى لا تتكرر أو تسقط صفوف بين الصفحات.
 */
export const SUPABASE_PAGE_SIZE = 1000;

type PageResult = { data: unknown; error: unknown };

type RangeableQuery = {
  range: (from: number, to: number) => PromiseLike<PageResult>;
};

export async function fetchAllRows<T>(
  buildQuery: () => RangeableQuery,
  pageSize = SUPABASE_PAGE_SIZE
): Promise<{ data: T[] | null; error: { message: string } | null }> {
  const rows: T[] = [];
  for (let offset = 0; ; offset += pageSize) {
    const { data, error } = await buildQuery().range(
      offset,
      offset + pageSize - 1
    );
    if (error) {
      return { data: null, error: error as { message: string } };
    }
    const page = (data ?? []) as T[];
    rows.push(...page);
    if (page.length < pageSize) break;
  }
  return { data: rows, error: null };
}

/**
 * `.in(col, ids)` تنكتب داخل رابط الطلب — قائمة كبيرة (مئات المعرّفات) تفشل
 * بخطأ طول الرابط. نقسّمها دفعات ونجلب كل دفعة بكل صفحاتها.
 */
export const SUPABASE_IN_CHUNK_SIZE = 150;

export async function fetchAllRowsInChunks<T, V = string>(
  values: readonly V[],
  buildQuery: (chunk: V[]) => RangeableQuery,
  chunkSize = SUPABASE_IN_CHUNK_SIZE,
  pageSize = SUPABASE_PAGE_SIZE
): Promise<{ data: T[] | null; error: { message: string } | null }> {
  const unique = [...new Set(values)];
  const rows: T[] = [];
  for (let i = 0; i < unique.length; i += chunkSize) {
    const chunk = unique.slice(i, i + chunkSize);
    const { data, error } = await fetchAllRows<T>(
      () => buildQuery(chunk),
      pageSize
    );
    if (error) return { data: null, error };
    rows.push(...(data ?? []));
  }
  return { data: rows, error: null };
}
