"use client";

import {
  joinPatientCallSpeech,
  splitPatientCallSpeech,
  type PatientCallSpeechParts,
} from "@/lib/queue/arabic-speech-text";
import {
  clearCloudSpeechQueue,
  speakViaCloudTtsParts,
  speakViaCloudTtsText,
} from "@/lib/queue/cloud-speech";
import {
  isTvAudioUnlocked,
  playBeepViaAudioElement,
  unlockTvAudio,
} from "@/lib/queue/tv-audio";

export type SpeechPlayOptions = {
  useCloud?: boolean;
  clearQueue?: boolean;
};

let audioCtx: AudioContext | null = null;
let autoPrepared = false;
let speechGestureUnlocked = false;
let cachedArabicVoice: SpeechSynthesisVoice | null = null;
let browserSpeechChain: Promise<void> = Promise.resolve();

const BROWSER_SPEECH_RATE = 0.95;
const AUDIO_UNLOCK_KEY = "mcp-queue-screen-audio-unlocked";

type AudioContextCtor = typeof AudioContext;

function getAudioContextClass(): AudioContextCtor | null {
  if (typeof window === "undefined") return null;
  return (
    window.AudioContext ??
    (window as Window & { webkitAudioContext?: AudioContextCtor }).webkitAudioContext ??
    null
  );
}

function createAudioContext(): AudioContext | null {
  const Ctx = getAudioContextClass();
  if (!Ctx) return null;
  try {
    return new Ctx();
  } catch {
    return null;
  }
}

function getSynth(): SpeechSynthesis | null {
  if (typeof window === "undefined" || !("speechSynthesis" in window)) return null;
  return window.speechSynthesis;
}

/** إيقاف كل النداءات المعلّقة */
export function stopAllSpeech(): void {
  browserSpeechChain = Promise.resolve();
  clearCloudSpeechQueue();
  try {
    getSynth()?.cancel();
  } catch {
    // ignore
  }
}

export function prepareSpeechAuto(): void {
  if (typeof window === "undefined" || autoPrepared) return;
  autoPrepared = true;

  void (async () => {
    await waitForVoices(2000);
    const voices = getSynth()?.getVoices() ?? [];
    cachedArabicVoice = pickArabicVoice(voices);
    try {
      if (!audioCtx) audioCtx = createAudioContext();
      if (audioCtx?.state === "suspended") await audioCtx.resume();
    } catch {
      // ignore
    }
    try {
      getSynth()?.resume();
    } catch {
      // ignore
    }
  })();
}

export function isSpeechGestureUnlocked(): boolean {
  return speechGestureUnlocked || isTvAudioUnlocked();
}

/**
 * تفعيل الصوت — يجب استدعاؤها داخل حدث لمس/ضغطة/زر ريموت مباشرة.
 * تفتح كل مسارات التشغيل الممكنة معاً: عنصر <audio> الثابت (أعلى توافق
 * مع شاشات التلفاز)، AudioContext، و speechSynthesis — أي مسار ينجح
 * يكفي لاعتبار الصوت مفعّلاً.
 */
export async function unlockSpeechAudio(): Promise<boolean> {
  if (typeof window === "undefined") return false;

  const tvAudioOk = await unlockTvAudio().catch(() => false);

  let audioCtxOk = false;
  try {
    if (!audioCtx) audioCtx = createAudioContext();
    if (audioCtx) {
      if (audioCtx.state === "suspended") await audioCtx.resume();
      const buffer = audioCtx.createBuffer(1, 1, 22050);
      const source = audioCtx.createBufferSource();
      source.buffer = buffer;
      source.connect(audioCtx.destination);
      source.start(0);
      audioCtxOk = audioCtx.state === "running";
    }
  } catch {
    // ignore — قد لا يدعم المتصفح Web Audio API إطلاقاً
  }

  prepareSpeechAuto();
  await waitForVoices(5000);
  try {
    getSynth()?.resume();
    getSynth()?.getVoices();
  } catch {
    // ignore
  }

  speechGestureUnlocked = tvAudioOk || audioCtxOk;
  if (speechGestureUnlocked) {
    try {
      localStorage.setItem(AUDIO_UNLOCK_KEY, "1");
    } catch {
      // private mode
    }
  }
  return speechGestureUnlocked;
}

export function hasPersistedSpeechUnlock(): boolean {
  if (typeof window === "undefined") return false;
  try {
    return localStorage.getItem(AUDIO_UNLOCK_KEY) === "1";
  } catch {
    return false;
  }
}

