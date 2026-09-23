"use client";

import { cn } from "@/lib/utils";
import { QueueScreenPwaInstall } from "@/components/queue/QueueScreenPwaInstall";
import {
  CheckCircle2,
  Clock,
  Copy,
  RotateCcw,
  Sparkles,
  Stethoscope,
  Volume2,
} from "lucide-react";

/** أقصى عدد مراجعين «مطلوبين الآن» على شاشة الانتظار */
export const MAX_CALLED_ON_SCREEN = 10;

function calledGridColumns(count: number): string {
  const n = Math.min(count, MAX_CALLED_ON_SCREEN);
  if (n <= 1) return "1fr";
  if (n === 2) return "repeat(2, minmax(0, 1fr))";
  if (n <= 4) return "repeat(3, minmax(0, 1fr))";
  if (n <= 9) return "repeat(3, minmax(0, 1fr))";
  return "repeat(5, minmax(0, 1fr))";
}

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
  audioUnlocked?: boolean;
  audioUnlockHint?: string;
  audioDiagnosticMessage?: string | null;
  screenUrl?: string;
  resolvePatientName: (entry: QueueScreenEntry) => string;
  resolveDoctorName: (entry: QueueScreenEntry) => string;
  onRepeatCall: (entry: QueueScreenEntry) => void;
  onTestSound: () => void;
  onInstalled?: () => void;
  onCopyDiagnostics?: () => void;
}

