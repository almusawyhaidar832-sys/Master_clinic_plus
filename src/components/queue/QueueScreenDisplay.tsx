"use client";

import { cn } from "@/lib/utils";
import {
  Activity,
  CheckCircle2,
  Clock,
  Copy,
  RotateCcw,
  Sparkles,
  Stethoscope,
  Volume2,
} from "lucide-react";

export interface QueueScreenEntry {
  id: string;
  ticket_number: number;
  status: "waiting" | "called" | "in_progress" | "done" | "cancelled";
  patient_name: string | null;
  doctor: { full_name_ar: string } | null;
  patient: {
    full_name_ar: string;
    speech_name_ar?: string | null;
    gender?: string | null;
  } | null;
  called_at: string | null;
}

interface QueueScreenDisplayProps {
  clinicName: string;
  currentTime: string;
  currentDate: string;
  called: QueueScreenEntry[];
  waiting: QueueScreenEntry[];
  liveCallEntryId?: string;
  liveCallTick?: number;
  liveCallRecall?: boolean;
  installedApp: boolean;
  screenUrl?: string;
  resolvePatientName: (entry: QueueScreenEntry) => string;
  resolveDoctorName: (entry: QueueScreenEntry) => string;
  onRepeatCall: (entry: QueueScreenEntry) => void;
  onTestSound: () => void;
}

function CalledCard({
  entry,
  isLive,
  isRecall,
  resolvePatientName,
  resolveDoctorName,
  onRepeatCall,
  animationKey,
}: {
  entry: QueueScreenEntry;
  isLive: boolean;
  isRecall: boolean;
  resolvePatientName: (entry: QueueScreenEntry) => string;
  resolveDoctorName: (entry: QueueScreenEntry) => string;
  onRepeatCall: (entry: QueueScreenEntry) => void;
  animationKey: string;
}) {
  const name = resolvePatientName(entry);
  const doctor = resolveDoctorName(entry);
  const isInProgress = entry.status === "in_progress";

  return (
    <div
      key={animationKey}
      className={cn(
        "qs-enter relative overflow-hidden rounded-3xl p-8 lg:p-10",
        isInProgress
          ? "border-2 border-emerald-400/50 bg-gradient-to-br from-emerald-500/20 via-emerald-900/20 to-slate-900/40"
          : isRecall
            ? "qs-call-active border-2 border-amber-400/60 bg-gradient-to-br from-amber-500/25 via-orange-900/15 to-slate-900/40"
            : "qs-call-active qs-call-ring border-2 border-cyan-400/50 bg-gradient-to-br from-cyan-500/20 via-teal-900/20 to-slate-900/40"
      )}
    >
      <div
        className={cn(
          "pointer-events-none absolute -left-20 -top-20 h-56 w-56 rounded-full blur-3xl",
          isInProgress ? "bg-emerald-400/20" : isRecall ? "bg-amber-400/25" : "bg-cyan-400/25"
        )}
      />
      <div
        className={cn(
          "pointer-events-none absolute -bottom-16 -right-16 h-48 w-48 rounded-full blur-3xl",
          isInProgress ? "bg-teal-400/10" : "bg-blue-500/10"
        )}
      />

      <div className="relative flex flex-col items-center gap-6 text-center lg:flex-row lg:text-right">
        <div
          className={cn(
            "relative flex h-28 w-28 shrink-0 items-center justify-center rounded-3xl border-2 lg:h-32 lg:w-32",
            isInProgress
              ? "border-emerald-300/40 bg-emerald-500/15"
              : "border-cyan-300/40 bg-cyan-500/10"
          )}
        >
          <span
            className={cn(
              "qs-ticket-glow text-5xl font-black tabular-nums lg:text-6xl",
              isInProgress ? "text-emerald-300" : "text-cyan-300"
            )}
          >
            {entry.ticket_number}
          </span>
        </div>

        <div className="min-w-0 flex-1 space-y-3">
          <div
            className={cn(
              "inline-flex items-center gap-2 rounded-full px-4 py-1.5 text-sm font-bold",
              isInProgress
                ? "bg-emerald-500/20 text-emerald-200"
                : isRecall
                  ? "bg-amber-500/25 text-amber-100"
                  : "bg-cyan-500/20 text-cyan-100"
            )}
          >
            {isInProgress ? (
              <>
                <CheckCircle2 className="h-4 w-4" />
                داخل الكشف الآن
              </>
            ) : isRecall ? (
              <>
                <Volume2 className="h-4 w-4 animate-pulse" />
                إعادة النداء
              </>
            ) : (
              <>
                <Volume2 className="h-4 w-4 animate-bounce" />
                {isLive ? "يُنادى الآن" : "تفضل بالدخول"}
              </>
            )}
          </div>

          <h3 className="text-4xl font-black leading-tight tracking-tight text-white lg:text-5xl xl:text-6xl">
            {name}
          </h3>

          <p className="flex items-center justify-center gap-2 text-xl text-white/70 lg:justify-start lg:text-2xl">
            <Stethoscope
              className={cn(
                "h-6 w-6 shrink-0",
                isInProgress ? "text-emerald-400" : "text-teal-400"
              )}
            />
            <span>
              {isInProgress ? "عند الطبيب" : "الطبيب"} —{" "}
              <strong className="text-white">{doctor}</strong>
            </span>
          </p>
        </div>

        <button
          type="button"
          onClick={() => onRepeatCall(entry)}
          className="relative flex h-14 w-14 shrink-0 items-center justify-center rounded-2xl border border-white/15 bg-white/10 text-white/80 transition hover:bg-white/20"
          title="إعادة النداء"
        >
          <RotateCcw className="h-6 w-6" />
        </button>
      </div>
    </div>
  );
}

