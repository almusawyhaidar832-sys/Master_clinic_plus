/** Prevent duplicate alerts from polling + realtime firing together */
const recentKeys = new Set<string>();

export function shouldFireQueueAlert(key: string, force = false): boolean {
  if (force) return true;
  if (recentKeys.has(key)) return false;
  recentKeys.add(key);
  setTimeout(() => recentKeys.delete(key), 90_000);
  return true;
}
