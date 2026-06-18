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
        "qs-enter qs-call-card relative overflow-hidden rounded-[2rem] border-[3px] px-8 py-10 lg:px-12 lg:py-14",
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
            ? "bg-gradient-to-l from-emerald-400 to-teal-400"
            : isRecall
              ? "bg-gradient-to-l from-amber-400 to-orange-400"
              : "bg-gradient-to-l from-cyan-400 to-teal-500"
        )}
      />

      <div className="relative flex flex-col items-center text-center">
        <div
          className={cn(
            "mb-6 inline-flex items-center gap-3 rounded-2xl px-6 py-3 text-lg font-black lg:text-xl",
            isInProgress
              ? "bg-emerald-500 text-white shadow-md shadow-emerald-500/30"
              : isRecall
                ? "bg-amber-500 text-white shadow-md shadow-amber-500/30"
                : "bg-gradient-to-l from-cyan-600 to-teal-600 text-white shadow-md shadow-cyan-500/30"
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

        <p className="mb-2 text-lg font-bold tracking-wide text-slate-500 lg:text-xl">
          رقم الدور
        </p>
        <div
          className={cn(
            "qs-ticket-hero mb-8 tabular-nums",
            isInProgress
              ? "text-emerald-600"
              : isRecall
                ? "text-amber-600"
                : "text-cyan-600"
          )}
        >
          {entry.ticket_number}
        </div>

        <p className="mb-3 text-xl font-bold text-teal-700 lg:text-2xl">المراجع</p>
        <h3 className="qs-patient-hero mb-8 max-w-full px-2">{name}</h3>

        <div
          className={cn(
            "flex w-full max-w-2xl items-center justify-center gap-3 rounded-2xl border-2 px-6 py-4",
            isInProgress
              ? "border-emerald-200 bg-emerald-50"
              : "border-sky-100 bg-sky-50"
          )}
        >
          <Stethoscope
            className={cn(
              "h-8 w-8 shrink-0 lg:h-10 lg:w-10",
              isInProgress ? "text-emerald-600" : "text-teal-600"
            )}
          />
          <p className="qs-doctor-name text-center">
            <span className="font-medium text-slate-500">
              {isInProgress ? "عند الطبيب" : "الطبيب المعالج"}
            </span>
            <br />
            <span className="text-slate-800">{doctor}</span>
          </p>
        </div>

        <button
          type="button"
          onClick={() => onRepeatCall(entry)}
          className="mt-6 flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-5 py-2.5 text-sm font-semibold text-slate-600 shadow-sm hover:bg-slate-50"
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
    <div className="qs-bg-mesh relative flex min-h-screen flex-col overflow-hidden">
      <div className="qs-grid-overlay pointer-events-none absolute inset-0 opacity-60" />

      {/* بانر العيادة */}
      <div className="qs-clinic-banner relative z-20 px-6 py-5 text-white lg:px-10 lg:py-6">
        <div className="flex flex-col items-center gap-4 lg:flex-row lg:justify-between">
          <div className="w-full flex-1 text-center lg:text-right">
            <p className="mb-1 text-sm font-semibold tracking-widest text-cyan-100 lg:text-base">
              مرحباً بكم في
            </p>
            <h1 className="qs-clinic-hero">{clinicName}</h1>
            <p className="mt-2 text-base font-medium text-white/80 lg:text-lg">
              شاشة انتظار المراجعين
            </p>
          </div>

          <div className="flex shrink-0 flex-wrap items-center justify-center gap-4 lg:gap-6">
            <div className="flex items-center gap-2 rounded-2xl border border-white/30 bg-white/15 px-5 py-3 backdrop-blur-sm">
              <span className="relative flex h-3 w-3">
                <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-white opacity-70" />
                <span className="relative inline-flex h-3 w-3 rounded-full bg-white" />
              </span>
              <Volume2 className="h-5 w-5 text-white" />
              <span className="text-base font-bold">الصوت مفعّل</span>
            </div>
            <div className="text-center lg:text-left">
              <p className="text-5xl font-black tabular-nums leading-none lg:text-6xl">
                {currentTime}
              </p>
              <p className="mt-1 text-sm font-medium text-white/75 lg:text-base">
                {currentDate}
              </p>
            </div>
            <button
              type="button"
              onClick={onTestSound}
              className="hidden rounded-xl border border-white/25 bg-white/10 px-3 py-2 text-xs text-white/80 hover:bg-white/20 xl:block"
            >
              اختبار الصوت
            </button>
          </div>
        </div>
      </div>

      <div className="relative z-10 flex flex-1 flex-col gap-5 p-5 lg:flex-row lg:gap-6 lg:p-6">
        <section className="flex min-h-0 flex-1 flex-col gap-4">
          <h2 className="text-center text-2xl font-black text-slate-800 lg:text-3xl">
            المراجع المطلوب الآن
          </h2>

          {called.length === 0 ? (
            <div className="qs-glass qs-icon-float flex flex-1 flex-col items-center justify-center rounded-[2rem] px-8 py-16 text-center">
              <div className="mb-6 flex h-24 w-24 items-center justify-center rounded-full bg-gradient-to-br from-cyan-100 to-teal-100">
                <Clock className="h-12 w-12 text-cyan-600" />
              </div>
              <p className="text-3xl font-bold text-slate-600">لا يوجد نداء حالياً</p>
              <p className="mt-3 max-w-lg text-lg leading-relaxed text-slate-500">
                سيظهر <strong className="text-teal-700">اسم المراجع</strong> و{" "}
                <strong className="text-teal-700">رقم الدور</strong> هنا بحجم كبير
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

        <aside className="flex w-full flex-col lg:w-[min(32vw,28rem)]">
          <div className="qs-glass h-full rounded-[2rem] p-5 lg:p-6">
            <div className="mb-5 flex items-center justify-between border-b border-sky-100 pb-4">
              <div>
                <h2 className="text-2xl font-black text-slate-800">قائمة الانتظار</h2>
                <p className="text-sm font-medium text-slate-500">المراجعون التاليون</p>
              </div>
              {waiting.length > 0 && (
                <span className="flex h-12 min-w-[3rem] items-center justify-center rounded-2xl bg-gradient-to-br from-amber-400 to-orange-500 px-3 text-2xl font-black text-white shadow-md shadow-amber-400/30">
                  {waiting.length}
                </span>
              )}
            </div>

            <div className="flex max-h-[min(58vh,560px)] flex-col gap-3 overflow-y-auto pr-1">
              {waiting.length === 0 ? (
                <div className="rounded-2xl border-2 border-dashed border-sky-200 bg-sky-50/50 py-16 text-center">
                  <p className="text-lg font-medium text-slate-500">لا يوجد أحد في الانتظار</p>
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
                          ? "border-amber-300 bg-gradient-to-l from-amber-50 to-orange-50 shadow-sm"
                          : "border-sky-100 bg-white"
                      )}
                    >
                      <span
                        className={cn(
                          "flex h-14 w-14 shrink-0 items-center justify-center rounded-xl text-2xl font-black tabular-nums",
                          isNext
                            ? "bg-gradient-to-br from-amber-400 to-orange-500 text-white shadow-sm"
                            : "bg-sky-100 text-cyan-700"
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
                        <p className="mt-1 text-base font-medium text-slate-500">
                          {entry.doctor?.full_name_ar}
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
                <p className="py-2 text-center text-sm font-medium text-slate-400">
                  +{waiting.length - 10} في الانتظار
                </p>
              )}
            </div>
          </div>

          {screenUrl && (
            <button
              type="button"
              onClick={() => void navigator.clipboard?.writeText(screenUrl)}
              className="mt-2 flex items-center justify-center gap-2 py-2 text-[10px] text-slate-400 hover:text-teal-600"
            >
              <Copy className="h-3 w-3" />
              نسخ رابط الشاشة
            </button>
          )}
        </aside>
      </div>

      <footer className="qs-glass relative z-10 border-t border-sky-100 px-6 py-4 text-center">
        <p className="text-xl font-bold text-teal-800">{clinicName}</p>
        <p className="mt-1 text-sm text-slate-500">
          Master Clinic Plus
          {installedApp ? " · مثبّتة على هذا الجهاز" : ""}
        </p>
      </footer>
    </div>
  );
}
