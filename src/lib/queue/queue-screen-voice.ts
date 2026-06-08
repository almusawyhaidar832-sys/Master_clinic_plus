"use client";

import {
  installSpeechGestureUnlock,
  playAttentionBeep,
  prepareSpeechAuto,
  speakArabic,
  waitForVoices,
} from "@/lib/queue/web-speech";

type AnnouncementJob = { patientName: string; doctorName: string };

const pendingJobs: AnnouncementJob[] = [];
let speaking = false;

export function buildQueueScreenAnnouncement(
  patientName: string,
  doctorName: string
): string {
  const patient = patientName.trim() || "المراجع";
  const doctor = doctorName.trim() || "الطبيب";
  return `يرجى من المراجع ${patient} التوجه لعيادة الدكتور ${doctor}`;
}

async function drainQueue() {
  if (speaking || pendingJobs.length === 0) return;
  speaking = true;

  while (pendingJobs.length > 0) {
    const job = pendingJobs.shift()!;
    const text = buildQueueScreenAnnouncement(job.patientName, job.doctorName);

    await playAttentionBeep();
    await speakArabic(text);
    await new Promise((r) => setTimeout(r, 500));
    await speakArabic(text);
    await new Promise((r) => setTimeout(r, 400));
  }

  speaking = false;
}

function enqueue(job: AnnouncementJob) {
  pendingJobs.push(job);
  void drainQueue();
}

export function isQueueScreenSpeechUnlocked(): boolean {
  return true;
}

export function speakQueueScreenAnnouncement(
  patientName: string,
  doctorName: string,
  enabled = true
): void {
  if (!enabled) return;
  if (typeof window === "undefined" || !("speechSynthesis" in window)) return;
  enqueue({ patientName, doctorName });
}

export function repeatQueueScreenAnnouncement(
  patientName: string,
  doctorName: string,
  enabled = true
): void {
  if (!enabled || typeof window === "undefined" || !("speechSynthesis" in window)) return;
  pendingJobs.unshift({ patientName, doctorName });
  void drainQueue();
}

export function stopQueueScreenSpeech(): void {
  pendingJobs.length = 0;
  speaking = false;
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

export function warmUpSpeechVoices(onReady?: () => void): () => void {
  if (typeof window === "undefined") return () => {};

  prepareSpeechAuto();

  void waitForVoices(3000).then(() => {
    onReady?.();
    void drainQueue();
  });

  const removeGestureUnlock = installSpeechGestureUnlock();

  const keepAlive = setInterval(() => {
    try {
      window.speechSynthesis?.resume();
      prepareSpeechAuto();
    } catch {
      // ignore
    }
  }, 5000);

  return () => {
    removeGestureUnlock();
    clearInterval(keepAlive);
  };
}

export { getSpeechSupport } from "@/lib/queue/web-speech";
