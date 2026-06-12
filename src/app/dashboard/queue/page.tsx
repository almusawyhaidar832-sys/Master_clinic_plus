"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { translateDbError } from "@/lib/db-errors";
import { cn } from "@/lib/utils";
import { Alert } from "@/components/ui/Alert";
import { authPortalHeaders } from "@/lib/auth/api-portal";
import { broadcastPatientSentToDoctor, broadcastQueueScreenCall } from "@/lib/queue/broadcast";
import { notifyQueueRefresh } from "@/lib/queue/queue-refresh";
import { useQueueListRefresh } from "@/hooks/useQueueListRefresh";
import { announcePatientCall } from "@/lib/queue/realtime-client";
import {
  resolveDoctorSpeechName,
  resolvePatientSpeechName,
} from "@/lib/queue/utils";
import { QueueRealtimeBridge } from "@/components/queue/QueueRealtimeBridge";
import { TodayAppointmentsPanel } from "@/components/operations/TodayAppointmentsPanel";
import { InProgressOverridePanel } from "@/components/queue/InProgressOverridePanel";
import { resolveAppointmentPaymentUrl } from "@/lib/ledger/open-appointment-payment";
import { PatientSearchField } from "@/components/patients/PatientSearchField";
import { getPatientDisplayPhone } from "@/lib/phone";
import type { PatientSearchResult } from "@/lib/services/patient-search";
import {
  Users, Clock, CheckCircle2, UserCheck, Plus, Volume2,
  RefreshCw, Monitor, Phone, X, ChevronRight, Send, RotateCcw, Receipt, LogOut,
  ArrowRightLeft,
} from "lucide-react";

type QueueStatus =
  | "waiting"
  | "called"
  | "in_progress"
  | "ready_for_billing"
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
  called_at: string | null;
  entered_at: string | null;
  sent_to_doctor_at: string | null;
  appointment_id: string | null;
  transfer_to_doctor_id: string | null;
  transfer_requested_at: string | null;
  doctor: { full_name_ar: string } | null;
  transfer_to_doctor?: { full_name_ar: string } | null;
  patient: { full_name_ar: string; speech_name_ar?: string | null } | null;
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
  ready_for_billing: number;
  ready_for_payment: number;
  done: number;
  total: number;
}

const STATUS_CONFIG: Record<QueueStatus, { label: string; color: string; bg: string; border: string }> = {
  waiting:     { label: "انتظار",        color: "text-amber-600",  bg: "bg-amber-50",   border: "border-amber-200" },
  called:      { label: "تم النداء",     color: "text-blue-600",   bg: "bg-blue-50",    border: "border-blue-200"  },
  in_progress: { label: "داخل الكشف",   color: "text-emerald-600",bg: "bg-emerald-50", border: "border-emerald-200"},
  ready_for_billing: { label: "عند المحاسب", color: "text-violet-600", bg: "bg-violet-50", border: "border-violet-200" },
  ready_for_payment: { label: "جاهز للدفع", color: "text-violet-600", bg: "bg-violet-50", border: "border-violet-200" },
  done:        { label: "منتهية",        color: "text-slate-500",  bg: "bg-slate-50",   border: "border-slate-200" },
  cancelled:   { label: "ألغى",         color: "text-red-500",    bg: "bg-red-50",     border: "border-red-200"   },
};

const NEXT_STATUS: Partial<Record<QueueStatus, QueueStatus>> = {
  waiting: "called",
  called: "in_progress",
};

const NEXT_LABEL: Partial<Record<QueueStatus, string>> = {
  waiting: "نداء →",
  called: "دخول →",
};

