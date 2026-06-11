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
import { playAttentionBeep } from "@/lib/queue/web-speech";
import {
  resolveDoctorSpeechName,
  resolvePatientSpeechName,
} from "@/lib/queue/utils";
import { cn } from "@/lib/utils";
import { Volume2, Clock, CheckCircle2, Monitor, Copy, RotateCcw } from "lucide-react";

interface QueueEntry {
  id: string;
  ticket_number: number;
  status: "waiting" | "called" | "in_progress" | "done" | "cancelled";
  patient_name: string | null;
  doctor: { full_name_ar: string } | null;
  patient: { full_name_ar: string; speech_name_ar?: string | null } | null;
  called_at: string | null;
}

function resolvePatientName(entry: QueueEntry): string {
  return resolvePatientSpeechName(entry);
}

function resolveDoctorName(entry: QueueEntry): string {
  return resolveDoctorSpeechName(entry.doctor);
}

function SetupScreen({ onClinicResolved }: { onClinicResolved: (id: string) => void }) {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

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
        setError(null);
      } catch {
        setError("تعذر الاتصال");
      } finally {
        setLoading(false);
      }
    }
    void resolveClinic();
  }, [onClinicResolved]);

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-slate-900 text-white">
        <p className="text-lg">جارٍ تحميل شاشة الانتظار...</p>
      </div>
    );
  }

  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-6 bg-slate-900 px-6 text-center text-white">
      <Monitor className="h-16 w-16 text-primary" />
      <div className="max-w-md space-y-3">
        <h1 className="text-2xl font-bold">شاشة انتظار المرضى</h1>
        <p className="text-sm leading-relaxed text-white/70">
          هذه الشاشة تُعرض على التلفاز في صالة الانتظار — تظهر أرقام الدور والمراجعين
          المطلوب دخولهم مع نداء صوتي بالعربية.
        </p>
        {error && <p className="text-sm text-red-400">{error}</p>}
        <p className="text-sm text-white/60">
          افتحها من <strong className="text-white">غرفة الانتظار</strong> (زر «شاشة المرضى»)
          أو أضف معرّف العيادة في الرابط.
        </p>
      </div>
    </div>
  );
}

