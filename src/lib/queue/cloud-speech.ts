"use client";

let speechChain: Promise<void> = Promise.resolve();

function enqueueSpeech(task: () => Promise<void>): void {
  speechChain = speechChain.then(task).catch(() => {});
}

export function clearCloudSpeechQueue(): void {
  speechChain = Promise.resolve();
}

async function playAudioBlob(blob: Blob): Promise<void> {  const url = URL.createObjectURL(blob);
  try {
    const audio = new Audio(url);
    audio.volume = 1;
    await new Promise<void>((resolve, reject) => {
      audio.onended = () => resolve();
      audio.onerror = () => reject(new Error("تعذر تشغيل الصوت"));
      void audio.play().catch(reject);
    });
  } finally {
    URL.revokeObjectURL(url);
  }
}

async function fetchCloudAudio(body: Record<string, unknown>): Promise<Blob | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 4_000);

  try {
    const res = await fetch("/api/tts/speak", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal: controller.signal,
      cache: "no-store",
    });
    if (!res.ok) return null;
    return await res.blob();
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

export function speakViaCloudTtsText(text: string): Promise<boolean> {
  return new Promise((resolve) => {
    enqueueSpeech(async () => {
      const blob = await fetchCloudAudio({ text });
      if (!blob || blob.size < 128) {
        resolve(false);
        return;
      }
      try {
        await playAudioBlob(blob);
        resolve(true);
      } catch {
        resolve(false);
      }
    });
  });
}
