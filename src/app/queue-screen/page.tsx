"use client";

/**
 * شاشة الانتظار العامة — تُعرض على التلفاز في صالة الانتظار
 * URL: /queue-screen?clinic=<clinic_id>
 */

import { Suspense, useCallback, useEffect, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { authPortalHeaders } from "@/lib/auth/api-portal";
import { clinicQueueChannelName, clinicQueueScreenChannelName } from "@/lib/queue/realtime-client";
import {
  repeatQueueScreenAnnouncement,
  speakQueueScreenAnnouncement,
  warmUpSpeechVoices,
} from "@/lib/queue/queue-screen-voice";
import { isStandalonePwa } from "@/lib/pwa/platform";
import { isQueueScreenInstalled } from "@/lib/pwa/tv-platform";
import {
  announceArabicWithBeep,
  hasPersistedSpeechUnlock,
  playAttentionBeep,
  unlockSpeechAudioDiagnostics,
} from "@/lib/queue/web-speech";
import {
  resolveDoctorSpeechName,
  resolvePatientSpeechName,
} from "@/lib/queue/utils";
import {
  resolvePatientGender,
  type PatientGender,
} from "@/lib/queue/patient-gender";
import { isUuid } from "@/lib/booking/urls";
import {
  clearQueueScreenClinicRef,
  loadSavedQueueScreenClinicRef,
  saveQueueScreenClinicRef,
} from "@/lib/queue/queue-screen-storage";
import { QueueScreenDisplay } from "@/components/queue/QueueScreenDisplay";
import { QueueScreenPwaInstall } from "@/components/queue/QueueScreenPwaInstall";
import { QueueScreenTvFit } from "@/components/queue/QueueScreenTvFit";
import { useAutoReloadOnNewDeploy } from "@/lib/queue/auto-reload";
import { Monitor, Sparkles } from "lucide-react";

interface QueueEntry {
  id: string;
  ticket_number: number;
  status: "waiting" | "called" | "in_progress" | "done" | "cancelled";
  patient_name: string | null;
  doctor: { full_name_ar: string } | null;
  patient: { full_name_ar: string; speech_name_ar?: string | null; gender?: string | null } | null;
  called_at: string | null;
}

function resolvePatientName(entry: QueueEntry): string {
  return resolvePatientSpeechName(entry);
}

function resolveDoctorName(entry: QueueEntry): string {
  return resolveDoctorSpeechName(entry.doctor);
}

function ClinicCodeTvSetup({
  onSubmit,
}: {
  onSubmit: (code: string) => void;
}) {
  const [code, setCode] = useState("");
  const [siteHost, setSiteHost] = useState("");

  useEffect(() => {
    if (typeof window !== "undefined") {
      setSiteHost(window.location.host);
    }
  }, []);

  return (
    <div className="qs-bg-mesh relative flex min-h-screen flex-col items-center justify-center px-6 py-10">
      <div className="qs-grid-overlay pointer-events-none absolute inset-0 opacity-50" />
      <div className="qs-setup-card relative z-10 w-full max-w-lg rounded-3xl p-8 text-center">
        <div className="mx-auto mb-6 flex h-20 w-20 items-center justify-center rounded-2xl bg-gradient-to-br from-cyan-500 to-teal-600 shadow-lg shadow-cyan-500/30">
          <Monitor className="h-10 w-10 text-white" />
        </div>
        <h1 className="qs-title-shimmer text-3xl font-black">شاشة انتظار المرضى</h1>
        <p className="mt-3 text-sm leading-relaxed text-slate-600">
          اكتب <strong className="text-teal-700">رمز عيادتك</strong> مرة واحدة — تُحفظ
          على هذا التلفاز وتفتح تلقائياً كل يوم.
        </p>
        <p className="mt-2 flex items-center justify-center gap-1.5 text-xs text-slate-500">
          <Sparkles className="h-3.5 w-3.5 text-cyan-600" />
          رمز خاص بعيادتك — لا تختلط مع عيادة أخرى
        </p>

        <form
          className="mt-6 space-y-4"
          onSubmit={(e) => {
            e.preventDefault();
            const trimmed = code.trim();
            if (trimmed) onSubmit(trimmed);
          }}
        >
          <label className="block text-right text-sm font-medium text-slate-700">
            رمز العيادة (من المحاسب — «ربط التلفاز»)
          </label>
          <input
            type="text"
            value={code}
            onChange={(e) => setCode(e.target.value.toUpperCase())}
            placeholder="مثال: ABC12"
            dir="ltr"
            autoComplete="off"
            className="qs-setup-input w-full rounded-2xl px-6 py-5 text-center text-3xl font-black tracking-[0.2em] placeholder:text-slate-300 focus:outline-none"
          />
          {siteHost && (
            <p className="text-xs text-slate-500" dir="ltr">
              أو افتح: {siteHost}/queue-screen?clinic=
              <span className="font-semibold text-teal-700">{code.trim() || "رمزك"}</span>
            </p>
          )}
          <button
            type="submit"
            disabled={!code.trim()}
            className="w-full rounded-2xl bg-gradient-to-l from-cyan-600 to-teal-600 py-4 text-lg font-bold text-white shadow-lg shadow-cyan-500/25 hover:opacity-95 disabled:opacity-40"
          >
            فتح شاشة هذه العيادة
          </button>
        </form>

        <p className="text-xs leading-relaxed text-slate-500">
          تُكتب <strong className="text-slate-700">مرة واحدة فقط</strong> — يُحفظ
          الرمز على هذا التلفاز ويفتح تلقائياً كل يوم. يُفضّل تثبيت الشاشة كتطبيق
          من قائمة Chrome.
        </p>

        <QueueScreenPwaInstall />
      </div>
    </div>
  );
}

function SetupScreen({ onClinicResolved }: { onClinicResolved: (id: string) => void }) {
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function resolveClinic() {
      try {
        const res = await fetch("/api/queue", {
          credentials: "include",
          cache: "no-store",
          headers: authPortalHeaders("accountant"),
        });
        if (res.ok) {
          const data = (await res.json()) as { clinicId?: string };
          if (data.clinicId) {
            onClinicResolved(data.clinicId);
            return;
          }
        }
      } catch {
        /* تلفاز العيادة — لا جلسة محاسب */
      } finally {
        setLoading(false);
      }
    }
    void resolveClinic();
  }, [onClinicResolved]);

  if (loading) {
    return (
      <div className="qs-bg-mesh flex min-h-screen items-center justify-center">
        <div className="text-center">
          <div className="mx-auto mb-4 h-12 w-12 animate-spin rounded-full border-2 border-cyan-600 border-t-transparent" />
          <p className="text-lg font-medium text-slate-600">جارٍ تحميل شاشة الانتظار...</p>
        </div>
      </div>
    );
  }

  return (
    <ClinicCodeTvSetup
      onSubmit={(clinicCode) => onClinicResolved(clinicCode)}
    />
  );
}

