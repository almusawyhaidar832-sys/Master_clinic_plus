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
import { playAttentionBeep } from "@/lib/queue/web-speech";
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
import { PwaInstallButton } from "@/components/pwa/PwaInstallButton";
import { QueueScreenDisplay } from "@/components/queue/QueueScreenDisplay";
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
      <div className="qs-glass relative z-10 w-full max-w-lg rounded-3xl p-8 text-center text-white shadow-2xl shadow-cyan-500/10">
        <div className="mx-auto mb-6 flex h-20 w-20 items-center justify-center rounded-2xl bg-gradient-to-br from-cyan-400 to-teal-600 shadow-lg shadow-cyan-500/25">
          <Monitor className="h-10 w-10 text-white" />
        </div>
        <h1 className="qs-title-shimmer text-3xl font-black">شاشة انتظار المرضى</h1>
        <p className="mt-3 text-sm leading-relaxed text-white/60">
          اكتب <strong className="text-cyan-200">رمز عيادتك</strong> مرة واحدة — تُحفظ
          على هذا التلفاز وتفتح تلقائياً كل يوم.
        </p>
        <p className="mt-2 flex items-center justify-center gap-1.5 text-xs text-white/40">
          <Sparkles className="h-3.5 w-3.5 text-cyan-400" />
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
          <label className="block text-right text-sm text-white/70">
            رمز العيادة (من المحاسب — «ربط التلفاز»)
          </label>
          <input
            type="text"
            value={code}
            onChange={(e) => setCode(e.target.value.toUpperCase())}
            placeholder="مثال: ABC12"
            dir="ltr"
            autoComplete="off"
            className="w-full rounded-2xl border-2 border-cyan-400/25 bg-white/5 px-6 py-5 text-center text-3xl font-black tracking-[0.2em] text-white placeholder:text-white/25 focus:border-cyan-400/60 focus:outline-none focus:ring-2 focus:ring-cyan-400/20"
          />
          {siteHost && (
            <p className="text-xs text-white/40" dir="ltr">
              أو افتح: {siteHost}/queue-screen?clinic=
              <span className="text-white/70">{code.trim() || "رمزك"}</span>
            </p>
          )}
          <button
            type="submit"
            disabled={!code.trim()}
            className="w-full rounded-2xl bg-gradient-to-l from-cyan-500 to-teal-600 py-4 text-lg font-bold text-white shadow-lg shadow-cyan-500/25 hover:opacity-95 disabled:opacity-40"
          >
            فتح شاشة هذه العيادة
          </button>
        </form>

        <p className="text-xs leading-relaxed text-white/45">
          تُكتب <strong className="text-white/70">مرة واحدة فقط</strong> — يُحفظ
          الرمز على هذا التلفاز ويفتح تلقائياً كل يوم. يُفضّل تثبيت الشاشة كتطبيق
          من قائمة Chrome.
        </p>

        <div className="mt-6 rounded-2xl border border-white/10 bg-white/5 p-4 text-right text-xs text-white/55">
          <p className="mb-2 font-medium text-white/80">تثبيت كتطبيق على التلفاز</p>
          <p className="mb-3 leading-relaxed">
            Android TV / شاشة ذكية: من Chrome اختر القائمة ⋮ →{" "}
            <strong className="text-white/90">إضافة إلى الشاشة الرئيسية</strong> أو{" "}
            <strong className="text-white/90">تثبيت التطبيق</strong>.
          </p>
          <PwaInstallButton
            label="تثبيت شاشة الانتظار"
            installingLabel="جاري التثبيت..."
            className="inline-flex items-center gap-2 rounded-xl bg-gradient-to-l from-cyan-500 to-teal-600 px-4 py-2 text-sm font-bold text-white"
          />
        </div>
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
      <div className="qs-bg-mesh flex min-h-screen items-center justify-center text-white">
        <div className="text-center">
          <div className="mx-auto mb-4 h-12 w-12 animate-spin rounded-full border-2 border-cyan-400 border-t-transparent" />
          <p className="text-lg text-white/70">جارٍ تحميل شاشة الانتظار...</p>
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

  const voiceEnabledRef = useRef(true);
  const prevCalledRef = useRef<Set<string>>(new Set());
  const prevCalledAtRef = useRef<Map<string, string>>(new Map());
  const prevWaitingRef = useRef<Set<string>>(new Set());
  const queueReadyRef = useRef(false);

  useEffect(() => {
    return warmUpSpeechVoices();
  }, []);

  useEffect(() => {
    if (typeof window === "undefined") return;
    setInstalledApp(isStandalonePwa());
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
    (name?: string, doctorName?: string, gender?: PatientGender | null) => {
      if (!name?.trim() || !doctorName?.trim()) return;
      speakQueueScreenAnnouncement(
        name.trim(),
        doctorName.trim(),
        voiceEnabledRef.current,
        gender
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
          const prevAt = prevCalledAtRef.current.get(entry.id);
          const at = entry.called_at ?? "";
          const isFirstCall =
            !prevCalledRef.current.has(entry.id) && entry.status === "called";
          const isRecall = Boolean(at && prevAt && at !== prevAt);

          if (isFirstCall || isRecall) {
            handleQueueScreenCall(
              resolvePatientName(entry),
              resolveDoctorName(entry),
              resolvePatientGender(entry)
            );
          }

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
        const now = new Date().toISOString();
        if (p.entryId) {
          prevCalledRef.current.add(p.entryId);
          prevCalledAtRef.current.set(p.entryId, now);
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
        handleQueueScreenCall(p.name, p.doctorName, p.gender ?? null);
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
      <div className="qs-bg-mesh flex min-h-screen items-center justify-center text-white">
        <div className="text-center">
          <div className="mx-auto mb-4 h-12 w-12 animate-spin rounded-full border-2 border-cyan-400 border-t-transparent" />
          <p className="text-lg text-white/70">جارٍ فتح شاشة العيادة...</p>
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

  return (
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
      onTestSound={() => {
        if (displayCalled[0]) {
          repeatQueueScreenAnnouncement(
            resolvePatientName(displayCalled[0]),
            resolveDoctorName(displayCalled[0]),
            true,
            resolvePatientGender(displayCalled[0])
          );
        }
      }}
    />
  );
}

export default function QueueScreenPage() {
  return (
    <Suspense
      fallback={
        <div className="qs-bg-mesh flex min-h-screen items-center justify-center text-white">
          <p className="text-lg text-white/70">جارٍ تحميل شاشة الانتظار...</p>
        </div>
      }
    >
      <QueueScreenContent />
    </Suspense>
  );
}
