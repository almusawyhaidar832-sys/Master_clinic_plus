"use client";

import {
  announceArabic,
  showBrowserNotification,
} from "@/lib/queue/realtime-client";

export type QueueAlertKind = "doctor_new" | "accountant_admit";

export interface QueueAlertDetail {
  kind: QueueAlertKind;
  title: string;
  message: string;
  linkPath?: string;
}

const QUEUE_ALERT_EVENT = "master-clinic-queue-alert";

let ctx: AudioContext | null = null;
let audioReady = false;

export function isQueueAudioReady() {
  return audioReady;
}

/** Unlock Web Audio — browsers block sound until user interacts with the page */
export async function unlockQueueAudio(): Promise<boolean> {
  if (typeof window === "undefined") return false;
  try {
    if (!ctx) ctx = new AudioContext();
    if (ctx.state === "suspended") await ctx.resume();
    audioReady = ctx.state === "running";
    return audioReady;
  } catch {
    return false;
  }
}

/** Call once on layout mount — any click/keypress unlocks audio */
export function installQueueAudioUnlock(): () => void {
  if (typeof window === "undefined") return () => {};

  const unlock = () => {
    void unlockQueueAudio();
  };

  window.addEventListener("pointerdown", unlock, { capture: true });
  window.addEventListener("keydown", unlock, { capture: true });

  return () => {
    window.removeEventListener("pointerdown", unlock, { capture: true });
    window.removeEventListener("keydown", unlock, { capture: true });
  };
}

function tone(
  audioCtx: AudioContext,
  frequency: number,
  startOffset: number,
  duration: number,
  volume = 0.35
) {
  const osc = audioCtx.createOscillator();
  const gain = audioCtx.createGain();
  osc.type = "sine";
  osc.frequency.value = frequency;
  gain.gain.value = volume;
  osc.connect(gain);
  gain.connect(audioCtx.destination);

  const start = audioCtx.currentTime + startOffset;
  osc.start(start);
  osc.stop(start + duration);
  gain.gain.setValueAtTime(volume, start);
  gain.gain.exponentialRampToValueAtTime(0.001, start + duration);
}

/** Distinct chimes: doctor = 3 rising beeps, accountant = 2 long pulses */
export async function playQueueAlertSound(
  kind: QueueAlertKind = "doctor_new"
): Promise<void> {
  if (typeof window === "undefined") return;

  try {
    if (!ctx) ctx = new AudioContext();
    if (ctx.state === "suspended") await ctx.resume();
    audioReady = ctx.state === "running";
    if (!audioReady) return;

    if (kind === "doctor_new") {
      tone(ctx, 660, 0, 0.18);
      tone(ctx, 880, 0.22, 0.18);
      tone(ctx, 1100, 0.44, 0.28, 0.45);
    } else {
      tone(ctx, 520, 0, 0.35, 0.45);
      tone(ctx, 780, 0.42, 0.35, 0.45);
    }
  } catch {
    // autoplay blocked until user gesture
  }
}

export function subscribeQueueAlerts(
  handler: (detail: QueueAlertDetail) => void
): () => void {
  if (typeof window === "undefined") return () => {};

  const listener = (event: Event) => {
    handler((event as CustomEvent<QueueAlertDetail>).detail);
  };

  window.addEventListener(QUEUE_ALERT_EVENT, listener);
  return () => window.removeEventListener(QUEUE_ALERT_EVENT, listener);
}

function dispatchQueueAlertUI(detail: QueueAlertDetail) {
  window.dispatchEvent(
    new CustomEvent(QUEUE_ALERT_EVENT, { detail })
  );
}

/** Sound + voice + browser notification + on-screen banner */
export async function triggerQueueAlert(detail: QueueAlertDetail) {
  dispatchQueueAlertUI(detail);
  await playQueueAlertSound(detail.kind);
  announceArabic(detail.message);
  showBrowserNotification(detail.title, detail.message, detail.linkPath);
}