function QueueScreenContent() {
  const params = useSearchParams();
  const router = useRouter();
  const clinicIdParam = params.get("clinic");

  const [clinicId, setClinicId] = useState<string | null>(clinicIdParam);
  const [called, setCalled] = useState<QueueEntry[]>([]);
  const [waiting, setWaiting] = useState<QueueEntry[]>([]);
  const [clinicName, setClinicName] = useState("العيادة");
  const [currentTime, setCurrentTime] = useState("");
  const [screenUrl, setScreenUrl] = useState("");

  const voiceEnabledRef = useRef(true);
  const prevCalledRef = useRef<Set<string>>(new Set());
  const prevCalledAtRef = useRef<Map<string, string>>(new Map());
  const prevWaitingRef = useRef<Set<string>>(new Set());
  const queueReadyRef = useRef(false);

  useEffect(() => {
    return warmUpSpeechVoices();
  }, []);

  useEffect(() => {
    if (clinicIdParam) setClinicId(clinicIdParam);
  }, [clinicIdParam]);

  useEffect(() => {
    if (typeof window !== "undefined" && clinicId) {
      setScreenUrl(`${window.location.origin}/queue-screen?clinic=${clinicId}`);
    }
  }, [clinicId]);

  useEffect(() => {
    const tick = () => {
      setCurrentTime(
        new Date().toLocaleTimeString("ar-IQ", {
          hour: "2-digit",
          minute: "2-digit",
          hour12: true,
        })
      );
    };
    tick();
    const t = setInterval(tick, 1000);
    return () => clearInterval(t);
  }, []);

  const handleQueueScreenCall = useCallback(
    (name?: string, doctorName?: string) => {
      if (!name?.trim() || !doctorName?.trim()) return;
      speakQueueScreenAnnouncement(
        name.trim(),
        doctorName.trim(),
        voiceEnabledRef.current
      );
    },
    []
  );

  const fetchQueue = useCallback(async () => {
    if (!clinicId) return;

    try {
      const res = await fetch(
        `/api/queue/screen?clinic=${encodeURIComponent(clinicId)}`,
        { cache: "no-store" }
      );
      if (!res.ok) return;

      const data = (await res.json()) as {
        clinicName: string;
        queue: QueueEntry[];
      };

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
              resolveDoctorName(entry)
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
  }, [clinicId, handleQueueScreenCall]);

  useEffect(() => {
    if (!clinicId) return;
    void fetchQueue();
    const poll = setInterval(fetchQueue, 2500);
    return () => clearInterval(poll);
  }, [fetchQueue, clinicId]);

  useEffect(() => {
    if (!clinicId) return;

    const supabase = createClient();
    const screenChannel = clinicQueueScreenChannelName(clinicId);

    const onScreenCall = ({ payload }: { payload: Record<string, unknown> }) => {
      const p = payload as { name?: string; doctorName?: string };
      handleQueueScreenCall(p.name, p.doctorName);
    };

    const screenChannelRef = supabase
      .channel(screenChannel, { config: { broadcast: { self: false } } })
      .on("broadcast", { event: "queue_screen_call" }, onScreenCall)
      .on("broadcast", { event: "queue_screen_recall" }, onScreenCall)
      .subscribe();

    const dataChannel = supabase
      .channel(`${clinicQueueChannelName(clinicId)}-screen-sync`)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "patient_queue",
          filter: `clinic_id=eq.${clinicId}`,
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
          filter: `clinic_id=eq.${clinicId}`,
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
  }, [clinicId, fetchQueue, handleQueueScreenCall]);

  function handleClinicResolved(id: string) {
    setClinicId(id);
    router.replace(`/queue-screen?clinic=${id}`);
  }

  if (!clinicId) {
    return <SetupScreen onClinicResolved={handleClinicResolved} />;
  }

  return (
    <div className="relative flex min-h-screen flex-col bg-gradient-to-br from-slate-900 via-slate-800 to-slate-900 text-white">
      <header className="flex items-center justify-between border-b border-white/10 px-8 py-4">
        <div>
          <h1 className="text-2xl font-black tracking-wide">{clinicName}</h1>
          <p className="text-sm text-white/50">شاشة انتظار المرضى — نداء صوتي تلقائي</p>
        </div>
        <div className="flex items-center gap-4">
          <button
            type="button"
            onClick={() => {
              if (called[0]) {
                repeatQueueScreenAnnouncement(
                  resolvePatientName(called[0]),
                  resolveDoctorName(called[0]),
                  true
                );
              }
            }}
            className="flex items-center gap-2 rounded-xl border border-white/20 bg-white/5 px-3 py-2.5 text-xs font-bold text-white/70 hover:bg-white/10"
          >
            اختبار الصوت
          </button>
          <div className="flex items-center gap-2 rounded-xl border border-primary/50 bg-primary/20 px-4 py-2.5 text-sm font-bold text-primary">
            <Volume2 className="h-5 w-5" />
            <span>الصوت مفعّل</span>
          </div>
          <div className="text-left">
            <p className="text-3xl font-black tabular-nums">{currentTime}</p>
            <p className="text-sm text-white/50">
              {new Date().toLocaleDateString("ar-IQ", {
                weekday: "long",
                year: "numeric",
                month: "long",
                day: "numeric",
              })}
            </p>
          </div>
        </div>
      </header>

      <div className="flex flex-1 gap-6 p-8">
        <div className="flex flex-1 flex-col gap-4">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-primary/20">
              <Volume2 className="h-5 w-5 text-primary" />
            </div>
            <h2 className="text-xl font-bold text-white/90">ادخل الآن</h2>
          </div>

          {called.length === 0 ? (
            <div className="flex flex-1 items-center justify-center rounded-2xl border border-white/10 bg-white/5">
              <p className="text-white/30">لا يوجد نداء حالياً</p>
            </div>
          ) : (
            <div className="grid gap-4">
              {called.map((entry) => {
                const name = resolvePatientName(entry);
                const isInProgress = entry.status === "in_progress";
                return (
                  <div
                    key={entry.id}
                    className={cn(
                      "rounded-2xl border-2 p-6 transition-all",
                      isInProgress
                        ? "border-emerald-400/60 bg-emerald-500/20"
                        : "border-primary/60 bg-primary/20 animate-pulse"
                    )}
                  >
                    <div className="flex items-center gap-4">
                      <div
                        className={cn(
                          "flex h-16 w-16 items-center justify-center rounded-2xl text-3xl font-black",
                          isInProgress
                            ? "bg-emerald-500/30 text-emerald-300"
                            : "bg-primary/30 text-primary"
                        )}
                      >
                        {entry.ticket_number}
                      </div>
                      <div className="flex-1">
                        <p className="text-2xl font-bold">{name}</p>
                        <p
                          className={cn(
                            "text-sm",
                            isInProgress ? "text-emerald-300" : "text-primary"
                          )}
                        >
                          {isInProgress ? "داخل الكشف —" : "تفضل —"}{" "}
                          {entry.doctor?.full_name_ar}
                        </p>
                      </div>
                      {isInProgress ? (
                        <CheckCircle2 className="h-8 w-8 text-emerald-400" />
                      ) : (
                        <Volume2 className="h-8 w-8 animate-bounce text-primary" />
                      )}
                      <button
                        type="button"
                        onClick={() =>
                          repeatQueueScreenAnnouncement(
                            name,
                            resolveDoctorName(entry),
                            true
                          )
                        }
                        className="flex h-10 w-10 items-center justify-center rounded-xl border border-white/20 bg-white/10 text-white/80 hover:bg-white/20"
                        title="إعادة النداء"
                      >
                        <RotateCcw className="h-5 w-5" />
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        <div className="flex w-80 flex-col gap-4">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-amber-500/20">
              <Clock className="h-5 w-5 text-amber-400" />
            </div>
            <h2 className="text-xl font-bold text-white/90">
              في الانتظار
              {waiting.length > 0 && (
                <span className="mr-2 rounded-full bg-amber-500/20 px-2 py-0.5 text-sm text-amber-400">
                  {waiting.length}
                </span>
              )}
            </h2>
          </div>

          <div className="flex flex-col gap-2 overflow-y-auto">
            {waiting.length === 0 ? (
              <div className="rounded-2xl border border-white/10 bg-white/5 p-6 text-center text-white/30">
                لا يوجد في الانتظار
              </div>
            ) : (
              waiting.slice(0, 10).map((entry, idx) => {
                const name = resolvePatientName(entry);
                return (
                  <div
                    key={entry.id}
                    className={cn(
                      "flex items-center gap-3 rounded-xl border border-white/10 bg-white/5 px-4 py-3",
                      idx === 0 && "border-amber-400/30 bg-amber-400/10"
                    )}
                  >
                    <span
                      className={cn(
                        "flex h-8 w-8 items-center justify-center rounded-lg text-sm font-bold",
                        idx === 0
                          ? "bg-amber-400/20 text-amber-300"
                          : "bg-white/10 text-white/50"
                      )}
                    >
                      {entry.ticket_number}
                    </span>
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium text-white/80">{name}</p>
                      <p className="truncate text-xs text-white/40">
                        {entry.doctor?.full_name_ar}
                      </p>
                    </div>
                    {idx === 0 && <span className="text-xs text-amber-400">التالي</span>}
                  </div>
                );
              })
            )}
            {waiting.length > 10 && (
              <p className="text-center text-xs text-white/30">
                +{waiting.length - 10} آخرون في الانتظار
              </p>
            )}
          </div>

          {screenUrl && (
            <button
              type="button"
              onClick={() => void navigator.clipboard?.writeText(screenUrl)}
              className="mt-auto flex items-center justify-center gap-2 rounded-xl border border-white/10 bg-white/5 py-2 text-xs text-white/50 hover:bg-white/10"
            >
              <Copy className="h-3.5 w-3.5" />
              نسخ رابط الشاشة للتلفاز
            </button>
          )}
        </div>
      </div>

      <footer className="border-t border-white/10 px-8 py-3 text-center text-xs text-white/20">
        Master Clinic Plus — نظام إدارة العيادات الذكي
      </footer>
    </div>
  );
}

export default function QueueScreenPage() {
  return (
    <Suspense
      fallback={
        <div className="flex min-h-screen items-center justify-center bg-slate-900 text-white">
          جارٍ تحميل شاشة الانتظار...
        </div>
      }
    >
      <QueueScreenContent />
    </Suspense>
  );
}
