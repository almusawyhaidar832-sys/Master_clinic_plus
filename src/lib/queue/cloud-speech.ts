"use client";

import { authPortalHeaders } from "@/lib/auth/api-portal";
import {
  joinPatientCallSpeech,
  type PatientCallSpeechParts,
} from "@/lib/queue/arabic-speech-text";

let speechChain: Promise<void> = Promise.resolve();

const CLOUD_TTS_TIMEOUT_MS = 18_000;
const CLOUD_TTS_ATTEMPTS = 3;
const DOCTOR_CLOUD_TTS_TIMEOUT_MS = 8_000;
const DOCTOR_CLOUD_TTS_ATTEMPTS = 1;
/** شاشة الانتظار — نداء فوري: مهلة قصيرة ومحاولة واحدة */
const QUEUE_SCREEN_TTS_TIMEOUT_MS = 4_500;
const QUEUE_SCREEN_TTS_ATTEMPTS = 1;

const ttsBlobCache = new Map<string, Blob>();
const TTS_CACHE_MAX = 24;

function isQueueScreen(): boolean {
  return (
    typeof window !== "undefined" &&
    window.location.pathname.startsWith("/queue-screen")
  );
}

function ttsCacheKey(body: Record<string, unknown>): string {
  if (body.parts && typeof body.parts === "object") {
    return joinPatientCallSpeech(body.parts as PatientCallSpeechParts);
  }
  return String(body.text ?? "").trim();
}

function storeTtsBlob(key: string, blob: Blob): void {
  if (!key) return;
  if (ttsBlobCache.size >= TTS_CACHE_MAX) {
    const oldest = ttsBlobCache.keys().next().value;
    if (oldest) ttsBlobCache.delete(oldest);
  }
  ttsBlobCache.set(key, blob);
}

/** يحمّل الصوت مسبقاً — يُستدعى عند وصول النداء قبل التشغيل */
export function prefetchCloudTts(parts: PatientCallSpeechParts): void {
  if (typeof window === "undefined") return;
  const key = joinPatientCallSpeech(parts);
  if (!key || ttsBlobCache.has(key)) return;
  void fetchCloudAudio({ parts }).then((blob) => {
    if (blob) storeTtsBlob(key, blob);
  });
}

function isDoctorPortal(): boolean {
  return (
    typeof window !== "undefined" &&
    window.location.pathname.startsWith("/doctor")
  );
}

function ttsRequestHeaders(): Record<string, string> {
  if (typeof window === "undefined") return {};
  const path = window.location.pathname;
  if (path.startsWith("/doctor")) {
    return authPortalHeaders("doctor");
  }
  if (
    path.startsWith("/dashboard") ||
    path.startsWith("/assistant") ||
    path.startsWith("/admin")
  ) {
    return authPortalHeaders("accountant");
  }
  if (path.startsWith("/queue-screen")) {
    // بعض متصفحات شاشات التلفاز الرخيصة/القديمة لا ترسل ترويسة Referer —
    // هذه الترويسة المخصّصة تضمن وصول الصوت حتى بدونها.
    return { "X-Queue-Screen-Request": "1" };
  }
  return {};
}

function enqueueSpeech(task: () => Promise<void>): void {
  speechChain = speechChain.then(task).catch(() => {});
}

export function clearCloudSpeechQueue(): void {
  speechChain = Promise.resolve();
}

async function playAudioBlob(blob: Blob): Promise<void> {
  // عنصر <audio> ثابت مُفعَّل مسبقاً — أعلى توافق مع متصفحات شاشات التلفاز
  // (Tizen / webOS / متصفحات عامة لا تدعم Chrome أو Web Audio API)
  try {
    const { playBlobViaAudioElement } = await import("@/lib/queue/tv-audio");
    await playBlobViaAudioElement(blob);
    return;
  } catch {
    // fallback إذا فشل العنصر الثابت
  }

  try {
    const { playBlobViaQueueAudio } = await import("@/lib/queue/audio-alerts");
    await playBlobViaQueueAudio(blob);
    return;
  } catch {
    // fallback for browsers without decodeAudioData on mp3
  }

  const url = URL.createObjectURL(blob);
  try {
    const audio = new Audio(url);
    audio.volume = 1;
    audio.setAttribute("playsinline", "true");
    audio.preload = "auto";
    await new Promise<void>((resolve, reject) => {
      audio.onended = () => resolve();
      audio.onerror = () => reject(new Error("تعذر تشغيل الصوت"));
      void audio.play().catch(reject);
    });
  } finally {
    URL.revokeObjectURL(url);
  }
}

