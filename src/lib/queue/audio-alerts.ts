"use client";

import {
  splitAccountantAdmitSpeech,
  splitDoctorExamSpeech,
  splitDoctorNewPatientSpeech,
} from "@/lib/queue/arabic-speech-text";
import { showBrowserNotification } from "@/lib/queue/realtime-client";
import {
  prepareSpeechAuto,
  speakArabic,
  speakPatientCallParts,
} from "@/lib/queue/web-speech";

export type QueueAlertKind =
  | "doctor_new"
  | "doctor_exam"
  | "accountant_admit";

export interface QueueAlertDetail {
  kind: QueueAlertKind;
  title: string;
  message: string;
  linkPath?: string;
  /** لنطق الاسم بمخارج أوضح */
  patientName?: string;
}

const QUEUE_ALERT_EVENT = "master-clinic-queue-alert";
export const AUDIO_ALERTS_CONSENT_KEY = "mcp-audio-alerts-unlocked";

let ctx: AudioContext | null = null;
let audioReady = false;
let globalUnlockInstalled = false;

export function isQueueAudioReady() {
  return audioReady;
}

export function hasPersistedAudioConsent(): boolean {
  if (typeof window === "undefined") return false;
  try {
    return localStorage.getItem(AUDIO_ALERTS_CONSENT_KEY) === "1";
  } catch {
    return false;
  }
}

function persistAudioConsent(): void {
  if (typeof window === "undefined") return;
  try {
    localStorage.setItem(AUDIO_ALERTS_CONSENT_KEY, "1");
  } catch {
    // private browsing / quota
  }
}

/** Unlock Web Audio — browsers block sound until user interacts with the page */
export async function unlockQueueAudio(): Promise<boolean> {
  if (typeof window === "undefined") return false;
  try {
    if (!ctx) ctx = new AudioContext();
    if (ctx.state === "suspended") await ctx.resume();
    audioReady = ctx.state === "running";
    if (audioReady) persistAudioConsent();
    return audioReady;
  } catch {
    return false;
  }
}

/** تشغيل MP3 عبر Web Audio (Android يمنع HTMLAudioElement بعد fetch بعيد) */
export async function playBlobViaQueueAudio(blob: Blob): Promise<void> {
  const ok = await unlockQueueAudio();
  if (!ok || !ctx) throw new Error("audio locked");

  const buffer = await blob.arrayBuffer();
  const audioBuffer = await ctx.decodeAudioData(buffer.slice(0));

  await new Promise<void>((resolve, reject) => {
    const source = ctx!.createBufferSource();
    source.buffer = audioBuffer;
    source.connect(ctx!.destination);
    source.onended = () => resolve();
    try {
      source.start(0);
    } catch (e) {
      reject(e);
    }
  });
}

/**
 * Install once per tab — any click/keypress unlocks audio silently.
 * No UI prompt; consent is saved to localStorage for future sessions.
 */
export function installGlobalAudioUnlock(onUnlocked?: () => void): () => void {
  if (typeof window === "undefined") return () => {};

  const tryUnlock = () => {
    void unlockQueueAudio().then((ok) => {
      if (!ok) return;
      prepareSpeechAuto();
      onUnlocked?.();
      window.removeEventListener("pointerdown", tryUnlock, true);
      window.removeEventListener("keydown", tryUnlock, true);
      globalUnlockInstalled = false;
    });
  };

  if (globalUnlockInstalled) {
    return () => {};
  }

  globalUnlockInstalled = true;
  window.addEventListener("pointerdown", tryUnlock, { capture: true });
  window.addEventListener("keydown", tryUnlock, { capture: true });

  return () => {
    window.removeEventListener("pointerdown", tryUnlock, true);
    window.removeEventListener("keydown", tryUnlock, true);
    globalUnlockInstalled = false;
  };
}

/** @deprecated Use installGlobalAudioUnlock via AudioAlertsProvider */
export function installQueueAudioUnlock(): () => void {
  return installGlobalAudioUnlock();
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

async function speakQueueAlertVoice(
  detail: QueueAlertDetail,
  options?: { clearQueue?: boolean }
): Promise<void> {
  prepareSpeechAuto();
  /** صوت Bassel العراقي من السحابة — نفس نطق المحاسب وشاشة الانتظار */
  const speechOpts = { useCloud: true as const, clearQueue: options?.clearQueue };

  if (detail.patientName?.trim()) {
    const name = detail.patientName.trim();
    if (detail.kind === "doctor_new") {
      await speakPatientCallParts(splitDoctorNewPatientSpeech(name), speechOpts);
      return;
    }
    if (detail.kind === "doctor_exam") {
      await speakPatientCallParts(splitDoctorExamSpeech(name), speechOpts);
      return;
    }
    if (detail.kind === "accountant_admit") {
      await speakPatientCallParts(splitAccountantAdmitSpeech(name), speechOpts);
      return;
    }
  }

  await speakArabic(detail.message, speechOpts);
}

/** إعادة تشغيل صوت التنبيه فوراً */
export function replayQueueAlert(detail: QueueAlertDetail): void {
  void (async () => {
    await unlockQueueAudio();
    await playQueueAlertSound(detail.kind);
    await speakQueueAlertVoice(detail, { clearQueue: true });
  })();
}

/** Sound + voice + browser notification + on-screen banner */
export async function triggerQueueAlert(detail: QueueAlertDetail) {
  dispatchQueueAlertUI(detail);
  await unlockQueueAudio();
  await playQueueAlertSound(detail.kind);
  await speakQueueAlertVoice(detail);
  showBrowserNotification(detail.title, detail.message, detail.linkPath);
}