export function QueueScreenDisplay({
  clinicName,
  currentTime,
  currentDate,
  called,
  waiting,
  liveCallEntryId,
  liveCallTick = 0,
  liveCallRecall,
  installedApp,
  screenUrl,
  resolvePatientName,
  resolveDoctorName,
  onRepeatCall,
  onTestSound,
}: QueueScreenDisplayProps) {
  return (
    <div className="qs-bg-mesh relative flex min-h-screen flex-col overflow-hidden text-white">
      <div className="qs-grid-overlay pointer-events-none absolute inset-0 opacity-60" />

      {/* Header */}
      <header className="qs-glass relative z-10 flex flex-wrap items-center justify-between gap-4 border-b border-white/10 px-6 py-5 lg:px-10">
        <div className="flex items-center gap-4">
          <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-gradient-to-br from-cyan-400 to-teal-600 shadow-lg shadow-cyan-500/20">
            <Activity className="h-7 w-7 text-white" />
          </div>
          <div>
            <h1 className="qs-title-shimmer text-2xl font-black lg:text-3xl">
              {clinicName}
            </h1>
            <p className="mt-0.5 flex items-center gap-2 text-sm text-white/50">
              <Sparkles className="h-3.5 w-3.5 text-cyan-400" />
              شاشة انتظار المراجعين — نداء صوتي تلقائي
            </p>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-3 lg:gap-5">
          <button
            type="button"
            onClick={onTestSound}
            className="hidden rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-xs text-white/50 hover:bg-white/10 sm:block"
          >
            اختبار الصوت
          </button>
          <div className="flex items-center gap-2 rounded-2xl border border-cyan-400/30 bg-cyan-500/10 px-4 py-2.5">
            <span className="relative flex h-2.5 w-2.5">
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-cyan-400 opacity-60" />
              <span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-cyan-400" />
            </span>
            <Volume2 className="h-4 w-4 text-cyan-300" />
            <span className="text-sm font-semibold text-cyan-100">الصوت مفعّل</span>
          </div>
          <div className="text-left">
            <p className="text-4xl font-black tabular-nums tracking-tight text-white lg:text-5xl">
              {currentTime}
            </p>
            <p className="text-sm text-white/45">{currentDate}</p>
          </div>
        </div>
      </header>

      <div className="relative z-10 flex flex-1 flex-col gap-6 p-6 lg:flex-row lg:gap-8 lg:p-8">
        {/* Main — Now calling */}
        <section className="flex min-h-0 flex-1 flex-col gap-5">
          <div className="flex items-center gap-3">
            <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-gradient-to-br from-cyan-500/30 to-teal-600/20">
              <Volume2 className="h-5 w-5 text-cyan-300" />
            </div>
            <div>
              <h2 className="text-2xl font-bold text-white">المراجع المطلوب</h2>
              <p className="text-sm text-white/40">يرجى الانتباه للنداء والتوجه للكشف</p>
            </div>
          </div>

          {called.length === 0 ? (
            <div className="qs-glass qs-icon-float flex flex-1 flex-col items-center justify-center rounded-3xl px-8 py-16 text-center">
              <div className="mb-6 flex h-24 w-24 items-center justify-center rounded-full border border-white/10 bg-white/5">
                <Clock className="h-12 w-12 text-white/20" />
              </div>
              <p className="text-2xl font-semibold text-white/50">لا يوجد نداء حالياً</p>
              <p className="mt-2 max-w-md text-sm leading-relaxed text-white/30">
                سيظهر اسم المراجع ورقم الدور هنا عند النداء — مع إعلان صوتي واضح
              </p>
            </div>
          ) : (
            <div className="flex flex-col gap-5">
              {called.map((entry) => (
                <CalledCard
                  key={`${entry.id}-${entry.id === liveCallEntryId ? liveCallTick : 0}`}
                  animationKey={`${entry.id}-${entry.id === liveCallEntryId ? liveCallTick : 0}`}
                  entry={entry}
                  isLive={entry.id === liveCallEntryId}
                  isRecall={entry.id === liveCallEntryId && Boolean(liveCallRecall)}
                  resolvePatientName={resolvePatientName}
                  resolveDoctorName={resolveDoctorName}
                  onRepeatCall={onRepeatCall}
                />
              ))}
            </div>
          )}
        </section>

        {/* Sidebar — Waiting */}
        <aside className="flex w-full flex-col gap-4 lg:w-[22rem] xl:w-[26rem]">
          <div className="qs-glass rounded-3xl p-5">
            <div className="mb-4 flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-amber-500/15">
                  <Clock className="h-5 w-5 text-amber-400" />
                </div>
                <div>
                  <h2 className="text-lg font-bold text-white">قائمة الانتظار</h2>
                  <p className="text-xs text-white/40">المراجعون التاليون</p>
                </div>
              </div>
              {waiting.length > 0 && (
                <span className="rounded-full bg-amber-500/20 px-3 py-1 text-sm font-bold text-amber-300">
                  {waiting.length}
                </span>
              )}
            </div>

            <div className="flex max-h-[min(52vh,520px)] flex-col gap-2 overflow-y-auto pr-1">
              {waiting.length === 0 ? (
                <div className="rounded-2xl border border-dashed border-white/10 py-12 text-center">
                  <p className="text-sm text-white/35">لا يوجد أحد في الانتظار</p>
                </div>
              ) : (
                waiting.slice(0, 12).map((entry, idx) => {
                  const name = resolvePatientName(entry);
                  const isNext = idx === 0;
                  return (
                    <div
                      key={entry.id}
                      className={cn(
                        "flex items-center gap-3 rounded-2xl border px-4 py-3.5 transition",
                        isNext
                          ? "border-amber-400/35 bg-gradient-to-l from-amber-500/15 to-transparent"
                          : "border-white/8 bg-white/[0.03]"
                      )}
                    >
                      <span
                        className={cn(
                          "flex h-10 w-10 shrink-0 items-center justify-center rounded-xl text-base font-black tabular-nums",
                          isNext
                            ? "bg-amber-400/20 text-amber-200"
                            : "bg-white/8 text-white/45"
                        )}
                      >
                        {entry.ticket_number}
                      </span>
                      <div className="min-w-0 flex-1">
                        <p
                          className={cn(
                            "truncate font-semibold",
                            isNext ? "text-white" : "text-white/75"
                          )}
                        >
                          {name}
                        </p>
                        <p className="truncate text-xs text-white/40">
                          {entry.doctor?.full_name_ar}
                        </p>
                      </div>
                      {isNext && (
                        <span className="shrink-0 rounded-lg bg-amber-500/25 px-2 py-1 text-[10px] font-bold text-amber-200">
                          التالي
                        </span>
                      )}
                    </div>
                  );
                })
              )}
              {waiting.length > 12 && (
                <p className="py-2 text-center text-xs text-white/30">
                  +{waiting.length - 12} في الانتظار
                </p>
              )}
            </div>
          </div>

          {screenUrl && (
            <button
              type="button"
              onClick={() => void navigator.clipboard?.writeText(screenUrl)}
              className="flex items-center justify-center gap-2 rounded-xl border border-white/5 py-2 text-[10px] text-white/25 hover:bg-white/5 hover:text-white/40"
            >
              <Copy className="h-3 w-3" />
              نسخ رابط الشاشة
            </button>
          )}
        </aside>
      </div>

      <footer className="qs-glass relative z-10 border-t border-white/10 px-6 py-3 text-center">
        <p className="text-xs font-medium text-white/35">
          Master Clinic Plus
          <span className="mx-2 text-white/15">·</span>
          {clinicName}
        </p>
        <p className="mt-0.5 text-[10px] text-white/25">
          {installedApp
            ? "مثبّتة على هذا الجهاز — تفتح تلقائياً"
            : "نظام إدارة العيادات الذكي"}
        </p>
      </footer>
    </div>
  );
}