async function fetchCloudAudioOnce(
  body: Record<string, unknown>,
  signal: AbortSignal
): Promise<Blob | null> {
  const res = await fetch("/api/tts/speak", {
    method: "POST",
    credentials: "include",
    headers: {
      "Content-Type": "application/json",
      ...ttsRequestHeaders(),
    },
    body: JSON.stringify(body),
    signal,
    cache: "no-store",
  });

  if (!res.ok) return null;

  const contentType = res.headers.get("content-type") ?? "";
  if (contentType.includes("json")) return null;

  const blob = await res.blob();
  if (blob.size < 128) return null;
  return blob;
}

async function fetchCloudAudio(body: Record<string, unknown>): Promise<Blob | null> {
  const attempts = isDoctorPortal()
    ? DOCTOR_CLOUD_TTS_ATTEMPTS
    : isQueueScreen()
      ? QUEUE_SCREEN_TTS_ATTEMPTS
      : CLOUD_TTS_ATTEMPTS;
  const timeoutMs = isDoctorPortal()
    ? DOCTOR_CLOUD_TTS_TIMEOUT_MS
    : isQueueScreen()
      ? QUEUE_SCREEN_TTS_TIMEOUT_MS
      : CLOUD_TTS_TIMEOUT_MS;

  for (let attempt = 0; attempt < attempts; attempt += 1) {
    const controller = new AbortController();
    const timer = window.setTimeout(
      () => controller.abort(),
      timeoutMs
    );

    try {
      const blob = await fetchCloudAudioOnce(body, controller.signal);
      if (blob) return blob;
    } catch {
      // retry
    } finally {
      window.clearTimeout(timer);
    }

    if (attempt < attempts - 1 && !isQueueScreen()) {
      await new Promise((r) => window.setTimeout(r, 400 * (attempt + 1)));
    }
  }

  return null;
}

async function playCloudBody(body: Record<string, unknown>): Promise<boolean> {
  const key = ttsCacheKey(body);
  const cached = key ? ttsBlobCache.get(key) : undefined;
  if (cached) {
    try {
      await playAudioBlob(cached);
      return true;
    } catch {
      ttsBlobCache.delete(key);
    }
  }

  const blob = await fetchCloudAudio(body);
  if (!blob) return false;
  if (key) storeTtsBlob(key, blob);
  try {
    await playAudioBlob(blob);
    return true;
  } catch {
    return false;
  }
}

export function speakViaCloudTtsText(text: string): Promise<boolean> {
  return new Promise((resolve) => {
    enqueueSpeech(async () => {
      resolve(await playCloudBody({ text }));
    });
  });
}

/** نداء مراجع — SSML مشكّل (نفس إعدادات المحاسب / شاشة الانتظار) */
export function speakViaCloudTtsParts(
  parts: PatientCallSpeechParts,
  options?: { skipQueue?: boolean }
): Promise<boolean> {
  const run = async (): Promise<boolean> => {
    const usedParts = await playCloudBody({ parts });
    if (usedParts) return true;
    // على شاشة الانتظار لا نعيد الطلب بنص مختلف — ننتقل فوراً للنطق المحلي
    if (isQueueScreen()) return false;
    const text = joinPatientCallSpeech(parts);
    return playCloudBody({ text });
  };

  if (options?.skipQueue) {
    return run();
  }

  return new Promise((resolve) => {
    enqueueSpeech(async () => {
      resolve(await run());
    });
  });
}

/** تسخين TTS + تشغيل قصير — يفتح مسار الصوت على Android */
export async function warmDoctorCloudTts(): Promise<boolean> {
  if (typeof window === "undefined") return false;
  if (!window.location.pathname.startsWith("/doctor")) return false;

  try {
    const res = await fetch("/api/tts/speak", {
      method: "POST",
      credentials: "include",
      headers: {
        "Content-Type": "application/json",
        ...authPortalHeaders("doctor"),
      },
      body: JSON.stringify({ text: "تجربة" }),
      cache: "no-store",
    });
    if (!res.ok) return false;
    const blob = await res.blob();
    if (blob.size < 128) return false;
    await playAudioBlob(blob);
    return true;
  } catch {
    return false;
  }
}
