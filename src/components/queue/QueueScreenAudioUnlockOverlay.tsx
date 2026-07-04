"use client";

import { useEffect, useRef } from "react";
import { Volume2 } from "lucide-react";

interface QueueScreenAudioUnlockOverlayProps {
  visible: boolean;
  hint?: string;
  onUnlock: () => void;
}

/**
 * طبقة ملء الشاشة لتفعيل الصوت على التلفاز — المتصفحات تمنع التشغيل
 * التلقائي حتى يضغط المستخدم OK على الريموت أو يلمس الشاشة مرة واحدة.
 */
export function QueueScreenAudioUnlockOverlay({
  visible,
  hint = "اضغط OK على الريموت لتفعيل صوت النداء",
  onUnlock,
}: QueueScreenAudioUnlockOverlayProps) {
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!visible) return;
    rootRef.current?.focus({ preventScroll: true });
  }, [visible]);

  if (!visible) return null;

  const unlock = () => onUnlock();

  return (
    <div
      ref={rootRef}
      role="button"
      tabIndex={0}
      aria-label={hint}
      className="qs-audio-unlock-overlay"
      onPointerDown={(e) => {
        e.preventDefault();
        unlock();
      }}
      onKeyDown={(e) => {
        if (
          e.key === "Enter" ||
          e.key === " " ||
          e.key === "OK" ||
          e.key === "Select" ||
          e.key === "MediaPlayPause"
        ) {
          e.preventDefault();
          unlock();
        }
      }}
    >
      <div className="qs-audio-unlock-card">
        <div className="qs-audio-unlock-icon-wrap">
          <Volume2 className="h-16 w-16 text-white" strokeWidth={2.2} />
        </div>
        <h2 className="text-3xl font-black text-white lg:text-4xl">تفعيل صوت النداء</h2>
        <p className="mt-4 max-w-xl text-xl font-semibold leading-relaxed text-white/90 lg:text-2xl">
          {hint}
        </p>
        <p className="mt-6 text-base font-medium text-white/70">
          خطوة واحدة فقط — بعدها يُسمَع نداء كل مراجع تلقائياً
        </p>
      </div>
    </div>
  );
}