function CalledCard({
  entry,
  isLive,
  isRecall,
  compact = false,
  dense = false,
  resolvePatientName,
  resolveDoctorName,
  onRepeatCall,
  animationKey,
}: {
  entry: QueueScreenEntry;
  isLive: boolean;
  isRecall: boolean;
  compact?: boolean;
  dense?: boolean;
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
        "qs-enter qs-call-card relative overflow-hidden rounded-[2rem] border-[3px] px-5 py-6 lg:px-8 lg:py-8",
        compact && "qs-call-card-compact rounded-2xl border-2 px-4 py-4",
        dense && "qs-call-card-dense",
        isInProgress
          ? "qs-call-card-progress"
          : isRecall
            ? "qs-call-active qs-call-card-recall"
            : "qs-call-active qs-call-ring qs-call-card-live"
      )}
    >
      <div
        className={cn(
          "pointer-events-none absolute inset-x-0 top-0 h-3",
          isInProgress
            ? "bg-gradient-to-l from-success-text to-primary-400"
            : isRecall
              ? "bg-gradient-to-l from-warning-text to-premium-400"
              : "bg-gradient-to-l from-primary-400 to-primary-600"
        )}
      />

      <div className="relative flex flex-col items-center text-center">
        <div
          className={cn(
            "qs-call-status-badge mb-6 inline-flex items-center gap-3 rounded-2xl px-6 py-3 text-lg font-black lg:text-xl",
            compact && "mb-3 px-4 py-2 text-sm",
            isInProgress
              ? "bg-success-text text-white shadow-glow"
              : isRecall
                ? "bg-warning-text text-white shadow-gold"
                : "bg-gradient-to-l from-primary-600 to-primary-500 text-white shadow-glow"
          )}
        >
          {isInProgress ? (
            <>
              <CheckCircle2 className="h-7 w-7 shrink-0" />
              داخل الكشف الآن
            </>
          ) : isRecall ? (
            <>
              <Volume2 className="h-7 w-7 shrink-0 animate-pulse" />
              إعادة النداء — تفضل بالدخول
            </>
          ) : (
            <>
              <Volume2 className="h-7 w-7 shrink-0 animate-bounce" />
              {isLive ? "يُنادى الآن — تفضل بالدخول" : "تفضل بالدخول"}
            </>
          )}
        </div>

        <p className={cn("mb-2 text-lg font-bold tracking-wide text-slate-muted lg:text-xl", compact && "mb-1 text-sm")}>
          رقم الدور
        </p>
        <div
          className={cn(
            "qs-ticket-hero qs-ticket-glow mb-8 tabular-nums",
            compact && "mb-3",
            isInProgress
              ? "text-success-text"
              : isRecall
                ? "text-warning-text"
                : "text-primary-600"
          )}
        >
          {entry.ticket_number}
        </div>

        <p className={cn("mb-3 text-xl font-bold text-primary-700 lg:text-2xl", compact && "mb-1 text-sm")}>المراجع</p>
        <h3 className={cn("qs-patient-hero mb-8 max-w-full px-2", compact && "mb-3")}>{name}</h3>

        <div
          className={cn(
            "flex w-full max-w-2xl items-center justify-center gap-3 rounded-2xl border-2 px-6 py-4",
            compact && "max-w-none px-3 py-2",
            isInProgress
              ? "border-success-border bg-success"
              : "border-primary/15 bg-primary-50/60"
          )}
        >
          <Stethoscope
            className={cn(
              "h-8 w-8 shrink-0 lg:h-10 lg:w-10",
              isInProgress ? "text-success-text" : "text-primary-600"
            )}
          />
          <p className="qs-doctor-name text-center">
            <span className="font-medium text-slate-muted">
              {isInProgress ? "عند الطبيب" : "الطبيب المعالج"}
            </span>
            <br />
            <span
              className={cn(
                "font-bold",
                isInProgress ? "text-success-text" : "text-primary-700"
              )}
            >
              {doctor}
            </span>
          </p>
        </div>

        {!dense && (
          <button
            type="button"
            onClick={() => onRepeatCall(entry)}
            className={cn(
              "qs-repeat-btn mt-6 flex items-center gap-2 rounded-xl border border-slate-border bg-surface-card px-5 py-2.5 text-sm font-semibold text-slate-muted shadow-sm transition-colors hover:bg-primary-50 hover:text-primary-700",
              compact && "mt-3 px-3 py-1.5 text-xs"
            )}
            title="إعادة النداء"
          >
            <RotateCcw className="h-5 w-5" />
            إعادة النداء
          </button>
        )}
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
  audioUnlocked = false,
  audioUnlockHint = "اضغط أي مكان لتفعيل الصوت",
  audioDiagnosticMessage,
  screenUrl,
  resolvePatientName,
  resolveDoctorName,
  onRepeatCall,
  onTestSound,
  onInstalled,
  onCopyDiagnostics,
}: QueueScreenDisplayProps) {
  const displayedCalled = called.slice(0, MAX_CALLED_ON_SCREEN);
  const multiCall = displayedCalled.length > 1;
  const denseCall = displayedCalled.length >= 5;

  return (
    <div className="qs-bg-mesh qs-tv-display-root relative flex h-full min-h-0 flex-col overflow-hidden">
      {/* طبقة أضواء متحركة */}
      <div className="qs-aurora-layer" aria-hidden>
        <div className="qs-aurora-blob qs-aurora-blob--1" />
        <div className="qs-aurora-blob qs-aurora-blob--2" />
        <div className="qs-aurora-blob qs-aurora-blob--3" />
      </div>
      <div className="qs-grid-overlay pointer-events-none absolute inset-0 opacity-50" />

      {/* بانر العيادة */}
      <div className="qs-clinic-banner relative z-20 shrink-0 px-4 py-3 text-white lg:px-8 lg:py-4">
        <div className="qs-tv-banner-row relative flex items-center justify-between gap-4">
          <div className="qs-tv-banner-side z-10 flex shrink-0">
            <button
              type="button"
              onClick={onTestSound}
              autoFocus
              className={cn(
                "flex items-center gap-2 rounded-2xl border px-5 py-3 backdrop-blur-sm transition-colors focus:outline-none focus-visible:ring-4 focus-visible:ring-white/60",
                audioUnlocked
                  ? "border-white/30 bg-white/15 hover:bg-white/20"
                  : "border-premium-300/40 bg-premium-500/25 hover:bg-premium-500/35 animate-pulse"
              )}
            >
              <span className="relative flex h-3 w-3">
                <span
                  className={cn(
                    "absolute inline-flex h-full w-full rounded-full",
                    audioUnlocked
                      ? "animate-ping bg-white opacity-70"
                      : "bg-premium-200 opacity-90"
                  )}
                />
                <span
                  className={cn(
                    "relative inline-flex h-3 w-3 rounded-full",
                    audioUnlocked ? "bg-white" : "bg-premium-300"
                  )}
                />
              </span>
              <Volume2 className={cn("h-5 w-5", audioUnlocked ? "text-white" : "text-premium-100")} />
              <span className="text-base font-bold">
                {audioUnlocked ? "الصوت مفعّل — اضغط للاختبار" : audioUnlockHint}
              </span>
            </button>
          </div>

          <div className="qs-tv-banner-center pointer-events-none absolute inset-x-0 flex flex-col items-center justify-center px-4 text-center sm:px-32 lg:px-56">
            <p className="qs-welcome-text mb-0.5 flex items-center justify-center gap-2.5">
              <Sparkles className="qs-welcome-spark h-5 w-5 shrink-0 lg:h-6 lg:w-6" />
              مرحباً بكم في
              <Sparkles className="qs-welcome-spark h-5 w-5 shrink-0 lg:h-6 lg:w-6" />
            </p>
            <h1 className="qs-clinic-hero">{clinicName}</h1>
          </div>

          <div className="qs-tv-banner-side z-10 ms-auto flex shrink-0">
            <div className="rounded-2xl border border-white/15 bg-white/10 px-5 py-3 text-center backdrop-blur-sm">
              <p className="text-5xl font-black tabular-nums leading-none tracking-tight lg:text-6xl">
                {currentTime}
              </p>
              <p className="mt-1 text-sm font-medium text-white/75 lg:text-base">
                {currentDate}
              </p>
            </div>
          </div>
        </div>
        {audioDiagnosticMessage && (
          <p className="mt-2 text-center text-xs font-medium text-white/85">
            {audioDiagnosticMessage}
          </p>
        )}
      </div>

      <div className="qs-tv-main-row relative z-10 flex min-h-0 flex-1 flex-col gap-3 overflow-hidden p-3 lg:flex-row lg:gap-4 lg:p-4">
        <section className="flex min-h-0 flex-1 flex-col gap-2 overflow-hidden">
          <h2 className="qs-section-heading shrink-0 text-center text-2xl lg:text-3xl">
            <span className="qs-sparkle-dot" aria-hidden />
            المراجع المطلوب الآن
            <span className="qs-sparkle-dot" aria-hidden />
          </h2>

          {displayedCalled.length === 0 ? (
            <div className="qs-glass qs-icon-float flex flex-1 flex-col items-center justify-center rounded-[2rem] px-8 py-10 text-center">
              <div className="mb-6 flex h-24 w-24 items-center justify-center rounded-full bg-gradient-to-br from-primary-100 to-primary-50 shadow-glow ring-4 ring-primary/10">
                <Clock className="h-12 w-12 text-primary-600" />
              </div>
              <p className="text-3xl font-bold text-slate-text">لا يوجد نداء حالياً</p>
              <p className="mt-3 max-w-lg text-lg leading-relaxed text-slate-muted">
                سيظهر <strong className="text-primary-700">اسم المراجع</strong> و{" "}
                <strong className="text-primary-700">رقم الدور</strong> هنا بحجم كبير
                عند النداء
              </p>
            </div>
          ) : (
            <div
              className="qs-called-grid min-h-0 flex-1 overflow-hidden"
              data-count={String(displayedCalled.length)}
              style={{ gridTemplateColumns: calledGridColumns(displayedCalled.length) }}
            >
              {displayedCalled.map((entry) => (
                <CalledCard
                  key={`${entry.id}-${entry.id === liveCallEntryId ? liveCallTick : 0}`}
                  animationKey={`${entry.id}-${entry.id === liveCallEntryId ? liveCallTick : 0}`}
                  entry={entry}
                  isLive={entry.id === liveCallEntryId}
                  isRecall={entry.id === liveCallEntryId && Boolean(liveCallRecall)}
                  compact={multiCall}
                  dense={denseCall}
                  resolvePatientName={resolvePatientName}
                  resolveDoctorName={resolveDoctorName}
                  onRepeatCall={onRepeatCall}
                />
              ))}
            </div>
          )}
          {called.length > MAX_CALLED_ON_SCREEN && (
            <p className="shrink-0 py-1 text-center text-sm font-medium text-slate-muted">
              +{called.length - MAX_CALLED_ON_SCREEN} مراجعين آخرين مطلوبين
            </p>
          )}
        </section>

        <aside className="qs-tv-sidebar flex min-h-0 w-full shrink-0 flex-col lg:w-[min(28vw,24rem)]">
          <div className="qs-glass flex h-full min-h-0 flex-col rounded-[2rem] p-4 lg:p-5">
            <div className="mb-5 flex items-center justify-between border-b border-primary/10 pb-4">
              <div>
                <h2 className="text-2xl font-black text-slate-text">قائمة الانتظار</h2>
                <p className="text-sm font-medium text-slate-muted">المراجعون التاليون</p>
              </div>
              {waiting.length > 0 && (
                <span className="flex h-12 min-w-[3rem] items-center justify-center rounded-2xl bg-gradient-to-br from-amber-400 to-orange-500 px-3 text-2xl font-black text-white shadow-md shadow-amber-400/30">
                  {waiting.length}
                </span>
              )}
            </div>

            <div className="flex min-h-0 flex-1 flex-col gap-2 overflow-hidden pr-1">
              {waiting.length === 0 ? (
                <div className="rounded-2xl border-2 border-dashed border-amber-200 bg-amber-50/50 py-16 text-center">
                  <p className="text-lg font-medium text-slate-muted">لا يوجد أحد في الانتظار</p>
                </div>
              ) : (
                waiting.slice(0, 10).map((entry, idx) => {
                  const name = resolvePatientName(entry);
                  const doctor = resolveDoctorName(entry);
                  const isNext = idx === 0;
                  return (
                    <div
                      key={entry.id}
                      className={cn(
                        "flex items-start gap-4 rounded-2xl border-2 px-4 py-4 transition-shadow",
                        isNext
                          ? "border-amber-300 bg-gradient-to-l from-amber-50 to-orange-50 shadow-sm"
                          : "border-primary/10 bg-surface-card hover:shadow-soft"
                      )}
                    >
                      <span
                        className={cn(
                          "flex h-14 w-14 shrink-0 items-center justify-center rounded-xl text-2xl font-black tabular-nums",
                          isNext
                            ? "bg-gradient-to-br from-amber-400 to-orange-500 text-white shadow-sm"
                            : "bg-primary-100 text-primary-700"
                        )}
                      >
                        {entry.ticket_number}
                      </span>
                      <div className="min-w-0 flex-1">
                        <p
                          className={cn(
                            "break-words leading-snug",
                            isNext ? "qs-waiting-name-next" : "qs-waiting-name"
                          )}
                        >
                          {name}
                        </p>
                        <p className="mt-1 text-base font-medium text-primary-700">
                          <span className="text-slate-muted">الطبيب: </span>
                          {doctor}
                        </p>
                      </div>
                      {isNext && (
                        <span className="shrink-0 rounded-xl bg-gradient-to-l from-amber-500 to-orange-500 px-3 py-1.5 text-sm font-black text-white shadow-sm">
                          التالي
                        </span>
                      )}
                    </div>
                  );
                })
              )}
              {waiting.length > 10 && (
                <p className="py-2 text-center text-sm font-medium text-slate-muted">
                  +{waiting.length - 10} في الانتظار
                </p>
              )}
            </div>
          </div>

        {(screenUrl || onCopyDiagnostics) && (
          <div className="mt-2 flex flex-wrap items-center justify-center gap-x-4 gap-y-1">
            {screenUrl && (
              <button
                type="button"
                onClick={() => void navigator.clipboard?.writeText(screenUrl)}
                className="flex items-center justify-center gap-2 py-2 text-[10px] text-slate-muted hover:text-primary-600"
              >
                <Copy className="h-3 w-3" />
                نسخ رابط الشاشة
              </button>
            )}
            {onCopyDiagnostics && (
              <button
                type="button"
                onClick={onCopyDiagnostics}
                className="flex items-center justify-center gap-2 py-2 text-[10px] text-slate-muted hover:text-primary-600"
              >
                <Copy className="h-3 w-3" />
                نسخ معلومات التشخيص لإرسالها للدعم الفني
              </button>
            )}
          </div>
        )}
        </aside>
      </div>

      <footer className="qs-tv-footer qs-glass relative z-10 shrink-0 border-t border-primary/10 px-4 py-2 text-center">
        <p className="text-xl font-bold text-primary-800">{clinicName}</p>
        <p className="mt-1 text-sm text-slate-muted">
          Master Clinic Plus
          {installedApp ? " · مثبّتة على هذا الجهاز" : ""}
        </p>
        {!installedApp && (
          <div className="mt-2">
            <QueueScreenPwaInstall variant="compact" onInstalled={onInstalled} />
          </div>
        )}
      </footer>
    </div>
  );
}
