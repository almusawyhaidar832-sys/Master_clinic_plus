"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { cn } from "@/lib/utils";
import {
  Users, Clock, CheckCircle2, UserCheck, Plus, Volume2,
  RefreshCw, Monitor, Phone, X, ChevronRight,
} from "lucide-react";

// ─────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────
type QueueStatus = "waiting" | "called" | "in_progress" | "done" | "cancelled";

interface QueueEntry {
  id: string;
  ticket_number: number;
  status: QueueStatus;
  patient_name: string | null;
  patient_phone: string | null;
  patient_id: string | null;
  doctor_id: string;
  created_at: string;
  called_at: string | null;
  entered_at: string | null;
  doctor: { full_name_ar: string } | null;
  patient: { full_name_ar: string } | null;
}

interface Doctor {
  id: string;
  full_name_ar: string;
  specialty_ar: string | null;
}

interface QueueStats {
  waiting: number;
  called: number;
  in_progress: number;
  done: number;
  total: number;
}

const STATUS_CONFIG: Record<QueueStatus, { label: string; color: string; bg: string; border: string }> = {
  waiting:     { label: "انتظار",        color: "text-amber-600",  bg: "bg-amber-50",   border: "border-amber-200" },
  called:      { label: "تم النداء",     color: "text-blue-600",   bg: "bg-blue-50",    border: "border-blue-200"  },
  in_progress: { label: "داخل الكشف",   color: "text-emerald-600",bg: "bg-emerald-50", border: "border-emerald-200"},
  done:        { label: "منتهية",        color: "text-slate-500",  bg: "bg-slate-50",   border: "border-slate-200" },
  cancelled:   { label: "ألغى",         color: "text-red-500",    bg: "bg-red-50",     border: "border-red-200"   },
};

const NEXT_STATUS: Partial<Record<QueueStatus, QueueStatus>> = {
  waiting:     "called",
  called:      "in_progress",
  in_progress: "done",
};

const NEXT_LABEL: Partial<Record<QueueStatus, string>> = {
  waiting:     "نداء →",
  called:      "أدخل الكشف →",
  in_progress: "أنهِ الكشف ✓",
};

// ─────────────────────────────────────────────
// Voice announcement
// ─────────────────────────────────────────────
function announce(text: string) {
  if (typeof window === "undefined" || !("speechSynthesis" in window)) return;
  window.speechSynthesis.cancel();
  const utt = new SpeechSynthesisUtterance(text);
  utt.lang = "ar-SA";
  utt.rate = 0.9;
  window.speechSynthesis.speak(utt);
}

