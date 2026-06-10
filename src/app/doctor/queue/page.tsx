"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { buildDoctorPatientUrl } from "@/lib/queue/navigation";
import { createClient } from "@/lib/supabase/client";
import { translateDbError } from "@/lib/db-errors";
import { cn } from "@/lib/utils";
import { Alert } from "@/components/ui/Alert";
import { authPortalHeaders } from "@/lib/auth/api-portal";
import { broadcastAdmitRequest } from "@/lib/queue/broadcast";
import { notifyQueueRefresh } from "@/lib/queue/queue-refresh";
import { useQueueListRefresh } from "@/hooks/useQueueListRefresh";
import { useClinicProfile } from "@/contexts/ClinicProfileContext";
import { QueueRealtimeBridge } from "@/components/queue/QueueRealtimeBridge";
import {
  Clock, UserCheck, RefreshCw, LogIn, CheckCircle2, Users, RotateCcw,
} from "lucide-react";

type QueueStatus =
  | "waiting"
  | "called"
  | "in_progress"
  | "ready_for_payment"
  | "done"
  | "cancelled";

interface QueueEntry {
  id: string;
  ticket_number: number;
  status: QueueStatus;
  patient_name: string | null;
  patient_phone: string | null;
  patient_id: string | null;
  doctor_id: string;
  created_at: string;
  sent_to_doctor_at: string | null;
  patient: { full_name_ar: string } | null;
}

const STATUS_CONFIG: Record<QueueStatus, { label: string; color: string; bg: string }> = {
  waiting:     { label: "في الانتظار",  color: "text-amber-600",  bg: "bg-amber-50"   },
  called:      { label: "يُرجى الإدخال", color: "text-blue-600",   bg: "bg-blue-50"    },
  in_progress: { label: "داخل الكشف",    color: "text-emerald-600",bg: "bg-emerald-50" },
  ready_for_payment: { label: "جاهز للدفع", color: "text-violet-600", bg: "bg-violet-50" },
  done:        { label: "منتهية",        color: "text-slate-500",  bg: "bg-slate-50"   },
  cancelled:   { label: "ألغى",         color: "text-red-500",    bg: "bg-red-50"     },
};

async function apiJson<T>(url: string, init?: RequestInit): Promise<T> {
  let res: Response;
  try {
    res = await fetch(url, {
      ...init,
      credentials: "include",
      headers: {
        "Content-Type": "application/json",
        ...authPortalHeaders("doctor"),
        ...init?.headers,
      },
    });
  } catch {
    throw new Error("تعذر الاتصال بالسيرفر — تأكد أن التطبيق يعمل");
  }

  let data: T & { error?: string };
  try {
    data = (await res.json()) as T & { error?: string };
  } catch {
    throw new Error("استجابة غير متوقعة من السيرفر");
  }

  if (!res.ok) {
    throw new Error(translateDbError(data.error ?? "تعذر تنفيذ العملية"));
  }
  return data;
}

