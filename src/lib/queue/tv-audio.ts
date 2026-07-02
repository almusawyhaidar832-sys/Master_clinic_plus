"use client";

/**
 * تشغيل صوت متوافق مع أكبر عدد من متصفحات شاشات التلفاز (Tizen / webOS /
 * Android TV / متصفحات عامة قديمة) — التي غالباً لا تدعم Chrome أو
 * Web Audio API أو SpeechSynthesis بشكل موثوق، لكنها تدعم دائماً عنصر
 * HTML5 <audio> لأنه أساس تشغيل الفيديو والصوت على أي تلفاز.
 *
 * الفكرة: عنصرا <audio> ثابتان (بيب + كلام) يُنشآن مرة واحدة ويُشغَّلان
 * أول مرة داخل لمسة المستخدم (لفتح إذن التشغيل التلقائي)، ثم يُعاد
 * استخدام نفس العنصرين لكل تشغيل لاحق — إنشاء عنصر Audio جديد في كل
 * مرة يفقد إذن التشغيل على كثير من متصفحات التلفاز.
 */

const BEEP_DATA_URI =
  "data:audio/wav;base64,UklGRsQFAABXQVZFZm10IBAAAAABAAEAQB8AAEAfAAABAAgAZGF0YaAFAACAqL63l2xKQFR7pb25m3BMQFF4ory7nnROQE50nru8onhRQExwm7m9pXtUQEpsl7e+qH9XQUhok7W/q4RaQkZkj7O/roddQ0Rhi7G/sYthRENdh66/s49kRkJahKu/tZNoSEFXgKi+t5dsSkBUe6W9uZtwTEBReKK8u550TkBOdJ67vKJ4UUBMcJu5vaV7VEBKbJe3vqiAV0FIaJO1v6uEWkJGZI+zv66HXUNEYYuxv7GLYURDXYeuv7OPZEZCWoSrv7WTaEhBV4CovreXbEpAVHulvbmbcExAUXiivLuedE5ATnSeu7yieFFATHCbub2le1RASmyXt76of1dBSGiTtb+rhFpCRmSPs7+uh11DRGGLsb+xi2FEQ12Hrr+zj2RGQlqEq7+1k2hIQVd/qL63l2xKQFR7pb25m3BMQFF4ory7nnROQE50nru8onhRQExwm7m9pXtUQEpsl7e+qIBXQUhok7W/q4RaQkZkj7O/roddQ0Rhi7G/sYthRENdh66/s49kRkJahKu/tZNoSEFXgKi+t5dsSkBUe6W9uZtwTEBReKK8u550TkBOdJ67vKJ4UUBMcJu5vaV7VEBKbJe3vqh/V0FIaJO1v6uEWkJGZI+zv66HXUNEYYuxv7GLYURDXYeuv7OPZEZCWoSrv7WTaEhBV4CovreXbEpAVHulvbmbcExAUXiivLuedE5ATnSeu7yieFFATHCbub2le1RASmyXt76of1dBSGiTtb+rhFpCRmSPs7+uh11DRGGLsb+xi2FEQ12Hrr+zj2RGQlqEq7+1k2hIQVd/qL63l2xKQFR7pb25m3BMQFF4ory7nnROQE50nru8onhRQExwm7m9pXtUQEpsl7e+qH9XQUhok7W/q4RaQkZkj7O/roddQ0Rhi7G/sYthRENdh66/s49kRkJahKu/tZNoSEFXf6i+t5dsSkBUe6W9uZtwTEBReKK8u550TkBOdJ67vKJ4UUBMcJu5vaV7VEBKbJe3vqh/V0FIaJO1v6uEWkJGZI+zv66HXUNEYYuxv7GLYURDXYeuv7OPZEZCWoSrv7WTaEhBV4CovreXbEpAVHulvbmbcExAUXiivLuedE5ATnSeu7yieFFATHCbub2le1RASmyXt76of1dBSGiTtb+rhF5ERWGLsL6wi2JGRV6HrL2xj2VIRFyDqbyzkmlLRVmAprq0lW1ORVd8ori0mHFQRlV4nra1m3VTR1R1m7S1nnhXSFJyl7K1oHxaSVFvlK+1on9dSlBskK21pINgTFBpjaq0poZkTk9niaezp4lnUE9khqSyqIxqUk9ig6GxqY9tVU9ggJ6vqpFxV1BffZutqpR0WVFdepisq5Z3XFJcd5Wqq5h6X1NbdJKoqpp9YVRacpCmqpt/ZFVacI2jqpyCZ1daboqhqZ6FaVlabIefqJ+HbFpaaoScp5+Jb1xaaYKapqCLcV5aZ4CXpKCNdGBbZn2Vo6CPd2JcZXuToaCQeWVdZXmQoKCSe2deZHeOnqCTfWlfZHWLnJ+Uf2tgZHSJmp+VgW1iZHKHmJ6Wg29jZHGFlp2WhXJlZHCDlJyWhnRmZW+BkpuWiHZoZW5/kJmWiXdqZm5+jpiWinlrZ258jZeWi3ttaG17i5WWjH1vaW16iZSVjX5wam15h5KUjYBya214hpGUjYF0bG53hI+TjYJ1bm53g46SjYN3b292goyRjYR4cG92gYuQjYR6cnB2gImPjYV7c3F1f4iNjIV8dHJ2foeMjIZ9dnN2fYWLi4Z+d3R2fYSKioZ/eHV3fIOJioZ/eXZ3fIKHiYaAend4fIKGiIWAe3h4fIGFh4WBfHl5fICEhoSBfXp6fICDhYSBfnt7fX+ChIOBfnx8fX+Bg4KBf319fn+BgoGAf35+fn+AgYGAf39/f3+AgIA=";

