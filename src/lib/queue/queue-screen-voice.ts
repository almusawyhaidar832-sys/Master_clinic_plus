"use client";

import { splitPatientCallSpeech } from "@/lib/queue/arabic-speech-text";
import { playDoctorCallAudioUrl } from "@/lib/queue/audio-alerts";
import { prefetchCloudTts } from "@/lib/queue/cloud-speech";
import {
  installSpeechGestureUnlock,
  isSpeechGestureUnlocked,
  playAttentionBeep,
  prepareSpeechAuto,
  speakPatientCallParts,
  stopAllSpeech,
  unlockSpeechAudio,
  waitForVoices,
} from "@/lib/queue/web-speech";

export { buildQueueScreenAnnouncement } from "@/lib/queue/arabic-speech-text";

type AnnouncementJob = {
  patientName: string;
  doctorName: string;
  gender?: import("@/lib/queue/patient-gender").PatientGender | null;
  entryId?: string;
  clinicRef?: string;
  audioUrl?: string;
  recall?: boolean;
};

const pendingJobs: AnnouncementJob[] = [];
let speaking = false;

/** منع تكرار نفس النداء عند وصول بثّين أو استطلاع متزامن */
let lastAnnouncedKey = "";
let lastAnnouncedAt = 0;
const CALL_DEDUP_MS = 4_000;

function jobParts(job: AnnouncementJob) {
  return splitPatientCallSpeech(
    job.patientName,
    job.doctorName,
    "queue_screen",
    job.gender
  );
}

function announcementDedupeKey(job: AnnouncementJob): string {
  const base =
    job.entryId?.trim() || `${job.patientName.trim()}\0${job.doctorName.trim()}`;
  return `${base}:call`;
}

function shouldSkipDuplicateAnnouncement(job: AnnouncementJob): boolean {
  if (job.recall) return false;
  /** رابط MP3 من السيرفر — لا نتخطاه حتى لو وصل بث عميل بدون صوت قبله */
  if (job.audioUrl?.trim()) return false;
  const key = announcementDedupeKey(job);
  const now = Date.now();
  if (key === lastAnnouncedKey && now - lastAnnouncedAt < CALL_DEDUP_MS) {
    return true;
  }
  lastAnnouncedKey = key;
  lastAnnouncedAt = now;
  return false;
}

async function fetchScreenAnnounceAudioUrl(
  entryId: string,
  clinicRef: string
): Promise<string | null> {
  try {
    const params = new URLSearchParams({
      clinic: clinicRef,
      entry_id: entryId,
    });
    const res = await fetch(
      `/api/queue/screen/announce-audio-url?${params.toString()}`,
      { cache: "no-store" }
    );
    if (!res.ok) return null;
    const data = (await res.json()) as { audioUrl?: string };
    return data.audioUrl?.trim() || null;
  } catch {
    return null;
  }
}

async function resolveJobAudioUrl(job: AnnouncementJob): Promise<string | null> {
  if (job.audioUrl?.trim()) return job.audioUrl.trim();
  const entryId = job.entryId?.trim();
  const clinicRef = job.clinicRef?.trim();
  if (!entryId || !clinicRef) return null;
  return fetchScreenAnnounceAudioUrl(entryId, clinicRef);
}

/** نغمة ثم نداء بالاسم — MP3 من السيرفر أولاً (أوثق على TV وWindows) */
async function playAnnouncement(job: AnnouncementJob, interrupt = false): Promise<void> {
  const parts = jobParts(job);
  prefetchCloudTts(parts);

  if (interrupt) {
    stopAllSpeech();
  }

  const audioUrl = await resolveJobAudioUrl(job);
  if (audioUrl) {
    await playAttentionBeep();
    const played = await playDoctorCallAudioUrl(audioUrl);
    if (played) return;
  }

  await playAttentionBeep();
  await speakPatientCallParts(parts, {
    useCloud: true,
    skipCloudQueue: true,
    clearQueue: false,
  });
}