export async function waitForVoices(timeoutMs = 2000): Promise<SpeechSynthesisVoice[]> {
  const synth = getSynth();
  if (!synth) return [];

  const read = () => synth.getVoices().filter(Boolean);
  const existing = read();
  if (existing.length > 0) return existing;

  return new Promise((resolve) => {
    const timer = setTimeout(() => resolve(read()), timeoutMs);
    synth.addEventListener(
      "voiceschanged",
      () => {
        clearTimeout(timer);
        resolve(read());
      },
      { once: true }
    );
  });
}

function voiceScore(v: SpeechSynthesisVoice): number {
  const name = v.name.toLowerCase();
  const lang = v.lang.toLowerCase();

  if (lang === "ar-iq") return 0;
  if (/bassel|basel|iraq|عراق/i.test(v.name)) return 1;
  if (/google.*(arab|ar)/i.test(v.name)) return 2;
  if (/naayf.*natural|natural.*naayf/i.test(name)) return 3;
  if (/naayf|نايف/i.test(name)) return 4;
  if (/hoda.*natural|salma.*natural|hamed.*natural|zariyah.*natural/i.test(name)) return 5;
  if (/microsoft.*online.*natural.*ar/i.test(name)) return 6;
  if (/microsoft.*(arabic|ar).*saudi/i.test(name)) return 7;
  if (lang === "ar-sa") return 8;
  if (lang === "ar-eg") return 9;
  if (lang.startsWith("ar")) return 10;
  if (/arabic|عرب/i.test(v.name)) return 12;
  return 99;
}

function pickArabicVoice(voices: SpeechSynthesisVoice[]): SpeechSynthesisVoice | null {
  if (!voices.length) return null;
  return [...voices].sort((a, b) => voiceScore(a) - voiceScore(b))[0] ?? null;
}

async function resolveArabicVoice(): Promise<SpeechSynthesisVoice | null> {
  if (cachedArabicVoice) return cachedArabicVoice;
  const voices = await waitForVoices();
  cachedArabicVoice = pickArabicVoice(voices);
  return cachedArabicVoice;
}

function applyArabicVoice(
  utterance: SpeechSynthesisUtterance,
  voice: SpeechSynthesisVoice | null,
  rate = 0.76
) {
  utterance.lang = voice?.lang?.startsWith("ar") ? voice.lang : "ar-IQ";
  utterance.rate = rate;
  utterance.pitch = 1;
  utterance.volume = 1;
  if (voice) utterance.voice = voice;
}

export async function playAttentionBeep(): Promise<void> {
  if (typeof window === "undefined") return;

  prepareSpeechAuto();

  // المحاولة الأولى: عنصر <audio> ثابت — يعمل على كل شاشات التلفاز
  // تقريباً حتى لو كان Web Audio API غير مدعوم أو معطّلاً.
  try {
    await playBeepViaAudioElement();
    return;
  } catch {
    // fallback إلى Web Audio API
  }

  try {
    if (!audioCtx) audioCtx = createAudioContext();
    if (!audioCtx) return;
    if (audioCtx.state === "suspended") await audioCtx.resume();

    const osc = audioCtx.createOscillator();
    const gain = audioCtx.createGain();
    osc.type = "sine";
    osc.frequency.value = 880;
    gain.gain.value = 0.35;
    osc.connect(gain);
    gain.connect(audioCtx.destination);

    const t = audioCtx.currentTime;
    osc.start(t);
    gain.gain.exponentialRampToValueAtTime(0.001, t + 0.22);
    osc.stop(t + 0.22);

    await new Promise((r) => setTimeout(r, 180));
  } catch {
    // ignore
  }
}

function speakPart(
  text: string,
  voice: SpeechSynthesisVoice | null,
  rate: number,
  cancelFirst: boolean
): Promise<void> {
  return new Promise((resolve) => {
    const synth = getSynth();
    const trimmed = text.trim();
    if (!synth || !trimmed) {
      resolve();
      return;
    }

    try {
      if (cancelFirst) synth.cancel();
      synth.resume();
    } catch {
      // ignore
    }

    const utterance = new SpeechSynthesisUtterance(trimmed);
    applyArabicVoice(utterance, voice, rate);

    let settled = false;
    const finish = () => {
      if (settled) return;
      settled = true;
      resolve();
    };

    utterance.onend = finish;
    utterance.onerror = finish;

    synth.speak(utterance);
    setTimeout(finish, Math.max(4000, trimmed.length * 80));
  });
}