export default function DoctorQueuePage() {
  const router = useRouter();
  const supabase = createClient();
  const { profile } = useClinicProfile();
  const clinicId = profile?.id ?? null;
  const [queue, setQueue] = useState<QueueEntry[]>([]);
  const [doctorId, setDoctorId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [pageError, setPageError] = useState<string | null>(null);
  const [updating, setUpdating] = useState<string | null>(null);

  const fetchQueue = useCallback(async () => {
    setPageError(null);
    try {
      const data = await apiJson<{
        queue: QueueEntry[];
        doctorId: string | null;
      }>("/api/queue");

      setDoctorId(data.doctorId);
      setQueue(
        (data.queue ?? []).filter(
          (e) => e.status !== "done" && e.status !== "ready_for_payment"
        )
      );
    } catch (err) {
      setPageError(err instanceof Error ? err.message : "تعذر تحميل الطابور");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchQueue();
  }, [fetchQueue]);

  useQueueListRefresh("doctor", doctorId, fetchQueue);

  const admitPatient = async (entry: QueueEntry) => {
    setUpdating(entry.id);
    try {
      await apiJson("/api/queue", {
        method: "POST",
        body: JSON.stringify({ action: "admit", queue_entry_id: entry.id }),
      });
      const name =
        entry.patient?.full_name_ar ?? entry.patient_name ?? `رقم ${entry.ticket_number}`;
      if (clinicId) {
        void broadcastAdmitRequest(supabase, clinicId, {
          name,
          entryId: entry.id,
        });
        notifyQueueRefresh({ scope: "clinic", clinicId });
      }
      await fetchQueue();
    } catch (err) {
      setPageError(err instanceof Error ? err.message : "تعذر إرسال الطلب");
    } finally {
      setUpdating(null);
    }
  };

  const recallAdmit = async (entry: QueueEntry) => {
    setUpdating(entry.id);
    try {
      await apiJson("/api/queue", {
        method: "POST",
        body: JSON.stringify({ action: "recall", queue_entry_id: entry.id }),
      });
      const name =
        entry.patient?.full_name_ar ?? entry.patient_name ?? `رقم ${entry.ticket_number}`;
      if (clinicId) {
        void broadcastAdmitRequest(supabase, clinicId, {
          name,
          entryId: entry.id,
        });
        notifyQueueRefresh({ scope: "clinic", clinicId });
      }
    } catch (err) {
      setPageError(err instanceof Error ? err.message : "تعذر إعادة الطلب");
    } finally {
      setUpdating(null);
    }
  };

  const enterPatient = async (entry: QueueEntry) => {
    setUpdating(entry.id);
    try {
      await apiJson(`/api/queue/${entry.id}`, {
        method: "PATCH",
        body: JSON.stringify({ action: "enter" }),
      });
      if (entry.patient_id) {
        router.push(buildDoctorPatientUrl(entry.patient_id));
        return;
      }
      await fetchQueue();
    } catch (err) {
      setPageError(err instanceof Error ? err.message : "تعذر تحديث الحالة");
    } finally {
      setUpdating(null);
    }
  };

  const finishVisit = async (entryId: string) => {
    setUpdating(entryId);
    try {
      await apiJson(`/api/queue/${entryId}`, {
        method: "PATCH",
        body: JSON.stringify({ action: "ready_for_payment" }),
      });
      if (clinicId) {
        notifyQueueRefresh({ scope: "clinic", clinicId });
      }
      await fetchQueue();
    } catch (err) {
      setPageError(err instanceof Error ? err.message : "تعذر إنهاء الكشف");
    } finally {
      setUpdating(null);
    }
  };

  if (loading) {
    return (
      <div className="flex min-h-[50vh] items-center justify-center">
        <div className="h-8 w-8 animate-spin rounded-full border-4 border-primary/20 border-t-primary" />
      </div>
    );
  }

  const waiting = queue.filter((e) => e.status === "waiting" && e.sent_to_doctor_at);
  const active  = queue.filter((e) => e.status === "called" || e.status === "in_progress");

  return (
    <>
      <QueueRealtimeBridge portal="doctor" />
    <div className="space-y-4">
      <div>
        <h2 className="text-lg font-bold text-slate-800">قائمة انتظاري</h2>
        <p className="text-sm text-slate-500">
          تظهر هنا مراجعوك فقط — إشعار فوري عند إرسال محاسب مراجع جديد
        </p>
      </div>

      {pageError && <Alert variant="error">{pageError}</Alert>}

      <div className="grid grid-cols-2 gap-3">
        <div className="rounded-2xl border border-amber-100 bg-amber-50 p-4">
          <div className="flex items-center gap-2 text-amber-700">
            <Clock className="h-5 w-5" />
            <span className="text-sm font-medium">في الانتظار</span>
          </div>
          <p className="mt-1 text-2xl font-bold text-amber-800">{waiting.length}</p>
        </div>
        <div className="rounded-2xl border border-emerald-100 bg-emerald-50 p-4">
          <div className="flex items-center gap-2 text-emerald-700">
            <UserCheck className="h-5 w-5" />
            <span className="text-sm font-medium">نشط الآن</span>
          </div>
          <p className="mt-1 text-2xl font-bold text-emerald-800">{active.length}</p>
        </div>
      </div>

      {waiting.length === 0 && active.length === 0 ? (
        <div className="flex flex-col items-center rounded-2xl border border-dashed border-slate-200 bg-white py-12 text-center">
          <Users className="mb-2 h-10 w-10 text-slate-300" />
          <p className="font-medium text-slate-500">لا يوجد مراجعون في انتظارك</p>
        </div>
      ) : (
        <div className="space-y-3">
          {[...waiting, ...active].map((entry) => {
            const cfg = STATUS_CONFIG[entry.status];
            const name = entry.patient?.full_name_ar ?? entry.patient_name ?? `رقم ${entry.ticket_number}`;

            return (
              <div
                key={entry.id}
                className="rounded-2xl border border-slate-100 bg-white p-4 shadow-sm"
              >
                <div className="flex items-start gap-3">
                  <div className={cn(
                    "flex h-11 w-11 flex-shrink-0 items-center justify-center rounded-xl text-lg font-black",
                    cfg.bg, cfg.color
                  )}>
                    {entry.ticket_number}
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="font-bold text-slate-800">{name}</p>
                    <p className={cn("text-xs font-medium", cfg.color)}>{cfg.label}</p>
                  </div>
                </div>

                <div className="mt-3 flex gap-2">
                  {entry.status === "waiting" && (
                    <>
                      <button
                        onClick={() => admitPatient(entry)}
                        disabled={updating === entry.id}
                        className="flex flex-1 items-center justify-center gap-2 rounded-xl bg-primary py-2.5 text-sm font-bold text-white disabled:opacity-60"
                      >
                        {updating === entry.id
                          ? <RefreshCw className="h-4 w-4 animate-spin" />
                          : <LogIn className="h-4 w-4" />
                        }
                        ادخل المراجع
                      </button>
                      <button
                        onClick={() => recallAdmit(entry)}
                        disabled={updating === entry.id}
                        className="flex items-center justify-center gap-1.5 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2.5 text-sm font-bold text-amber-700 disabled:opacity-60"
                        title="إعادة إشعار المحاسب"
                      >
                        <RotateCcw className="h-4 w-4" />
                      </button>
                    </>
                  )}
                  {entry.status === "called" && (
                    <>
                      <button
                        onClick={() => enterPatient(entry)}
                        disabled={updating === entry.id}
                        className="flex flex-1 items-center justify-center gap-2 rounded-xl bg-blue-600 py-2.5 text-sm font-bold text-white disabled:opacity-60"
                      >
                        {updating === entry.id
                          ? <RefreshCw className="h-4 w-4 animate-spin" />
                          : <UserCheck className="h-4 w-4" />
                        }
                        بدء الكشف
                      </button>
                      <button
                        onClick={() => recallAdmit(entry)}
                        disabled={updating === entry.id}
                        className="flex items-center justify-center gap-1.5 rounded-xl border border-blue-200 bg-blue-50 px-3 py-2.5 text-sm font-bold text-blue-700 disabled:opacity-60"
                        title="إعادة طلب الإدخال"
                      >
                        <RotateCcw className="h-4 w-4" />
                      </button>
                    </>
                  )}
                  {entry.status === "in_progress" && (
                    <>
                      {entry.patient_id && (
                        <Link
                          href={buildDoctorPatientUrl(entry.patient_id)}
                          className="flex flex-1 items-center justify-center gap-2 rounded-xl border border-emerald-200 bg-emerald-50 py-2.5 text-sm font-bold text-emerald-800 hover:bg-emerald-100"
                        >
                          <LogIn className="h-4 w-4" />
                          ملف المريض
                        </Link>
                      )}
                      <button
                        onClick={() => finishVisit(entry.id)}
                        disabled={updating === entry.id}
                        className="flex flex-1 items-center justify-center gap-2 rounded-xl bg-emerald-600 py-2.5 text-sm font-bold text-white disabled:opacity-60"
                      >
                        {updating === entry.id
                          ? <RefreshCw className="h-4 w-4 animate-spin" />
                          : <CheckCircle2 className="h-4 w-4" />
                        }
                        إنهاء الجلسة
                      </button>
                    </>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
    </>
  );
}
