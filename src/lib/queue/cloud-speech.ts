"use client";

import { authPortalHeaders } from "@/lib/auth/api-portal";
import {
  joinPatientCallSpeech,
  type PatientCallSpeechParts,
} from "@/lib/queue/arabic-speech-text";

let speechChain: Promise<void> = Promise.resolve();

const CLOUD_TTS_TIMEOUT_MS = 18_000;
const CLOUD_TTS_ATTEMPTS = 3;

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
  return {};
}

function enqueueSpeech(task: () => Promise<void>): void {
  speechChain = speechChain.then(task).catch(() => {});
}

export function clearCloudSpeechQueue(): void {
  speechChain = Promise.resolve();
}

async function playAudioBlob(blob: Blob): Promise<void> {
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
  for (let attempt = 0; attempt < CLOUD_TTS_ATTEMPTS; attempt += 1) {
    const controller = new AbortController();
    const timer = window.setTimeout(
      () => controller.abort(),
      CLOUD_TTS_TIMEOUT_MS
    );

    try {
      const blob = await fetchCloudAudioOnce(body, controller.signal);
      if (blob) return blob;
    } catch {
      // retry
    } finally {
      window.clearTimeout(timer);
    }

    if (attempt < CLOUD_TTS_ATTEMPTS - 1) {
      await new Promise((r) => window.setTimeout(r, 400 * (attempt + 1)));
    }
  }

  return null;
}

async function playCloudBody(body: Record<string, unknown>): Promise<boolean> {
  const blob = await fetchCloudAudio(body);
  if (!blob) return false;
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
  parts: PatientCallSpeechParts
): Promise<boolean> {
  return new Promise((resolve) => {
    enqueueSpeech(async () => {
      const usedParts = await playCloudBody({ parts });
      if (usedParts) {
        resolve(true);
        return;
      }

      const text = joinPatientCallSpeech(parts);
      resolve(await playCloudBody({ text }));
    });
  });
}

/** تسخين TTS عند فتح تطبيق الطبيب — يقلّل فشل أول نداء على الموبايل */
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
    return res.ok;
  } catch {
    return false;
  }
}