async function speakTextNow(text: string, options?: SpeechPlayOptions): Promise<void> {
  if (options?.clearQueue) stopAllSpeech();
  prepareSpeechAuto();

  if (options?.useCloud) {
    const usedCloud = await speakViaCloudTtsText(text);
    if (usedCloud) return;
  }

  const voice = await resolveArabicVoice();
  await speakPart(text, voice, BROWSER_SPEECH_RATE, true);
}

function enqueueBrowserSpeech(
  task: () => Promise<void>,
  options?: SpeechPlayOptions
): Promise<void> {
  if (options?.clearQueue) stopAllSpeech();
  const run = browserSpeechChain.then(task);
  browserSpeechChain = run.catch(() => {});
  return run;
}

export function speakArabic(text: string, options?: SpeechPlayOptions): Promise<void> {
  return enqueueBrowserSpeech(() => speakTextNow(text, options), options);
}

export async function speakPatientCallParts(
  parts: PatientCallSpeechParts,
  options?: SpeechPlayOptions
): Promise<void> {
  return enqueueBrowserSpeech(async () => {
    if (options?.clearQueue) stopAllSpeech();
    prepareSpeechAuto();

    if (options?.useCloud !== false) {
      const usedCloud = await speakViaCloudTtsParts(parts);
      if (usedCloud) return;
    }

    const voice = await resolveArabicVoice();
    await speakPart(joinPatientCallSpeech(parts), voice, BROWSER_SPEECH_RATE, true);
  }, options);
}

export async function speakPatientCallImmediate(
  patientName: string,
  doctorName: string,
  variant: "called" | "enter" | "queue_screen" = "called"
): Promise<void> {
  const parts = splitPatientCallSpeech(patientName, doctorName, variant);
  stopAllSpeech();
  await playAttentionBeep();
  await speakTextNow(joinPatientCallSpeech(parts), { clearQueue: true, useCloud: false });
}

export async function speakPatientCallAnnouncement(
  patientName: string,
  doctorName: string,
  variant: "called" | "enter" | "queue_screen" = "called",
  options?: SpeechPlayOptions
): Promise<void> {
  const parts = splitPatientCallSpeech(patientName, doctorName, variant);
  await speakPatientCallParts(parts, options);
}

export async function announceArabicWithBeep(
  text: string,
  options?: SpeechPlayOptions
): Promise<void> {
  await playAttentionBeep();
  await speakArabic(text, options);
}

export async function announcePatientCallWithBeep(
  patientName: string,
  doctorName: string,
  variant: "called" | "enter" | "queue_screen" = "called",
  options?: SpeechPlayOptions
): Promise<void> {
  await playAttentionBeep();
  await speakPatientCallAnnouncement(patientName, doctorName, variant, options);
}

export async function announcePatientCallImmediate(
  patientName: string,
  doctorName: string,
  variant: "called" | "enter" = "called"
): Promise<void> {
  await speakPatientCallImmediate(patientName, doctorName, variant);
}

export async function announceSpeechPartsWithBeep(
  parts: PatientCallSpeechParts,
  options?: SpeechPlayOptions
): Promise<void> {
  await playAttentionBeep();
  await speakPatientCallParts(parts, options);
}

export function installSpeechGestureUnlock(onUnlocked?: () => void): () => void {
  if (typeof window === "undefined") return () => {};

  const events = [
    "pointerdown",
    "touchstart",
    "touchend",
    "click",
    "keydown",
    "keyup",
  ] as const;

  const unlock = () => {
    void unlockSpeechAudio().then(async (ok) => {
      if (!ok) return;
      onUnlocked?.();
      try {
        await playAttentionBeep();
      } catch {
        // ignore
      }
      for (const event of events) {
        window.removeEventListener(event, unlock, true);
      }
    });
  };

  for (const event of events) {
    window.addEventListener(event, unlock, { capture: true, passive: true });
  }

  return () => {
    for (const event of events) {
      window.removeEventListener(event, unlock, true);
    }
  };
}

export function getSpeechSupport(): {
  supported: boolean;
  arabicVoice: string | null;
  unlocked: boolean;
} {
  const synth = getSynth();
  if (!synth) {
    return { supported: false, arabicVoice: null, unlocked: true };
  }
  const voice = cachedArabicVoice ?? pickArabicVoice(synth.getVoices());
  return {
    supported: true,
    arabicVoice: voice?.name ?? null,
    unlocked: isSpeechGestureUnlocked(),
  };
}