async function drainQueue() {
  if (speaking || pendingJobs.length === 0) return;
  if (!isSpeechGestureUnlocked()) return;
  speaking = true;

  while (pendingJobs.length > 0) {
    const job = pendingJobs.shift()!;
    await playAnnouncement(job);
  }

  speaking = false;
}

function enqueueImmediate(job: AnnouncementJob) {
  pendingJobs.length = 0;
  speaking = false;
  lastAnnouncedKey = "";
  lastAnnouncedAt = 0;
  if (!isSpeechGestureUnlocked()) {
    pendingJobs.unshift(job);
    void drainQueue();
    return;
  }
  void playAnnouncement(job, true);
}

function enqueue(job: AnnouncementJob) {
  if (job.recall) {
    enqueueImmediate(job);
    return;
  }
  if (shouldSkipDuplicateAnnouncement(job)) return;
  prefetchCloudTts(jobParts(job));
  pendingJobs.push(job);
  void drainQueue();
}

export function isQueueScreenSpeechUnlocked(): boolean {
  return isSpeechGestureUnlocked();
}

export function speakQueueScreenAnnouncement(
  patientName: string,
  doctorName: string,
  enabled = true,
  gender?: AnnouncementJob["gender"],
  options?: {
    entryId?: string;
    clinicRef?: string;
    audioUrl?: string;
    recall?: boolean;
  }
): void {
  if (!enabled) return;
  if (typeof window === "undefined") return;
  enqueue({
    patientName,
    doctorName,
    gender,
    entryId: options?.entryId,
    clinicRef: options?.clinicRef,
    audioUrl: options?.audioUrl,
    recall: options?.recall,
  });
}

export function repeatQueueScreenAnnouncement(
  patientName: string,
  doctorName: string,
  enabled = true,
  gender?: AnnouncementJob["gender"],
  options?: { entryId?: string; clinicRef?: string; audioUrl?: string }
): void {
  if (!enabled || typeof window === "undefined") return;
  enqueueImmediate({
    patientName,
    doctorName,
    gender,
    entryId: options?.entryId,
    clinicRef: options?.clinicRef,
    audioUrl: options?.audioUrl,
    recall: true,
  });
}

export function stopQueueScreenSpeech(): void {
  pendingJobs.length = 0;
  speaking = false;
  lastAnnouncedKey = "";
  lastAnnouncedAt = 0;
  if (typeof window !== "undefined" && "speechSynthesis" in window) {
    window.speechSynthesis.cancel();
  }
}

export function loadQueueScreenVoiceEnabled(): boolean {
  return true;
}

export function saveQueueScreenVoiceEnabled(_enabled: boolean): void {
  // الصوت دائماً مفعّل
}

export function warmUpSpeechVoices(onReady?: () => void, onUnlocked?: () => void): () => void {
  if (typeof window === "undefined") return () => {};

  prepareSpeechAuto();

  void waitForVoices(800).then(() => {
    onReady?.();
    if (isSpeechGestureUnlocked()) void drainQueue();
  });

  let cancelled = false;
  const tryAutoUnlock = () => {
    void unlockSpeechAudio().then((ok) => {
      if (cancelled || !ok) return;
      onUnlocked?.();
      void drainQueue();
    });
  };
  tryAutoUnlock();
  const autoUnlockRetry = setInterval(() => {
    if (isSpeechGestureUnlocked()) {
      clearInterval(autoUnlockRetry);
      return;
    }
    tryAutoUnlock();
  }, 1500);

  const removeGestureUnlock = installSpeechGestureUnlock(() => {
    onUnlocked?.();
    void drainQueue();
  });

  const keepAlive = setInterval(() => {
    try {
      window.speechSynthesis?.resume();
      prepareSpeechAuto();
    } catch {
      // ignore
    }
  }, 5000);

  return () => {
    cancelled = true;
    removeGestureUnlock();
    clearInterval(keepAlive);
    clearInterval(autoUnlockRetry);
  };
}

export { getSpeechSupport } from "@/lib/queue/web-speech";
