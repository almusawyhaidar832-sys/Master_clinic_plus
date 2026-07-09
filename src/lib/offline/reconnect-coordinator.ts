import { isBrowserOffline } from "@/lib/offline/network";
import { runOfflineSync } from "@/lib/offline/sync/runner";

export const OFFLINE_RECONNECT_EVENT = "mcp:offline-reconnect";

const DEBOUNCE_MS = 1500;

let debounceTimer: ReturnType<typeof setTimeout> | null = null;
let reconnectInFlight = false;
let installed = false;

async function runReconnectWork(): Promise<void> {
  if (typeof window === "undefined" || isBrowserOffline() || reconnectInFlight) {
    return;
  }

  reconnectInFlight = true;
  try {
    await runOfflineSync();
    window.dispatchEvent(new CustomEvent(OFFLINE_RECONNECT_EVENT));
  } finally {
    reconnectInFlight = false;
  }
}

export function scheduleReconnectWork(): void {
  if (typeof window === "undefined" || isBrowserOffline()) return;
  if (debounceTimer) clearTimeout(debounceTimer);
  debounceTimer = setTimeout(() => {
    debounceTimer = null;
    void runReconnectWork();
  }, DEBOUNCE_MS);
}

export function installReconnectCoordinator(): () => void {
  if (typeof window === "undefined" || installed) return () => {};
  installed = true;

  const onOnline = () => scheduleReconnectWork();
  const onVisible = () => {
    if (document.visibilityState === "visible") scheduleReconnectWork();
  };

  window.addEventListener("online", onOnline);
  document.addEventListener("visibilitychange", onVisible);

  return () => {
    installed = false;
    if (debounceTimer) clearTimeout(debounceTimer);
    window.removeEventListener("online", onOnline);
    document.removeEventListener("visibilitychange", onVisible);
  };
}

export function onOfflineReconnect(
  listener: () => void | Promise<void>
): () => void {
  if (typeof window === "undefined") return () => {};
  const handler = () => {
    void listener();
  };
  window.addEventListener(OFFLINE_RECONNECT_EVENT, handler);
  return () => window.removeEventListener(OFFLINE_RECONNECT_EVENT, handler);
}
