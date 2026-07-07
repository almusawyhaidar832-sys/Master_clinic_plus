"use client";

/** يمنع طلبات /api/tts/speak المتكررة عند فشل الخدمة — يوفّر invocations وCPU */
const OPEN_AFTER_FAILURES = 2;
const COOLDOWN_MS = 10 * 60 * 1000;

let consecutiveFailures = 0;
let circuitOpenUntil = 0;

export function isTtsSpeakCircuitOpen(): boolean {
  if (circuitOpenUntil === 0) return false;
  if (Date.now() >= circuitOpenUntil) {
    circuitOpenUntil = 0;
    consecutiveFailures = 0;
    return false;
  }
  return true;
}

export function recordTtsSpeakSuccess(): void {
  consecutiveFailures = 0;
  circuitOpenUntil = 0;
}

/** false = لا تُعاد المحاولة (4xx/5xx من السيرفر) */
export function recordTtsSpeakFailure(retryable: boolean): void {
  if (!retryable) {
    consecutiveFailures = OPEN_AFTER_FAILURES;
  } else {
    consecutiveFailures += 1;
  }
  if (consecutiveFailures >= OPEN_AFTER_FAILURES) {
    circuitOpenUntil = Date.now() + COOLDOWN_MS;
  }
}
