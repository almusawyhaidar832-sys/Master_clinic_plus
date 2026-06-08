"use client";

let audioCtx: AudioContext | null = null;
let autoPrepared = false;

function getSynth(): SpeechSynthesis | null {
  if (typeof window === "undefined" || !("speechSynthesis" in window)) return null;
  return window.speechSynthesis;
}

/** Prepare audio + speech on page load — no user click required */
export function prepareSpeechAuto(): void {
  if (typeof window === "undefined" || autoPrepared) return;
  autoPrepared = true;

  void (async () => {
    await waitForVoices(3000);
    try {
      if (!audioCtx) audioCtx = new AudioContext();
      if (audioCtx.state === "suspended") await audioCtx.resume();
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
  return true;
}

export async function waitForVoices(timeoutMs = 2500): Promise<SpeechSynthesisVoice[]> {
  const synth = getSynth();
  if (!synth) return [];

  const existing = synth.getVoices();
  if (existing.length > 0) return existing;

  return new Promise((resolve) => {
    const timer = setTimeout(() => resolve(synth.getVoices()), timeoutMs);
    synth.addEventListener(
      "voiceschanged",
      () => {
        clearTimeout(timer);
        resolve(synth.getVoices());
      },
      { once: true }
    );
  });
}

function pickArabicVoice(voices: SpeechSynthesisVoice[]): SpeechSynthesisVoice | null {
  if (!voices.length) return null;

  const rank = (v: SpeechSynthesisVoice) => {
    if (v.lang === "ar-SA" || v.lang === "ar-sa") return 0;
    if (v.lang.startsWith("ar")) return 1;
    if (v.name.toLowerCase().includes("arabic")) return 2;
    return 99;
  };

  return [...voices].sort((a, b) => rank(a) - rank(b))[0] ?? null;
}

function applyArabicVoice(utterance: SpeechSynthesisUtterance, voice: SpeechSynthesisVoice | null) {
  utterance.lang = voice?.lang || "ar-SA";
  utterance.rate = 0.85;
  utterance.pitch = 1;
  utterance.volume = 1;
  if (voice) utterance.voice = voice;
}

export async function playAttentionBeep(): Promise<void> {
  if (typeof window === "undefined") return;

  prepareSpeechAuto();

  try {
    if (!audioCtx) audioCtx = new AudioContext();
    if (audioCtx.state === "suspended") await audioCtx.resume();

    const osc = audioCtx.createOscillator();
    const gain = audioCtx.createGain();
    osc.type = "sine";
    osc.frequency.value = 880;
    gain.gain.value = 0.4;
    osc.connect(gain);
    gain.connect(audioCtx.destination);

    const t = audioCtx.currentTime;
    osc.start(t);
    gain.gain.exponentialRampToValueAtTime(0.001, t + 0.25);
    osc.stop(t + 0.25);

    await new Promise((r) => setTimeout(r, 280));
  } catch {
    // ignore
  }
}

export function speakArabic(text: string): Promise<void> {
  return new Promise((resolve) => {
    const synth = getSynth();
    if (!synth || !text.trim()) {
      resolve();
      return;
    }

    prepareSpeechAuto();

    try {
      synth.resume();
    } catch {
      // ignore
    }

    const voices = synth.getVoices();
    const voice = pickArabicVoice(voices);
    const utterance = new SpeechSynthesisUtterance(text);
    applyArabicVoice(utterance, voice);

    let resumeTimer: ReturnType<typeof setInterval> | null = null;
    let settled = false;

    const finish = () => {
      if (settled) return;
      settled = true;
      if (resumeTimer) clearInterval(resumeTimer);
      resolve();
    };

    utterance.onend = finish;
    utterance.onerror = finish;

    resumeTimer = setInterval(() => {
      if (!synth.speaking) return;
      try {
        synth.pause();
        synth.resume();
      } catch {
        // ignore
      }
    }, 120);

    synth.speak(utterance);

    setTimeout(finish, Math.max(8000, text.length * 120));
  });
}

export async function announceArabicWithBeep(text: string): Promise<void> {
  await playAttentionBeep();
  await speakArabic(text);
}

export function installSpeechGestureUnlock(): () => void {
  if (typeof window === "undefined") return () => {};

  const unlock = () => {
    prepareSpeechAuto();
  };

  window.addEventListener("pointerdown", unlock, { capture: true });
  window.addEventListener("keydown", unlock, { capture: true });

  return () => {
    window.removeEventListener("pointerdown", unlock, { capture: true });
    window.removeEventListener("keydown", unlock, { capture: true });
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
  const voice = pickArabicVoice(synth.getVoices());
  return {
    supported: true,
    arabicVoice: voice?.name ?? null,
    unlocked: true,
  };
}
