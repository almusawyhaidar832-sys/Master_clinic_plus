"use client";

/**
 * شاشة الانتظار العامة — تُعرض على التلفاز في صالة الانتظار
 * Public route — no auth required, auto-refreshes every 10s via Supabase realtime
 * URL: /queue-screen?clinic=<clinic_id>
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { cn } from "@/lib/utils";
import { Volume2, Clock, CheckCircle2 } from "lucide-react";

interface QueueEntry {
  id: string;
  ticket_number: number;
  status: "waiting" | "called" | "in_progress" | "done";
  patient_name: string | null;
  doctor: { full_name_ar: string } | null;
  patient: { full_name_ar: string } | null;
  called_at: string | null;
}

function announce(text: string) {
  if (typeof window === "undefined" || !("speechSynthesis" in window)) return;
  window.speechSynthesis.cancel();
  const utt = new SpeechSynthesisUtterance(text);
  utt.lang = "ar-SA";
  utt.rate = 0.85;
  utt.pitch = 1;
  window.speechSynthesis.speak(utt);
}

export default function QueueScreen() {
  const params = useSearchParams();
  const clinicId = params.get("clinic");
  const supabase = createClient();

  const [called, setCalled]     = useState<QueueEntry[]>([]);
  const [waiting, setWaiting]   = useState<QueueEntry[]>([]);
  const [clinicName, setClinicName] = useState("العيادة");
  const [currentTime, setCurrentTime] = useState("");
  const prevCalledRef = useRef<Set<string>>(new Set());

  // Clock
  useEffect(() => {
    const tick = () => {
      setCurrentTime(new Date().toLocaleTimeString("ar-IQ", {
        hour: "2-digit", minute: "2-digit", hour12: true,
      }));
    };
    tick();
    const t = setInterval(tick, 1000);
    return () => clearInterval(t);
  }, []);

  const fetchQueue = useCallback(async () => {
    if (!clinicId) return;

    const today = new Date().toISOString().split("T")[0];

    const { data } = await supabase
      .from("patient_queue")
      .select(`
        id, ticket_number, status, patient_name, called_at,
        doctor:doctors(full_name_ar),
        patient:patients(full_name_ar)
      `)
      .eq("queue_date", today)
      .in("status", ["waiting", "called", "in_progress"])
      .order("ticket_number", { ascending: true });

    const rows = (data ?? []) as unknown as QueueEntry[];

    const calledRows  = rows.filter((r) => r.status === "called" || r.status === "in_progress");
    const waitingRows = rows.filter((r) => r.status === "waiting");

    // Detect newly called entries → announce
    const newlyCalled = calledRows.filter((r) => !prevCalledRef.current.has(r.id));
    for (const entry of newlyCalled) {
      const name = entry.patient?.full_name_ar ?? entry.patient_name ?? `رقم ${entry.ticket_number}`;
      const doctor = entry.doctor?.full_name_ar ?? "";
      setTimeout(() => announce(`${name}، يرجى التوجه إلى عيادة ${doctor}`), 500);
    }
    prevCalledRef.current = new Set(calledRows.map((r) => r.id));

    setCalled(calledRows);
    setWaiting(waitingRows);
  }, [clinicId, supabase]);

  // Clinic name
  useEffect(() => {
    if (!clinicId) return;
    supabase.from("clinics").select("name_ar, name").eq("id", clinicId).single()
      .then(({ data }) => {
        if (data) setClinicName(data.name_ar || data.name || "العيادة");
      });
  }, [clinicId, supabase]);

  // Realtime + initial fetch
  useEffect(() => {
    fetchQueue();
    const channel = supabase
      .channel("queue-screen-rt")
      .on("postgres_changes", {
        event: "*", schema: "public", table: "patient_queue",
      }, fetchQueue)
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [fetchQueue, supabase]);

  if (!clinicId) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-slate-900 text-white">
        <p className="text-lg">أضف <code className="rounded bg-white/10 px-2 py-1">?clinic=CLINIC_ID</code> في الرابط</p>
      </div>
    );
  }

  return (
    <div className="flex min-h-screen flex-col bg-gradient-to-br from-slate-900 via-slate-800 to-slate-900 text-white">

      {/* ── Header ── */}
      <header className="flex items-center justify-between border-b border-white/10 px-8 py-4">
        <div>
          <h1 className="text-2xl font-black tracking-wide">{clinicName}</h1>
          <p className="text-sm text-white/50">نظام إدارة الطابور</p>
        </div>
        <div className="text-left">
          <p className="text-3xl font-black tabular-nums">{currentTime}</p>
          <p className="text-sm text-white/50">
            {new Date().toLocaleDateString("ar-IQ", { weekday: "long", year: "numeric", month: "long", day: "numeric" })}
          </p>
        </div>
      </header>

      <div className="flex flex-1 gap-6 p-8">

        {/* ── Called / In Progress ── */}
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
                const name = entry.patient?.full_name_ar ?? entry.patient_name ?? "—";
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
                      <div className={cn(
                        "flex h-16 w-16 items-center justify-center rounded-2xl text-3xl font-black",
                        isInProgress ? "bg-emerald-500/30 text-emerald-300" : "bg-primary/30 text-primary"
                      )}>
                        {entry.ticket_number}
                      </div>
                      <div className="flex-1">
                        <p className="text-2xl font-bold">{name}</p>
                        <p className={cn("text-sm", isInProgress ? "text-emerald-300" : "text-primary")}>
                          {isInProgress ? "داخل الكشف —" : "تفضل —"} {entry.doctor?.full_name_ar}
                        </p>
                      </div>
                      {isInProgress
                        ? <CheckCircle2 className="h-8 w-8 text-emerald-400" />
                        : <Volume2 className="h-8 w-8 text-primary animate-bounce" />
                      }
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* ── Waiting list ── */}
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
                const name = entry.patient?.full_name_ar ?? entry.patient_name ?? "مراجع";
                return (
                  <div
                    key={entry.id}
                    className={cn(
                      "flex items-center gap-3 rounded-xl border border-white/10 bg-white/5 px-4 py-3",
                      idx === 0 && "border-amber-400/30 bg-amber-400/10"
                    )}
                  >
                    <span className={cn(
                      "flex h-8 w-8 items-center justify-center rounded-lg text-sm font-bold",
                      idx === 0 ? "bg-amber-400/20 text-amber-300" : "bg-white/10 text-white/50"
                    )}>
                      {entry.ticket_number}
                    </span>
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium text-white/80">{name}</p>
                      <p className="truncate text-xs text-white/40">{entry.doctor?.full_name_ar}</p>
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
        </div>
      </div>

      {/* ── Footer ── */}
      <footer className="border-t border-white/10 px-8 py-3 text-center text-xs text-white/20">
        Master Clinic Plus — نظام إدارة العيادات الذكي
      </footer>
    </div>
  );
}