// ─────────────────────────────────────────────
// Add to Queue modal
// ─────────────────────────────────────────────
function AddToQueueModal({
  doctors,
  onClose,
  onAdd,
}: {
  doctors: Doctor[];
  onClose: () => void;
  onAdd: (data: { doctor_id: string; patient_name: string; patient_phone: string }) => void;
}) {
  const [doctorId, setDoctorId] = useState(doctors[0]?.id ?? "");
  const [name, setName]   = useState("");
  const [phone, setPhone] = useState("");

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 sm:items-center">
      <div className="w-full max-w-md rounded-t-2xl bg-white p-6 shadow-2xl sm:rounded-2xl">
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-lg font-bold text-slate-800">إضافة مراجع للطابور</h2>
          <button onClick={onClose} className="rounded-lg p-1 hover:bg-slate-100">
            <X className="h-5 w-5 text-slate-500" />
          </button>
        </div>

        <div className="space-y-4">
          <div>
            <label className="mb-1 block text-sm font-medium text-slate-600">الطبيب</label>
            <select
              value={doctorId}
              onChange={(e) => setDoctorId(e.target.value)}
              className="w-full rounded-xl border border-slate-200 bg-slate-50 px-4 py-2.5 text-sm focus:border-primary focus:outline-none"
            >
              {doctors.map((d) => (
                <option key={d.id} value={d.id}>{d.full_name_ar}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="mb-1 block text-sm font-medium text-slate-600">اسم المراجع</label>
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="الاسم الكامل (اختياري)"
              className="w-full rounded-xl border border-slate-200 bg-slate-50 px-4 py-2.5 text-sm focus:border-primary focus:outline-none"
            />
          </div>
          <div>
            <label className="mb-1 block text-sm font-medium text-slate-600">رقم الهاتف</label>
            <input
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              placeholder="07xxxxxxxx"
              className="w-full rounded-xl border border-slate-200 bg-slate-50 px-4 py-2.5 text-sm focus:border-primary focus:outline-none"
            />
          </div>
        </div>

        <div className="mt-6 flex gap-3">
          <button
            onClick={onClose}
            className="flex-1 rounded-xl border border-slate-200 py-2.5 text-sm font-medium text-slate-600 hover:bg-slate-50"
          >
            إلغاء
          </button>
          <button
            onClick={() => {
              if (!doctorId) return;
              onAdd({ doctor_id: doctorId, patient_name: name, patient_phone: phone });
              onClose();
            }}
            className="flex-1 rounded-xl bg-primary py-2.5 text-sm font-bold text-white hover:bg-primary/90"
          >
            إضافة للطابور
          </button>
        </div>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────
// Stat Card
// ─────────────────────────────────────────────
function StatCard({ label, value, icon: Icon, color }: {
  label: string; value: number; icon: React.ComponentType<{ className?: string }>; color: string;
}) {
  return (
    <div className="flex items-center gap-3 rounded-2xl border border-slate-100 bg-white p-4 shadow-sm">
      <div className={cn("flex h-10 w-10 items-center justify-center rounded-xl", color)}>
        <Icon className="h-5 w-5" />
      </div>
      <div>
        <p className="text-2xl font-bold text-slate-800">{value}</p>
        <p className="text-xs text-slate-500">{label}</p>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────
// Main Page
// ─────────────────────────────────────────────
export default function QueuePage() {
  const supabase = createClient();
  const [queue, setQueue]     = useState<QueueEntry[]>([]);
  const [doctors, setDoctors] = useState<Doctor[]>([]);
  const [stats, setStats]     = useState<QueueStats>({ waiting: 0, called: 0, in_progress: 0, done: 0, total: 0 });
  const [loading, setLoading] = useState(true);
  const [showAdd, setShowAdd] = useState(false);
  const [updating, setUpdating] = useState<string | null>(null);
  const [filterDoctor, setFilterDoctor] = useState<string>("all");
  const channelRef = useRef<ReturnType<typeof supabase.channel> | null>(null);

  // ── fetch ──
  const fetchQueue = useCallback(async () => {
    const today = new Date().toISOString().split("T")[0];

    const [{ data: qData }, { data: dData }] = await Promise.all([
      supabase
        .from("patient_queue")
        .select(`
          id, ticket_number, status, patient_name, patient_phone,
          patient_id, doctor_id, created_at, called_at, entered_at,
          doctor:doctors(full_name_ar),
          patient:patients(full_name_ar)
        `)
        .eq("queue_date", today)
        .neq("status", "cancelled")
        .order("ticket_number", { ascending: true }),

      supabase
        .from("doctors")
        .select("id, full_name_ar, specialty_ar")
        .eq("is_active", true),
    ]);

    const rows = (qData ?? []) as unknown as QueueEntry[];
    setQueue(rows);
    setDoctors((dData ?? []) as Doctor[]);

    // compute stats
    setStats({
      waiting:     rows.filter((r) => r.status === "waiting").length,
      called:      rows.filter((r) => r.status === "called").length,
      in_progress: rows.filter((r) => r.status === "in_progress").length,
      done:        rows.filter((r) => r.status === "done").length,
      total:       rows.length,
    });

    setLoading(false);
  }, [supabase]);

  // ── realtime ──
  useEffect(() => {
    fetchQueue();

    const channel = supabase
      .channel("queue-realtime")
      .on("postgres_changes", {
        event: "*", schema: "public", table: "patient_queue",
      }, () => fetchQueue())
      .subscribe();

    channelRef.current = channel;
    return () => { supabase.removeChannel(channel); };
  }, [fetchQueue, supabase]);

  // ── advance status ──
  const advanceStatus = async (entry: QueueEntry) => {
    const next = NEXT_STATUS[entry.status];
    if (!next) return;
    setUpdating(entry.id);

    await supabase
      .from("patient_queue")
      .update({ status: next })
      .eq("id", entry.id);

    // Voice announcement
    const name = entry.patient?.full_name_ar ?? entry.patient_name ?? `رقم ${entry.ticket_number}`;
    const doctorName = entry.doctor?.full_name_ar ?? "";
    if (next === "called") {
      announce(`${name}، يرجى التوجه إلى عيادة ${doctorName}`);
    } else if (next === "in_progress") {
      announce(`${name}، تفضل بالدخول إلى عيادة ${doctorName}`);
    }

    setUpdating(null);
    fetchQueue();
  };

  // ── cancel ──
  const cancelEntry = async (id: string) => {
    await supabase
      .from("patient_queue")
      .update({ status: "cancelled" })
      .eq("id", id);
    fetchQueue();
  };

  // ── add to queue ──
  const addToQueue = async (data: { doctor_id: string; patient_name: string; patient_phone: string }) => {
    await supabase.from("patient_queue").insert({
      doctor_id:    data.doctor_id,
      patient_name: data.patient_name || null,
      patient_phone: data.patient_phone || null,
      queue_date:   new Date().toISOString().split("T")[0],
      status:       "waiting",
      source:       "walk_in",
    });
    fetchQueue();
  };

  const filtered = filterDoctor === "all"
    ? queue
    : queue.filter((e) => e.doctor_id === filterDoctor);

  const activeEntries = filtered.filter((e) => e.status !== "done");
  const doneEntries   = filtered.filter((e) => e.status === "done");

  if (loading) {
    return (
      <div className="flex min-h-[60vh] items-center justify-center">
        <div className="h-8 w-8 animate-spin rounded-full border-4 border-primary/20 border-t-primary" />
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-5xl space-y-6">

      {/* ── Header ── */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-slate-800">غرفة الانتظار</h1>
          <p className="text-sm text-slate-500">
            {new Date().toLocaleDateString("ar-IQ", { weekday: "long", year: "numeric", month: "long", day: "numeric" })}
          </p>
        </div>
        <div className="flex gap-2">
          <a
            href="/queue-screen"
            target="_blank"
            className="flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-4 py-2 text-sm font-medium text-slate-600 shadow-sm hover:bg-slate-50"
          >
            <Monitor className="h-4 w-4" />
            شاشة المرضى
          </a>
          <button
            onClick={() => fetchQueue()}
            className="flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-4 py-2 text-sm font-medium text-slate-600 shadow-sm hover:bg-slate-50"
          >
            <RefreshCw className="h-4 w-4" />
            تحديث
          </button>
          <button
            onClick={() => setShowAdd(true)}
            className="flex items-center gap-2 rounded-xl bg-primary px-4 py-2 text-sm font-bold text-white shadow-sm hover:bg-primary/90"
          >
            <Plus className="h-4 w-4" />
            مراجع جديد
          </button>
        </div>
      </div>

      {/* ── Stats ── */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <StatCard label="في الانتظار"   value={stats.waiting}     icon={Clock}        color="bg-amber-100 text-amber-600"   />
        <StatCard label="تم النداء"      value={stats.called}      icon={Volume2}      color="bg-blue-100 text-blue-600"     />
        <StatCard label="داخل الكشف"    value={stats.in_progress} icon={UserCheck}    color="bg-emerald-100 text-emerald-600"/>
        <StatCard label="منتهية اليوم"  value={stats.done}        icon={CheckCircle2} color="bg-slate-100 text-slate-600"   />
      </div>

      {/* ── Doctor filter ── */}
      {doctors.length > 1 && (
        <div className="flex flex-wrap gap-2">
          <button
            onClick={() => setFilterDoctor("all")}
            className={cn(
              "rounded-full px-4 py-1.5 text-sm font-medium transition-colors",
              filterDoctor === "all"
                ? "bg-primary text-white"
                : "bg-white border border-slate-200 text-slate-600 hover:bg-slate-50"
            )}
          >
            الكل
          </button>
          {doctors.map((d) => (
            <button
              key={d.id}
              onClick={() => setFilterDoctor(d.id)}
              className={cn(
                "rounded-full px-4 py-1.5 text-sm font-medium transition-colors",
                filterDoctor === d.id
                  ? "bg-primary text-white"
                  : "bg-white border border-slate-200 text-slate-600 hover:bg-slate-50"
              )}
            >
              {d.full_name_ar}
            </button>
          ))}
        </div>
      )}

      {/* ── Active queue ── */}
      <div className="space-y-3">
        {activeEntries.length === 0 ? (
          <div className="flex flex-col items-center justify-center rounded-2xl border border-dashed border-slate-200 bg-white py-16 text-center">
            <Users className="mb-3 h-10 w-10 text-slate-300" />
            <p className="font-medium text-slate-500">لا يوجد مراجعون في الطابور</p>
            <p className="text-sm text-slate-400">اضغط &quot;مراجع جديد&quot; لإضافة مريض</p>
          </div>
        ) : (
          activeEntries.map((entry) => {
            const cfg = STATUS_CONFIG[entry.status];
            const patientDisplay = entry.patient?.full_name_ar ?? entry.patient_name ?? "مراجع بدون اسم";
            const nextAction = NEXT_STATUS[entry.status];
            const nextLabel  = NEXT_LABEL[entry.status];

            return (
              <div
                key={entry.id}
                className={cn(
                  "flex items-center gap-4 rounded-2xl border bg-white p-4 shadow-sm transition-all",
                  cfg.border
                )}
              >
                {/* Ticket badge */}
                <div className={cn(
                  "flex h-12 w-12 flex-shrink-0 items-center justify-center rounded-xl text-xl font-black",
                  cfg.bg, cfg.color
                )}>
                  {entry.ticket_number}
                </div>

                {/* Info */}
                <div className="min-w-0 flex-1">
                  <p className="truncate font-semibold text-slate-800">{patientDisplay}</p>
                  <div className="flex items-center gap-3 text-xs text-slate-500">
                    <span className={cn("font-medium", cfg.color)}>{cfg.label}</span>
                    <span>•</span>
                    <span>{entry.doctor?.full_name_ar ?? "—"}</span>
                    {entry.patient_phone && (
                      <>
                        <span>•</span>
                        <a
                          href={`https://wa.me/${entry.patient_phone.replace(/\D/g, "")}`}
                          target="_blank"
                          className="flex items-center gap-0.5 text-green-600 hover:underline"
                        >
                          <Phone className="h-3 w-3" />
                          {entry.patient_phone}
                        </a>
                      </>
                    )}
                  </div>
                </div>

                {/* Actions */}
                <div className="flex items-center gap-2">
                  {nextAction && (
                    <button
                      onClick={() => advanceStatus(entry)}
                      disabled={updating === entry.id}
                      className={cn(
                        "flex items-center gap-1.5 rounded-xl px-3 py-2 text-sm font-bold transition-colors",
                        entry.status === "in_progress"
                          ? "bg-emerald-500 text-white hover:bg-emerald-600"
                          : entry.status === "called"
                          ? "bg-blue-500 text-white hover:bg-blue-600"
                          : "bg-amber-500 text-white hover:bg-amber-600",
                        updating === entry.id && "opacity-60"
                      )}
                    >
                      {updating === entry.id
                        ? <RefreshCw className="h-3.5 w-3.5 animate-spin" />
                        : <ChevronRight className="h-3.5 w-3.5" />
                      }
                      <span className="hidden sm:inline">{nextLabel}</span>
                    </button>
                  )}
                  <button
                    onClick={() => cancelEntry(entry.id)}
                    className="rounded-xl p-2 text-slate-400 hover:bg-red-50 hover:text-red-500"
                    title="إلغاء الدور"
                  >
                    <X className="h-4 w-4" />
                  </button>
                </div>
              </div>
            );
          })
        )}
      </div>

      {/* ── Done section ── */}
      {doneEntries.length > 0 && (
        <details className="group rounded-2xl border border-slate-100 bg-white">
          <summary className="flex cursor-pointer list-none items-center justify-between px-4 py-3 text-sm font-medium text-slate-500 hover:text-slate-700">
            <span>منتهية اليوم ({doneEntries.length})</span>
            <ChevronRight className="h-4 w-4 transition-transform group-open:rotate-90" />
          </summary>
          <div className="border-t border-slate-100 p-2 space-y-1">
            {doneEntries.map((entry) => (
              <div key={entry.id} className="flex items-center gap-3 rounded-xl px-3 py-2 text-sm text-slate-400">
                <span className="w-6 text-center font-bold">#{entry.ticket_number}</span>
                <span className="flex-1 truncate">
                  {entry.patient?.full_name_ar ?? entry.patient_name ?? "—"}
                </span>
                <span className="text-xs">{entry.doctor?.full_name_ar}</span>
                <CheckCircle2 className="h-4 w-4 text-emerald-400" />
              </div>
            ))}
          </div>
        </details>
      )}

      {/* ── Modal ── */}
      {showAdd && (
        <AddToQueueModal
          doctors={doctors}
          onClose={() => setShowAdd(false)}
          onAdd={addToQueue}
        />
      )}
    </div>
  );
}