function AddToQueueModal({
  doctors,
  onClose,
  onAdd,
}: {
  doctors: Doctor[];
  onClose: () => void;
  onAdd: (data: {
    doctor_id: string;
    patient_name: string;
    patient_phone: string;
    patient_id?: string | null;
    send_to_doctor: boolean;
  }) => void;
}) {
  const [doctorId, setDoctorId] = useState(doctors[0]?.id ?? "");
  const [name, setName]   = useState("");
  const [phone, setPhone] = useState("");
  const [selectedPatientId, setSelectedPatientId] = useState<string | null>(null);
  const [sendNow, setSendNow] = useState(true);

  const handlePatientSelect = (patient: PatientSearchResult) => {
    setSelectedPatientId(patient.id);
    setName(patient.full_name_ar);
    setPhone(getPatientDisplayPhone(patient) ?? "");
  };

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
            <PatientSearchField
              portal="accountant"
              value={name}
              selectedPatientId={selectedPatientId}
              onChange={(value) => {
                setName(value);
                setSelectedPatientId(null);
              }}
              onSelect={handlePatientSelect}
              placeholder="ابحث بالاسم أو أدخل مراجع جديداً"
              inputClassName="w-full rounded-xl border border-slate-200 bg-slate-50 py-2.5 pr-10 pl-4 text-sm focus:border-primary focus:outline-none"
            />
            {selectedPatientId && (
              <p className="mt-1 text-xs text-emerald-600">مربوط بملف مريض موجود</p>
            )}
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
          <label className="flex cursor-pointer items-center gap-2 text-sm text-slate-600">
            <input
              type="checkbox"
              checked={sendNow}
              onChange={(e) => setSendNow(e.target.checked)}
              className="h-4 w-4 rounded border-slate-300 text-primary"
            />
            إرسال إشعار فوري للطبيب
          </label>
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
              onAdd({
                doctor_id: doctorId,
                patient_name: name,
                patient_phone: phone,
                patient_id: selectedPatientId,
                send_to_doctor: sendNow,
              });
            }}
            className="flex-1 rounded-xl bg-primary py-2.5 text-sm font-bold text-white hover:bg-primary/90"
          >
            {sendNow ? "إضافة وإرسال للطبيب" : "إضافة للطابور"}
          </button>
        </div>
      </div>
    </div>
  );
}

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

