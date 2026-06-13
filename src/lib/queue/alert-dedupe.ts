/** Prevent duplicate alerts from polling + realtime firing together */
const recentKeys = new Set<string>();
const SESSION_KEY = "mcp-queue-alert-keys";
const DEDUPE_MS = 120_000;

function readSessionKeys(): Record<string, number> {
  if (typeof sessionStorage === "undefined") return {};
  try {
    const raw = sessionStorage.getItem(SESSION_KEY);
    return raw ? (JSON.parse(raw) as Record<string, number>) : {};
  } catch {
    return {};
  }
}

function writeSessionKey(key: string): void {
  if (typeof sessionStorage === "undefined") return;
  try {
    const now = Date.now();
    const map = readSessionKeys();
    map[key] = now;
    for (const [k, ts] of Object.entries(map)) {
      if (now - ts > DEDUPE_MS) delete map[k];
    }
    sessionStorage.setItem(SESSION_KEY, JSON.stringify(map));
  } catch {
    // private mode
  }
}

export function shouldFireQueueAlert(key: string): boolean {
  if (recentKeys.has(key)) return false;

  const session = readSessionKeys();
  const last = session[key];
  if (last && Date.now() - last < DEDUPE_MS) return false;

  recentKeys.add(key);
  writeSessionKey(key);
  setTimeout(() => recentKeys.delete(key), DEDUPE_MS);
  return true;
}
