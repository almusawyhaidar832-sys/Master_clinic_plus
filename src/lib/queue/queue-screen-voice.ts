"use client";

import { splitPatientCallSpeech } from "@/lib/queue/arabic-speech-text";
import {
  installSpeechGestureUnlock,
  playAttentionBeep,
  prepareSpeechAuto,
  speakPatientCallParts,
  stopAllSpeech,
  waitForVoices,
} from "@/lib/queue/web-speech";

export { buildQueueScreenAnnouncement } from "@/lib/queue/arabic-speech-text";

type AnnouncementJob = {
  patientName: string;
  doctorName: string;
  gender?: import("@/lib/queue/patient-gender").PatientGender | null;
};

const pendingJobs: AnnouncementJob[] = [];
let speaking = false;

async function drainQueue() {
  if (speaking || pendingJobs.length === 0) return;
  speaking = true;

  while (pendingJobs.length > 0) {
    const job = pendingJobs.shift()!;
    const parts = splitPatientCallSpeech(
      job.patientName,
      job.doctorName,
      "queue_screen",
      job.gender
    );

    await playAttentionBeep();
    await speakPatientCallParts(parts, { useCloud: false });
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
  enabled = true,
  gender?: AnnouncementJob["gender"]
): void {
  if (!enabled) return;
  if (typeof window === "undefined") return;
  enqueue({ patientName, doctorName, gender });
}

export function repeatQueueScreenAnnouncement(
  patientName: string,
  doctorName: string,
  enabled = true,
  gender?: AnnouncementJob["gender"]
): void {
  if (!enabled || typeof window === "undefined") return;
  stopAllSpeech();
  pendingJobs.length = 0;
  speaking = false;
  const parts = splitPatientCallSpeech(
    patientName,
    doctorName,
    "queue_screen",
    gender
  );
  void (async () => {
    await playAttentionBeep();
    await speakPatientCallParts(parts, { clearQueue: true, useCloud: false });
  })();
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

  void waitForVoices(4000).then(() => {
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
