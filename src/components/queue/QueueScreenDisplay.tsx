"use client";

import { cn } from "@/lib/utils";
import {
  CheckCircle2,
  Clock,
  Copy,
  RotateCcw,
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
        "qs-enter relative overflow-hidden rounded-[2rem] px-8 py-10 lg:px-12 lg:py-14",
        isInProgress
          ? "border-[3px] border-emerald-400/60 bg-gradient-to-b from-emerald-500/25 to-slate-950/80"
          : isRecall
            ? "qs-call-active border-[3px] border-amber-400/70 bg-gradient-to-b from-amber-500/30 to-slate-950/80"
            : "qs-call-active qs-call-ring border-[3px] border-cyan-400/60 bg-gradient-to-b from-cyan-500/25 to-slate-950/80"
      )}
    >
      <div
        className={cn(
          "pointer-events-none absolute inset-x-0 top-0 h-32 bg-gradient-to-b to-transparent opacity-40",
          isInProgress ? "from-emerald-400/30" : isRecall ? "from-amber-400/35" : "from-cyan-400/35"
        )}
      />

      <div className="relative flex flex-col items-center text-center">
        {/* حالة النداء */}
        <div
          className={cn(
            "mb-6 inline-flex items-center gap-3 rounded-2xl px-6 py-3 text-lg font-black lg:text-xl",
            isInProgress
              ? "bg-emerald-500/30 text-emerald-50"
              : isRecall
                ? "bg-amber-500/35 text-amber-50"
                : "bg-cyan-500/30 text-cyan-50"
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

        {/* رقم الدور */}
        <p className="mb-2 text-lg font-bold tracking-wide text-white/50 lg:text-xl">
          رقم الدور
        </p>
        <div
          className={cn(
            "qs-ticket-glow qs-ticket-hero mb-8 tabular-nums",
            isInProgress ? "text-emerald-300" : isRecall ? "text-amber-300" : "text-cyan-300"
          )}
        >
          {entry.ticket_number}
        </div>

        {/* اسم المراجع — الأبرز */}
        <p className="mb-3 text-xl font-bold text-white/55 lg:text-2xl">المراجع</p>
        <h3 className="qs-patient-hero mb-8 max-w-full px-2">{name}</h3>

        {/* الطبيب */}
        <div
          className={cn(
            "flex w-full max-w-2xl items-center justify-center gap-3 rounded-2xl border px-6 py-4",
            isInProgress
              ? "border-emerald-400/30 bg-emerald-950/40"
              : "border-white/15 bg-black/25"
          )}
        >
          <Stethoscope
            className={cn(
              "h-8 w-8 shrink-0 lg:h-10 lg:w-10",
              isInProgress ? "text-emerald-400" : "text-teal-400"
            )}
          />
          <p className="qs-doctor-name text-center">
            <span className="font-medium text-white/55">
              {isInProgress ? "عند الطبيب" : "الطبيب المعالج"}
            </span>
            <br />
            <span className="text-white">{doctor}</span>
          </p>
        </div>

        <button
          type="button"
          onClick={() => onRepeatCall(entry)}
          className="mt-6 flex items-center gap-2 rounded-xl border border-white/20 bg-white/10 px-5 py-2.5 text-sm font-semibold text-white/70 hover:bg-white/15"
          title="إعادة النداء"
        >
          <RotateCcw className="h-5 w-5" />
          إعادة النداء
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
      <div className="qs-grid-overlay pointer-events-none absolute inset-0 opacity-40" />

      {/* بانر اسم العيادة — واضح جداً */}
      <div className="qs-clinic-banner qs-glass relative z-20 px-6 py-5 lg:px-10 lg:py-6">
        <div className="flex flex-col items-center gap-4 lg:flex-row lg:justify-between">
          <div className="w-full flex-1 text-center lg:text-right">
            <p className="mb-1 text-sm font-semibold tracking-widest text-cyan-300/80 lg:text-base">
              مرحباً بكم في
            </p>
            <h1 className="qs-clinic-hero">{clinicName}</h1>
            <p className="mt-2 text-base font-medium text-white/45 lg:text-lg">
              شاشة انتظار المراجعين
            </p>
          </div>

          <div className="flex shrink-0 flex-wrap items-center justify-center gap-4 lg:gap-6">
            <div className="flex items-center gap-2 rounded-2xl border border-cyan-400/35 bg-cyan-500/15 px-5 py-3">
              <span className="relative flex h-3 w-3">
                <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-cyan-400 opacity-70" />
                <span className="relative inline-flex h-3 w-3 rounded-full bg-cyan-400" />
              </span>
              <Volume2 className="h-5 w-5 text-cyan-200" />
              <span className="text-base font-bold text-cyan-50">الصوت مفعّل</span>
            </div>
            <div className="text-center lg:text-left">
              <p className="text-5xl font-black tabular-nums leading-none text-white lg:text-6xl">
                {currentTime}
              </p>
              <p className="mt-1 text-sm font-medium text-white/50 lg:text-base">
                {currentDate}
              </p>
            </div>
            <button
              type="button"
              onClick={onTestSound}
              className="hidden rounded-xl border border-white/10 px-3 py-2 text-xs text-white/40 hover:bg-white/10 xl:block"
            >
              اختبار الصوت
            </button>
          </div>
        </div>
      </div>

      <div className="relative z-10 flex flex-1 flex-col gap-5 p-5 lg:flex-row lg:gap-6 lg:p-6">
        {/* النداء الرئيسي */}
        <section className="flex min-h-0 flex-1 flex-col gap-4">
          <h2 className="text-center text-2xl font-black text-white/90 lg:text-3xl">
            المراجع المطلوب الآن
          </h2>

          {called.length === 0 ? (
            <div className="qs-glass qs-icon-float flex flex-1 flex-col items-center justify-center rounded-[2rem] px-8 py-16 text-center">
              <Clock className="mb-6 h-20 w-20 text-white/15" />
              <p className="text-3xl font-bold text-white/45">لا يوجد نداء حالياً</p>
              <p className="mt-3 max-w-lg text-lg leading-relaxed text-white/30">
                سيظهر <strong className="text-white/50">اسم المراجع</strong> و{" "}
                <strong className="text-white/50">رقم الدور</strong> هنا بحجم كبير
                عند النداء
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

        {/* قائمة الانتظار */}
        <aside className="flex w-full flex-col lg:w-[min(32vw,28rem)]">
          <div className="qs-glass h-full rounded-[2rem] p-5 lg:p-6">
            <div className="mb-5 flex items-center justify-between border-b border-white/10 pb-4">
              <div>
                <h2 className="text-2xl font-black text-white">قائمة الانتظار</h2>
                <p className="text-sm font-medium text-white/45">المراجعون التاليون</p>
              </div>
              {waiting.length > 0 && (
                <span className="flex h-12 min-w-[3rem] items-center justify-center rounded-2xl bg-amber-500/25 px-3 text-2xl font-black text-amber-200">
                  {waiting.length}
                </span>
              )}
            </div>

            <div className="flex max-h-[min(58vh,560px)] flex-col gap-3 overflow-y-auto pr-1">
              {waiting.length === 0 ? (
                <div className="rounded-2xl border border-dashed border-white/10 py-16 text-center">
                  <p className="text-lg font-medium text-white/35">لا يوجد أحد في الانتظار</p>
                </div>
              ) : (
                waiting.slice(0, 10).map((entry, idx) => {
                  const name = resolvePatientName(entry);
                  const isNext = idx === 0;
                  return (
                    <div
                      key={entry.id}
                      className={cn(
                        "flex items-start gap-4 rounded-2xl border-2 px-4 py-4",
                        isNext
                          ? "border-amber-400/50 bg-gradient-to-l from-amber-500/20 to-amber-950/20"
                          : "border-white/10 bg-white/[0.04]"
                      )}
                    >
                      <span
                        className={cn(
                          "flex h-14 w-14 shrink-0 items-center justify-center rounded-xl text-2xl font-black tabular-nums",
                          isNext
                            ? "bg-amber-400/25 text-amber-100"
                            : "bg-white/10 text-white/50"
                        )}
                      >
                        {entry.ticket_number}
                      </span>
                      <div className="min-w-0 flex-1">
                        <p
                          className={cn(
                            "break-words leading-snug",
                            isNext ? "qs-waiting-name-next" : "qs-waiting-name text-white/80"
                          )}
                        >
                          {name}
                        </p>
                        <p className="mt-1 text-base font-medium text-white/45">
                          {entry.doctor?.full_name_ar}
                        </p>
                      </div>
                      {isNext && (
                        <span className="shrink-0 rounded-xl bg-amber-500/30 px-3 py-1.5 text-sm font-black text-amber-100">
                          التالي
                        </span>
                      )}
                    </div>
                  );
                })
              )}
              {waiting.length > 10 && (
                <p className="py-2 text-center text-sm font-medium text-white/35">
                  +{waiting.length - 10} في الانتظار
                </p>
              )}
            </div>
          </div>

          {screenUrl && (
            <button
              type="button"
              onClick={() => void navigator.clipboard?.writeText(screenUrl)}
              className="mt-2 flex items-center justify-center gap-2 py-2 text-[10px] text-white/20 hover:text-white/40"
            >
              <Copy className="h-3 w-3" />
              نسخ رابط الشاشة
            </button>
          )}
        </aside>
      </div>

      <footer className="qs-glass relative z-10 border-t border-cyan-500/20 px-6 py-4 text-center">
        <p className="text-xl font-bold text-white/70">{clinicName}</p>
        <p className="mt-1 text-sm text-white/35">
          Master Clinic Plus
          {installedApp ? " · مثبّتة على هذا الجهاز" : ""}
        </p>
      </footer>
    </div>
  );
}
