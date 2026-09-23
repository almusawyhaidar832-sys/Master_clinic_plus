const inflightByClient = new WeakMap<object, Map<string, Promise<unknown>>>();

/**
 * يشارك نفس الاستعلام إذا طُلب مرتين في نفس اللحظة (مثلاً داخل Promise.all واحد).
 * لا يوجد تخزين بعد انتهاء الطلب — كل استدعاء لاحق يجلب بيانات جديدة.
 */
export function dedupeInflight<T>(
  client: object,
  key: string,
  run: () => Promise<T>
): Promise<T> {
  let byKey = inflightByClient.get(client);
  if (!byKey) {
    byKey = new Map();
    inflightByClient.set(client, byKey);
  }
  const existing = byKey.get(key);
  if (existing) return existing as Promise<T>;

  const map = byKey;
  const promise = run().finally(() => {
    if (map.get(key) === promise) map.delete(key);
  });
  map.set(key, promise);
  return promise;
}
