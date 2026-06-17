/** مسودات النماذج — تبقى عند الخروج للتطبيق الآخر والعودة لنفس التبويب */

const MAX_DRAFT_AGE_MS = 48 * 60 * 60 * 1000;

export function readSessionDraft<T extends { savedAt?: string }>(
  key: string
): T | null {
  if (typeof sessionStorage === "undefined") return null;
  try {
    const raw = sessionStorage.getItem(key);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as T;
    const savedAt = parsed.savedAt ? Date.parse(parsed.savedAt) : NaN;
    if (!Number.isFinite(savedAt) || Date.now() - savedAt > MAX_DRAFT_AGE_MS) {
      sessionStorage.removeItem(key);
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

export function writeSessionDraft<T>(key: string, value: T): void {
  if (typeof sessionStorage === "undefined") return;
  try {
    sessionStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* مساحة ممتلئة — نتجاهل */
  }
}

export function clearSessionDraft(key: string): void {
  if (typeof sessionStorage === "undefined") return;
  try {
    sessionStorage.removeItem(key);
  } catch {
    /* ignore */
  }
}