let beepAudioEl: HTMLAudioElement | null = null;
let speechAudioEl: HTMLAudioElement | null = null;
let unlocked = false;

function createHiddenAudioElement(): HTMLAudioElement {
  const el = document.createElement("audio");
  el.setAttribute("playsinline", "true");
  el.setAttribute("webkit-playsinline", "true");
  el.preload = "auto";
  el.style.position = "fixed";
  el.style.width = "0";
  el.style.height = "0";
  el.style.opacity = "0";
  el.style.pointerEvents = "none";
  document.body.appendChild(el);
  return el;
}

function ensureElements(): { beep: HTMLAudioElement; speech: HTMLAudioElement } | null {
  if (typeof document === "undefined") return null;
  if (!beepAudioEl) beepAudioEl = createHiddenAudioElement();
  if (!speechAudioEl) speechAudioEl = createHiddenAudioElement();
  return { beep: beepAudioEl, speech: speechAudioEl };
}

async function tryPlayOnce(el: HTMLAudioElement): Promise<boolean> {
  try {
    await el.play();
    el.pause();
    el.currentTime = 0;
    return true;
  } catch {
    return false;
  }
}

export function isTvAudioUnlocked(): boolean {
  return unlocked;
}

/** يجب استدعاؤها مباشرة من داخل معالج حدث لمس/ضغطة/زر ريموت */
export async function unlockTvAudio(): Promise<boolean> {
  const els = ensureElements();
  if (!els) return false;

  els.beep.muted = false;
  els.beep.volume = 1;
  els.speech.muted = false;
  els.speech.volume = 1;

  if (!els.beep.src) els.beep.src = BEEP_DATA_URI;
  if (!els.speech.src) els.speech.src = BEEP_DATA_URI;

  const [beepOk, speechOk] = await Promise.all([
    tryPlayOnce(els.beep),
    tryPlayOnce(els.speech),
  ]);

  unlocked = beepOk || speechOk;
  return unlocked;
}

/** نغمة تنبيه قصيرة عبر <audio> — تعمل بدون Web Audio API */
export function playBeepViaAudioElement(): Promise<void> {
  const els = ensureElements();
  if (!els) return Promise.reject(new Error("no audio element"));

  return new Promise((resolve, reject) => {
    let settled = false;
    const finish = () => {
      if (settled) return;
      settled = true;
      els.beep.onended = null;
      els.beep.onerror = null;
      resolve();
    };
    const fail = (err: unknown) => {
      if (settled) return;
      settled = true;
      els.beep.onended = null;
      els.beep.onerror = null;
      reject(err instanceof Error ? err : new Error("beep playback failed"));
    };

    try {
      els.beep.pause();
      els.beep.src = BEEP_DATA_URI;
      els.beep.currentTime = 0;
      els.beep.volume = 1;
      els.beep.onended = finish;
      els.beep.onerror = () => fail(new Error("beep element error"));
      void els.beep.play().catch(fail);
      setTimeout(finish, 400);
    } catch (err) {
      fail(err);
    }
  });
}

/** تشغيل MP3/Blob (Cloud TTS) عبر <audio> ثابت — أعلى توافق ممكن مع شاشات التلفاز */
export function playBlobViaAudioElement(blob: Blob): Promise<void> {
  const els = ensureElements();
  if (!els) return Promise.reject(new Error("no audio element"));

  const url = URL.createObjectURL(blob);
  return new Promise((resolve, reject) => {
    let settled = false;
    const cleanup = () => {
      URL.revokeObjectURL(url);
      els.speech.onended = null;
      els.speech.onerror = null;
    };
    const finish = () => {
      if (settled) return;
      settled = true;
      cleanup();
      resolve();
    };
    const fail = (err: unknown) => {
      if (settled) return;
      settled = true;
      cleanup();
      reject(err instanceof Error ? err : new Error("audio playback failed"));
    };

    try {
      els.speech.pause();
      els.speech.src = url;
      els.speech.currentTime = 0;
      els.speech.volume = 1;
      els.speech.onended = finish;
      els.speech.onerror = () => fail(new Error("speech element error"));
      void els.speech.play().catch(fail);
    } catch (err) {
      fail(err);
    }
  });
}
