export function isBrowserOffline(): boolean {
  return typeof navigator !== "undefined" && navigator.onLine === false;
}

export function isNetworkFailure(err: unknown): boolean {
  if (isBrowserOffline()) return true;
  if (err instanceof TypeError) {
    const msg = err.message.toLowerCase();
    return msg.includes("fetch") || msg.includes("network");
  }
  return false;
}