async function apiJson<T>(url: string, init?: RequestInit): Promise<T> {
  let res: Response;
  try {
    res = await fetch(url, {
      ...init,
      credentials: "include",
      headers: {
        "Content-Type": "application/json",
        ...authPortalHeaders("accountant"),
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

export default function QueuePage() {
  const router = useRouter();
  const supabase = createClient();
  const [clinicId, setClinicId] = useState<string | null>(null);
  const [queue, setQueue]     = useState<QueueEntry[]>([]);
  const [doctors, setDoctors] = useState<Doctor[]>([]);
  const [stats, setStats]     = useState<QueueStats>({
    waiting: 0,
    called: 0,
    in_progress: 0,
    ready_for_billing: 0,
    ready_for_payment: 0,
    done: 0,
    total: 0,
  });
  const [loading, setLoading] = useState(true);
  const [pageError, setPageError] = useState<string | null>(null);
  const [showAdd, setShowAdd] = useState(false);
  const [updating, setUpdating] = useState<string | null>(null);
  const [filterDoctor, setFilterDoctor] = useState<string>("all");

  const fetchQueue = useCallback(async () => {
    setPageError(null);
    try {
      const data = await apiJson<{
        queue: QueueEntry[];
        doctors: Doctor[];
        clinicId: string;
      }>("/api/queue");

      setClinicId(data.clinicId);
      const rows = data.queue ?? [];
      setQueue(rows);
      setDoctors(data.doctors ?? []);

      setStats({
        waiting:     rows.filter((r) => r.status === "waiting").length,
        called:      rows.filter((r) => r.status === "called").length,
        in_progress: rows.filter((r) => r.status === "in_progress").length,
        ready_for_billing: rows.filter((r) => r.status === "ready_for_billing").length,
        ready_for_payment: rows.filter((r) => r.status === "ready_for_payment").length,
        done:        rows.filter((r) => r.status === "done").length,
        total:       rows.length,
      });
    } catch (err) {
      setPageError(err instanceof Error ? err.message : "تعذر تحميل الطابور");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchQueue();
  }, [fetchQueue]);

  useQueueListRefresh("clinic", clinicId, fetchQueue);

  const advanceStatus = async (entry: QueueEntry) => {
    setUpdating(entry.id);
    try {
      const data = await apiJson<{ status: QueueStatus }>(`/api/queue/${entry.id}`, {
        method: "PATCH",
        body: JSON.stringify({ action: "advance" }),
      });

      const name = resolvePatientSpeechName(entry);
      const doctorName = resolveDoctorSpeechName(entry.doctor);
      if (data.status === "called") {
        if (clinicId) {
          void broadcastQueueScreenCall(supabase, clinicId, {
            name,
            doctorName,
            entryId: entry.id,
          });
        }
      } else if (data.status === "in_progress") {
        announcePatientCall(name, doctorName, "enter");
        if (clinicId) {
          notifyQueueRefresh({ scope: "clinic", clinicId });
          notifyQueueRefresh({ scope: "doctor", doctorId: entry.doctor_id });
        }
      }
      await fetchQueue();
    } catch (err) {
      setPageError(err instanceof Error ? err.message : "تعذر تحديث الدور");
    } finally {
      setUpdating(null);
    }
  };

  const openPayment = async (entry: QueueEntry) => {
    if (!clinicId) return;
    setUpdating(entry.id);
    try {
      if (entry.status === "ready_for_billing") {
        await apiJson(`/api/queue/${entry.id}`, {
          method: "PATCH",
          body: JSON.stringify({ action: "ready_for_payment" }),
        });
      }

      const href = await resolveAppointmentPaymentUrl({
        clinicId,
        appointmentId: entry.appointment_id,
        queueEntryId: entry.id,
        patientId: entry.patient_id,
        doctorId: entry.doctor_id,
        patientPhone: entry.patient_phone,
        patientNameAr: entry.patient_name,
      });
      router.push(href);
    } catch (err) {
      setPageError(err instanceof Error ? err.message : "تعذر فتح إدخال الجلسة");
    } finally {
      setUpdating(null);
    }
  };

  const finishExamination = async (entry: QueueEntry, openLedger = false) => {
    setUpdating(entry.id);
    try {
      const result = await apiJson<{ ledger_url?: string }>(`/api/queue/${entry.id}`, {
        method: "PATCH",
        body: JSON.stringify({ action: "ready_for_payment" }),
      });
      if (clinicId) {
        notifyQueueRefresh({ scope: "clinic", clinicId });
        notifyQueueRefresh({ scope: "doctor", doctorId: entry.doctor_id });
      }
      if (openLedger && result.ledger_url) {
        router.push(result.ledger_url);
        return;
      }
      await fetchQueue();
    } catch (err) {
      setPageError(err instanceof Error ? err.message : "تعذر إنهاء الكشف");
    } finally {
      setUpdating(null);
    }
  };

  const sendToDoctor = async (entry: QueueEntry) => {
    setUpdating(entry.id);
    try {
      await apiJson("/api/queue", {
        method: "POST",
        body: JSON.stringify({ action: "send_to_doctor", queue_entry_id: entry.id }),
      });
      const name =
        entry.patient?.full_name_ar ?? entry.patient_name ?? `رقم ${entry.ticket_number}`;
      void broadcastPatientSentToDoctor(supabase, entry.doctor_id, {
        name,
        entryId: entry.id,
      });
      notifyQueueRefresh({ scope: "doctor", doctorId: entry.doctor_id });
      await fetchQueue();
    } catch (err) {
      setPageError(err instanceof Error ? err.message : "تعذر الإرسال للطبيب");
    } finally {
      setUpdating(null);
    }
  };

  const recallPatient = async (entry: QueueEntry) => {
    setUpdating(entry.id);
    const name = resolvePatientSpeechName(entry);
    const doctorName = resolveDoctorSpeechName(entry.doctor);

    try {
      if (entry.status === "called" || entry.status === "in_progress") {
        await apiJson("/api/queue/screen/call", {
          method: "POST",
          body: JSON.stringify({ entry_id: entry.id }),
        });
        if (clinicId) {
          void broadcastQueueScreenCall(supabase, clinicId, {
            name,
            doctorName,
            entryId: entry.id,
          });
        }
        return;
      }

      if (entry.status === "waiting" && entry.sent_to_doctor_at) {
        await apiJson("/api/queue", {
          method: "POST",
          body: JSON.stringify({ action: "recall", queue_entry_id: entry.id }),
        });
        void broadcastPatientSentToDoctor(supabase, entry.doctor_id, {
          name,
          entryId: entry.id,
        });
        notifyQueueRefresh({ scope: "doctor", doctorId: entry.doctor_id });
      }
    } catch (err) {
      setPageError(err instanceof Error ? err.message : "تعذر إعادة النداء");
    } finally {
      setUpdating(null);
    }
  };

  const cancelEntry = async (id: string) => {
    try {
      await apiJson(`/api/queue/${id}`, {
        method: "PATCH",
        body: JSON.stringify({ action: "cancel" }),
      });
      await fetchQueue();
    } catch (err) {
      setPageError(err instanceof Error ? err.message : "تعذر الإلغاء");
    }
  };

  const confirmTransfer = async (entry: QueueEntry) => {
    const target = entry.transfer_to_doctor?.full_name_ar ?? "الطبيب الجديد";
    const patient =
      entry.patient?.full_name_ar ?? entry.patient_name ?? `رقم ${entry.ticket_number}`;
    if (!confirm(`تأكيد تحويل «${patient}» إلى ${target}؟`)) return;

    setUpdating(entry.id);
    try {
      await apiJson(`/api/queue/${entry.id}`, {
        method: "PATCH",
        body: JSON.stringify({ action: "confirm_transfer" }),
      });
      const targetDoctorId = entry.transfer_to_doctor_id;
      if (targetDoctorId) {
        notifyQueueRefresh({ scope: "doctor", doctorId: targetDoctorId });
        void broadcastPatientSentToDoctor(supabase, targetDoctorId, {
          name: patient,
          entryId: entry.id,
        });
      }
      if (clinicId) {
        notifyQueueRefresh({ scope: "clinic", clinicId });
        notifyQueueRefresh({ scope: "doctor", doctorId: entry.doctor_id });
      }
      await fetchQueue();
    } catch (err) {
      setPageError(err instanceof Error ? err.message : "تعذر تأكيد التحويل");
    } finally {
      setUpdating(null);
    }
  };

  const dismissTransfer = async (entry: QueueEntry) => {
    setUpdating(entry.id);
    try {
      await apiJson(`/api/queue/${entry.id}`, {
        method: "PATCH",
        body: JSON.stringify({ action: "dismiss_transfer" }),
      });
      if (clinicId) {
        notifyQueueRefresh({ scope: "clinic", clinicId });
        notifyQueueRefresh({ scope: "doctor", doctorId: entry.doctor_id });
      }
      await fetchQueue();
    } catch (err) {
      setPageError(err instanceof Error ? err.message : "تعذر إلغاء طلب التحويل");
    } finally {
      setUpdating(null);
    }
  };

  const addToQueue = async (data: {
    doctor_id: string;
    patient_name: string;
    patient_phone: string;
    patient_id?: string | null;
    send_to_doctor: boolean;
  }) => {
    try {
      const result = await apiJson<{ id: string; doctor_id?: string }>("/api/queue", {
        method: "POST",
        body: JSON.stringify({
          doctor_id: data.doctor_id,
          patient_name: data.patient_name,
          patient_phone: data.patient_phone,
          patient_id: data.patient_id ?? undefined,
          send_to_doctor: data.send_to_doctor !== false,
        }),
      });
      const targetDoctorId = result.doctor_id ?? data.doctor_id;
      const name = data.patient_name.trim() || "مراجع";
      void broadcastPatientSentToDoctor(supabase, targetDoctorId, {
        name,
        entryId: result.id,
      });
      notifyQueueRefresh({ scope: "doctor", doctorId: targetDoctorId });
      notifyQueueRefresh({ scope: "clinic", clinicId: clinicId ?? undefined });
      setShowAdd(false);
      await fetchQueue();
    } catch (err) {
      setPageError(err instanceof Error ? err.message : "تعذر الإضافة");
    }
  };

  const filtered = filterDoctor === "all"
    ? queue
    : queue.filter((e) => e.doctor_id === filterDoctor);

  const activeEntries = filtered.filter((e) => e.status !== "done");
  const doneEntries   = filtered.filter((e) => e.status === "done");
  const inProgressEntries = filtered.filter((e) => e.status === "in_progress");

  if (loading) {
    return (
      <div className="flex min-h-[60vh] items-center justify-center">
        <div className="h-8 w-8 animate-spin rounded-full border-4 border-primary/20 border-t-primary" />
      </div>
    );
  }

  if (!clinicId && pageError) {
    return (
      <Alert variant="error">
        {pageError}
        <p className="mt-2 text-sm">تأكد من تسجيل الدخول كمحاسب وأن جدول patient_queue موجود في Supabase.</p>
      </Alert>
    );
  }

  return (
    <>
      <QueueRealtimeBridge portal="dashboard" />
    <div className="mx-auto max-w-6xl space-y-6">

      {pageError && (
        <Alert variant="error">{pageError}</Alert>
      )}

      <TodayAppointmentsPanel title="حجوزات اليوم" compact onApprovedToQueue={fetchQueue} />

      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-slate-800">غرفة الانتظار</h1>
          <p className="text-sm text-slate-500">
            {new Date().toLocaleDateString("ar-IQ", { weekday: "long", year: "numeric", month: "long", day: "numeric" })}
          </p>
        </div>
        <div className="flex gap-2">
          <a
            href={clinicId ? `/queue-screen?clinic=${clinicId}` : "/queue-screen"}
            target="_blank"
            rel="noopener noreferrer"
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

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
        <StatCard label="في الانتظار"   value={stats.waiting}     icon={Clock}        color="bg-amber-100 text-amber-600"   />
        <StatCard label="تم النداء"      value={stats.called}      icon={Volume2}      color="bg-blue-100 text-blue-600"     />
        <StatCard label="داخل الكشف"    value={stats.in_progress} icon={UserCheck}    color="bg-emerald-100 text-emerald-600"/>
        <StatCard label="عند المحاسب"   value={stats.ready_for_billing} icon={Receipt} color="bg-violet-100 text-violet-600"/>
        <StatCard label="جاهز للدفع"    value={stats.ready_for_payment} icon={Receipt} color="bg-violet-100 text-violet-600"/>
        <StatCard label="منتهية اليوم"  value={stats.done}        icon={CheckCircle2} color="bg-slate-100 text-slate-600"   />
      </div>

      <div className="flex flex-col gap-6 lg:flex-row lg:items-start">
        <div className="w-full shrink-0 lg:sticky lg:top-4 lg:w-72">
          <InProgressOverridePanel
            entries={inProgressEntries}
            updatingId={updating}
            onOverride={(entry) => void finishExamination(entry as QueueEntry, true)}
          />
        </div>

        <div className="min-w-0 flex-1 space-y-6">

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
            const canCheckout =
              entry.status === "ready_for_billing" ||
              entry.status === "ready_for_payment";
            const transferPending = Boolean(entry.transfer_to_doctor_id);
            const canSend =
              entry.status === "waiting" &&
              !entry.sent_to_doctor_at &&
              !transferPending;
            const canRecall =
              entry.status === "called" ||
              entry.status === "in_progress" ||
              (entry.status === "waiting" && !!entry.sent_to_doctor_at);

            return (
              <div
                key={entry.id}
                className={cn(
                  "flex items-center gap-4 rounded-2xl border bg-white p-4 shadow-sm transition-all",
                  transferPending ? "border-violet-300 ring-1 ring-violet-200" : cfg.border
                )}
              >
                <div className={cn(
                  "flex h-12 w-12 flex-shrink-0 items-center justify-center rounded-xl text-xl font-black",
                  cfg.bg, cfg.color
                )}>
                  {entry.ticket_number}
                </div>

                <div className="min-w-0 flex-1">
                  <p className="truncate font-semibold text-slate-800">{patientDisplay}</p>
                  <div className="flex flex-wrap items-center gap-3 text-xs text-slate-500">
                    <span className={cn("font-medium", cfg.color)}>{cfg.label}</span>
                    {entry.sent_to_doctor_at && (
                      <>
                        <span>•</span>
                        <span className="text-emerald-600">أُرسل للطبيب</span>
                      </>
                    )}
                    {transferPending && (
                      <>
                        <span>•</span>
                        <span className="font-medium text-violet-700">
                          طلب تحويل إلى {entry.transfer_to_doctor?.full_name_ar ?? "—"}
                        </span>
                      </>
                    )}
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

                <div className="flex flex-wrap items-center justify-end gap-2">
                  {transferPending && (
                    <>
                      <button
                        onClick={() => void confirmTransfer(entry)}
                        disabled={updating === entry.id}
                        className="flex items-center gap-1.5 rounded-xl bg-violet-600 px-3 py-2 text-sm font-bold text-white hover:bg-violet-700 disabled:opacity-60"
                      >
                        {updating === entry.id ? (
                          <RefreshCw className="h-3.5 w-3.5 animate-spin" />
                        ) : (
                          <ArrowRightLeft className="h-3.5 w-3.5" />
                        )}
                        <span className="hidden sm:inline">تأكيد التحويل</span>
                      </button>
                      <button
                        onClick={() => void dismissTransfer(entry)}
                        disabled={updating === entry.id}
                        className="rounded-xl border border-slate-200 px-3 py-2 text-sm font-medium text-slate-600 hover:bg-slate-50 disabled:opacity-60"
                      >
                        رفض التحويل
                      </button>
                    </>
                  )}
                  {canRecall && (
                    <button
                      onClick={() => recallPatient(entry)}
                      disabled={updating === entry.id}
                      className="flex items-center gap-1.5 rounded-xl border border-blue-200 bg-blue-50 px-3 py-2 text-sm font-bold text-blue-700 hover:bg-blue-100 disabled:opacity-60"
                      title="إعادة النداء"
                    >
                      {updating === entry.id
                        ? <RefreshCw className="h-3.5 w-3.5 animate-spin" />
                        : <RotateCcw className="h-3.5 w-3.5" />
                      }
                      <span className="hidden sm:inline">إعادة النداء</span>
                    </button>
                  )}
                  {canSend && (
                    <button
                      onClick={() => sendToDoctor(entry)}
                      disabled={updating === entry.id}
                      className="flex items-center gap-1.5 rounded-xl bg-violet-600 px-3 py-2 text-sm font-bold text-white hover:bg-violet-700 disabled:opacity-60"
                      title="إرسال إلى الطبيب"
                    >
                      {updating === entry.id
                        ? <RefreshCw className="h-3.5 w-3.5 animate-spin" />
                        : <Send className="h-3.5 w-3.5" />
                      }
                      <span className="hidden sm:inline">إرسال للطبيب</span>
                    </button>
                  )}
                  {entry.status === "in_progress" && (
                    <button
                      onClick={() => finishExamination(entry, true)}
                      disabled={updating === entry.id}
                      className="flex items-center gap-1.5 rounded-xl bg-violet-600 px-3 py-2 text-sm font-bold text-white hover:bg-violet-700 disabled:opacity-60"
                      title="إنهاء الجلسة وتحويل للمحاسبة"
                    >
                      {updating === entry.id
                        ? <RefreshCw className="h-3.5 w-3.5 animate-spin" />
                        : <LogOut className="h-3.5 w-3.5" />
                      }
                      <span className="hidden sm:inline">إنهاء وتحويل</span>
                    </button>
                  )}
                  {canCheckout && (
                    <button
                      onClick={() => openPayment(entry)}
                      disabled={updating === entry.id}
                      className="flex items-center gap-1.5 rounded-xl bg-violet-600 px-3 py-2 text-sm font-bold text-white hover:bg-violet-700 disabled:opacity-60"
                    >
                      {updating === entry.id ? (
                        <RefreshCw className="h-3.5 w-3.5 animate-spin" />
                      ) : (
                        <Receipt className="h-3.5 w-3.5" />
                      )}
                      <span className="hidden sm:inline">دفع</span>
                    </button>
                  )}
                  {nextAction && !transferPending && (
                    <button
                      onClick={() => advanceStatus(entry)}
                      disabled={updating === entry.id}
                      className={cn(
                        "flex items-center gap-1.5 rounded-xl px-3 py-2 text-sm font-bold transition-colors",
                        entry.status === "called"
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

        </div>
      </div>

      {showAdd && (
        <AddToQueueModal
          doctors={doctors}
          onClose={() => setShowAdd(false)}
          onAdd={addToQueue}
        />
      )}
    </div>
    </>
  );
}