function QueueScreenContent() {
  const params = useSearchParams();
  const router = useRouter();
  const clinicRefParam = params.get("clinic");

  const [clinicRef, setClinicRef] = useState<string | null>(clinicRefParam);
  const [resolvedClinicId, setResolvedClinicId] = useState<string | null>(
    clinicRefParam && isUuid(clinicRefParam) ? clinicRefParam : null
  );
  const [called, setCalled] = useState<QueueEntry[]>([]);
  const [waiting, setWaiting] = useState<QueueEntry[]>([]);
  const [clinicName, setClinicName] = useState("العيادة");
  const [currentTime, setCurrentTime] = useState("");
  const [currentDate, setCurrentDate] = useState("");
  const [screenUrl, setScreenUrl] = useState("");
  const [liveCall, setLiveCall] = useState<{
    name: string;
    doctorName: string;
    entryId?: string;
    ticketNumber?: number;
    gender?: PatientGender | null;
    recall?: boolean;
  } | null>(null);
  const [liveCallTick, setLiveCallTick] = useState(0);
  const [bootstrapping, setBootstrapping] = useState(!clinicRefParam);
  const [installedApp, setInstalledApp] = useState(false);
  const [audioUnlocked, setAudioUnlocked] = useState(false);
  const [audioUnlockHint, setAudioUnlockHint] = useState("اضغط أي مكان لتفعيل الصوت");
  const [audioDiagnosticMessage, setAudioDiagnosticMessage] = useState<string | null>(null);
  const lastAudioDiagRef = useRef<{
    unlocked: boolean;
    htmlAudioOk: boolean;
    webAudioOk: boolean;
    speechSynthOk: boolean;
  } | null>(null);

  const voiceEnabledRef = useRef(true);
  const prevCalledRef = useRef<Set<string>>(new Set());
  const prevCalledAtRef = useRef<Map<string, string>>(new Map());
  const prevWaitingRef = useRef<Set<string>>(new Set());
  const queueReadyRef = useRef(false);

  useEffect(() => {
    if (hasPersistedSpeechUnlock()) {
      setAudioUnlockHint("اضغط OK على الريموت لتفعيل الصوت");
    }
    return warmUpSpeechVoices(undefined, () => setAudioUnlocked(true));
  }, []);

  useAutoReloadOnNewDeploy(called.length === 0);

  useEffect(() => {
    if (typeof window === "undefined") return;
    setInstalledApp(isQueueScreenInstalled() || isStandalonePwa());
  }, []);

  useEffect(() => {
    if (typeof window === "undefined") return;

    if (clinicRefParam) {
      saveQueueScreenClinicRef(clinicRefParam);
      setBootstrapping(false);
      return;
    }

    if (params.get("reset") === "1") {
      clearQueueScreenClinicRef();
      setBootstrapping(false);
      router.replace("/queue-screen");
      return;
    }

    const saved = loadSavedQueueScreenClinicRef();
    if (saved) {
      router.replace(`/queue-screen?clinic=${encodeURIComponent(saved)}`);
      return;
    }

    setBootstrapping(false);
  }, [clinicRefParam, params, router]);

  useEffect(() => {
    if (clinicRefParam) {
      setClinicRef(clinicRefParam);
      if (isUuid(clinicRefParam)) {
        setResolvedClinicId(clinicRefParam);
      }
    }
  }, [clinicRefParam]);

  useEffect(() => {
    if (typeof window !== "undefined" && clinicRef) {
      setScreenUrl(`${window.location.origin}/queue-screen?clinic=${encodeURIComponent(clinicRef)}`);
    }
  }, [clinicRef]);

  useEffect(() => {
    const tick = () => {
      const now = new Date();
      setCurrentTime(
        now.toLocaleTimeString("ar-IQ", {
          hour: "2-digit",
          minute: "2-digit",
          hour12: true,
        })
      );
      setCurrentDate(
        now.toLocaleDateString("ar-IQ", {
          weekday: "long",
          year: "numeric",
          month: "long",
          day: "numeric",
        })
      );
    };
    tick();
    const t = setInterval(tick, 1000);
    return () => clearInterval(t);
  }, []);

  const handleQueueScreenCall = useCallback(
    (
      name?: string,
      doctorName?: string,
      gender?: PatientGender | null,
      options?: { entryId?: string; recall?: boolean }
    ) => {
      if (!name?.trim() || !doctorName?.trim()) return;
      speakQueueScreenAnnouncement(
        name.trim(),
        doctorName.trim(),
        voiceEnabledRef.current,
        gender,
        options
      );
    },
    []
  );

  const fetchQueue = useCallback(async () => {
    if (!clinicRef) return;

    try {
      const res = await fetch(
        `/api/queue/screen?clinic=${encodeURIComponent(clinicRef)}`,
        { cache: "no-store" }
      );
      if (!res.ok) return;

      const data = (await res.json()) as {
        clinicId?: string;
        clinicRef?: string;
        clinicName: string;
        queue: QueueEntry[];
      };

      if (data.clinicId) setResolvedClinicId(data.clinicId);
      if (data.clinicRef) {
        setClinicRef(data.clinicRef);
        saveQueueScreenClinicRef(data.clinicRef);
      }
      if (typeof window !== "undefined" && data.clinicRef) {
        setScreenUrl(
          `${window.location.origin}/queue-screen?clinic=${encodeURIComponent(data.clinicRef)}`
        );
      }

      setClinicName(data.clinicName || "العيادة");
      const rows = data.queue ?? [];

      const calledRows = rows.filter(
        (r) => r.status === "called" || r.status === "in_progress"
      );
      const waitingRows = rows.filter((r) => r.status === "waiting");

      const newlyWaiting = waitingRows.filter(
        (r) => !prevWaitingRef.current.has(r.id)
      );

      if (queueReadyRef.current) {
        for (const entry of calledRows) {
          const at = entry.called_at ?? "";
          if (at) prevCalledAtRef.current.set(entry.id, at);
        }
        if (newlyWaiting.length > 0) {
          void playAttentionBeep();
        }
      }

      prevCalledRef.current = new Set(calledRows.map((r) => r.id));
      prevWaitingRef.current = new Set(waitingRows.map((r) => r.id));
      queueReadyRef.current = true;

      setCalled(calledRows);
      setWaiting(waitingRows);
    } catch {
      // retry on next poll
    }
  }, [clinicRef, handleQueueScreenCall]);

  useEffect(() => {
    if (!clinicRef) return;
    void fetchQueue();
    const poll = setInterval(fetchQueue, 1500);
    return () => clearInterval(poll);
  }, [fetchQueue, clinicRef]);

  useEffect(() => {
    if (!liveCall?.entryId) return;
    if (called.some((entry) => entry.id === liveCall.entryId)) {
      setLiveCall(null);
    }
  }, [called, liveCall]);

  useEffect(() => {
    if (!resolvedClinicId) return;

    const supabase = createClient();
    const screenChannel = clinicQueueScreenChannelName(resolvedClinicId);

    const onScreenCall = ({ payload }: { payload: Record<string, unknown> }) => {
      const p = payload as {
        name?: string;
        doctorName?: string;
        entryId?: string;
        ticketNumber?: number;
        gender?: PatientGender;
        recall?: boolean;
      };
      if (p.name && p.doctorName) {
        if (p.entryId) {
          prevCalledRef.current.add(p.entryId);
        }
        setLiveCall({
          name: p.name,
          doctorName: p.doctorName,
          entryId: p.entryId,
          ticketNumber: p.ticketNumber,
          gender: p.gender ?? null,
          recall: p.recall === true,
        });
        setLiveCallTick((t) => t + 1);
        handleQueueScreenCall(p.name, p.doctorName, p.gender ?? null, {
          entryId: p.entryId,
          recall: p.recall === true,
        });
        void fetchQueue();
      }
    };

    const screenChannelRef = supabase
      .channel(screenChannel, { config: { broadcast: { self: false } } })
      .on("broadcast", { event: "queue_screen_call" }, onScreenCall)
      .on("broadcast", { event: "queue_screen_recall" }, onScreenCall)
      .subscribe();

    const dataChannel = supabase
      .channel(`${clinicQueueChannelName(resolvedClinicId)}-screen-sync`)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "patient_queue",
          filter: `clinic_id=eq.${resolvedClinicId}`,
        },
        () => {
          void fetchQueue();
        }
      )
      .on(
        "postgres_changes",
        {
          event: "UPDATE",
          schema: "public",
          table: "appointments",
          filter: `clinic_id=eq.${resolvedClinicId}`,
        },
        () => {
          void fetchQueue();
        }
      )
      .subscribe();

    return () => {
      void supabase.removeChannel(screenChannelRef);
      void supabase.removeChannel(dataChannel);
    };
  }, [resolvedClinicId, fetchQueue, handleQueueScreenCall]);

  function handleClinicResolved(id: string) {
    saveQueueScreenClinicRef(id);
    setClinicRef(id);
    setResolvedClinicId(isUuid(id) ? id : null);
    router.replace(`/queue-screen?clinic=${encodeURIComponent(id)}`);
  }

  if (bootstrapping) {
    return (
      <div className="qs-bg-mesh flex min-h-screen items-center justify-center">
        <div className="text-center">
          <div className="mx-auto mb-4 h-12 w-12 animate-spin rounded-full border-2 border-cyan-600 border-t-transparent" />
          <p className="text-lg font-medium text-slate-600">جارٍ فتح شاشة العيادة...</p>
        </div>
      </div>
    );
  }

  if (!clinicRef) {
    return <SetupScreen onClinicResolved={handleClinicResolved} />;
  }

  const displayCalled =
    liveCall &&
    !called.some((entry) => entry.id === liveCall.entryId && liveCall.entryId)
      ? [
          {
            id: liveCall.entryId ?? `live-${Date.now()}`,
            ticket_number: liveCall.ticketNumber ?? 0,
            status: "called" as const,
            patient_name: liveCall.name,
            doctor: { full_name_ar: liveCall.doctorName },
            patient: {
              full_name_ar: liveCall.name,
              gender: liveCall.gender ?? null,
            },
            called_at: new Date().toISOString(),
          },
          ...called,
        ]
      : called;

  function buildDiagnosticsReport(): string {
    const diag = lastAudioDiagRef.current;
    const w = typeof window !== "undefined" ? window : null;
    const lines = [
      `الرابط: ${typeof window !== "undefined" ? window.location.href : ""}`,
      `المتصفح (User-Agent): ${w?.navigator.userAgent ?? "غير متوفر"}`,
      `دعم speechSynthesis: ${w && "speechSynthesis" in w ? "نعم" : "لا"}`,
      `دعم AudioContext: ${w && (w.AudioContext || (w as unknown as { webkitAudioContext?: unknown }).webkitAudioContext) ? "نعم" : "لا"}`,
      `دعم Service Worker: ${w && "serviceWorker" in w.navigator ? "نعم" : "لا"}`,
      `عرض الشاشة: ${w ? `${w.innerWidth}x${w.innerHeight}` : "غير متوفر"}`,
      diag
        ? `آخر نتيجة اختبار صوت: ${diag.unlocked ? "نجح" : "فشل"} (مشغّل الصوت: ${diag.htmlAudioOk ? "نعم" : "لا"} / الصوت الرقمي: ${diag.webAudioOk ? "نعم" : "لا"} / تحويل النص لصوت: ${diag.speechSynthOk ? "نعم" : "لا"})`
        : "لم يُجرَ اختبار صوت بعد",
    ];
    return lines.join("\n");
  }

  return (
    <QueueScreenTvFit>
      <QueueScreenDisplay
      clinicName={clinicName}
      currentTime={currentTime}
      currentDate={currentDate}
      called={displayCalled}
      waiting={waiting}
      liveCallEntryId={liveCall?.entryId}
      liveCallTick={liveCallTick}
      liveCallRecall={liveCall?.recall}
      installedApp={installedApp}
      audioUnlocked={audioUnlocked}
      audioUnlockHint={audioUnlocked ? undefined : audioUnlockHint}
      screenUrl={screenUrl}
      resolvePatientName={resolvePatientName}
      resolveDoctorName={resolveDoctorName}
      onRepeatCall={(entry) =>
        repeatQueueScreenAnnouncement(
          resolvePatientName(entry),
          resolveDoctorName(entry),
          true,
          resolvePatientGender(entry)
        )
      }
      audioDiagnosticMessage={audioDiagnosticMessage}
      onTestSound={() => {
        setAudioDiagnosticMessage("جارٍ اختبار الصوت...");
        void (async () => {
          const diag = await unlockSpeechAudioDiagnostics().catch(() => null);
          lastAudioDiagRef.current = diag;
          if (diag?.unlocked) setAudioUnlocked(true);

          if (displayCalled[0]) {
            repeatQueueScreenAnnouncement(
              resolvePatientName(displayCalled[0]),
              resolveDoctorName(displayCalled[0]),
              true,
              resolvePatientGender(displayCalled[0])
            );
          } else {
            await announceArabicWithBeep("هذا اختبار لصوت شاشة الانتظار", {
              clearQueue: true,
              useCloud: true,
            });
          }

          if (!diag) {
            setAudioDiagnosticMessage("تعذّر تشغيل الصوت — تحقّق من صوت التلفاز");
          } else if (diag.unlocked) {
            setAudioDiagnosticMessage(
              `الصوت يعمل (${[
                diag.htmlAudioOk && "مشغّل الصوت",
                diag.webAudioOk && "الصوت الرقمي",
                diag.speechSynthOk && "تحويل النص لصوت",
              ]
                .filter(Boolean)
                .join(" / ")})`
            );
          } else {
            setAudioDiagnosticMessage(
              "لم يستطع هذا المتصفح تشغيل أي صوت — تأكد أن صوت التلفاز غير مكتوم، أو جرّب تثبيت الشاشة كتطبيق (PWA) بدل المتصفح العادي"
            );
          }
        })();
      }}
      onInstalled={() => setInstalledApp(true)}
      onCopyDiagnostics={() =>
        void navigator.clipboard?.writeText(buildDiagnosticsReport())
      }
    />
    </QueueScreenTvFit>
  );
}

export default function QueueScreenPage() {
  return (
    <Suspense
      fallback={
        <div className="qs-bg-mesh flex min-h-screen items-center justify-center">
          <p className="text-lg font-medium text-slate-600">جارٍ تحميل شاشة الانتظار...</p>
        </div>
      }
    >
      <QueueScreenContent />
    </Suspense>
  );
}
