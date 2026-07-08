/** Prevent duplicate alerts from polling + realtime firing together */
const recentKeys = new Set<string>();
const SESSION_KEY = "mcp-queue-alert-keys";
const DEDUPE_MS = 45_000;

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

function entryIdFromPushTag(tag?: string | null): string | undefined {
  const trimmed = tag?.trim();
  if (!trimmed) return undefined;
  const match = trimmed.match(/^(?:admit|billing|payment|doctor-queue)-(.+)$/);
  return match?.[1];
}

/** Dedupe key for Realtime / polling / Web Push on the same queue event */
export function queueAlertDedupeKey(input: {
  kind?: string | null;
  entryId?: string | null;
  tag?: string | null;
  sentAt?: string | null;
}): string | null {
  const kind = input.kind?.trim() ?? "";
  const entryId =
    input.entryId?.trim() || entryIdFromPushTag(input.tag) || undefined;
  if (!entryId) return null;

  switch (kind) {
    case "accountant_admit":
      return input.sentAt
        ? `accountant-recall-${entryId}-${input.sentAt}`
        : `accountant-called-${entryId}`;
    case "accountant_billing":
    case "accountant_payment":
      return `accountant-billing-${entryId}`;
    case "doctor_queue":
    case "doctor_new":
      return input.sentAt
        ? `doctor-recall-${entryId}-${input.sentAt}`
        : `doctor-new-${entryId}`;
    default:
      return null;
  }
}
