"use client";

import { useEffect, useState } from "react";
import { X, RefreshCw, Receipt, Stethoscope } from "lucide-react";
import { authPortalHeaders } from "@/lib/auth/api-portal";
import { notifyQueueRefresh } from "@/lib/queue/queue-refresh";
import { notifySessionMutation } from "@/lib/sync/mutation-notify";
import { notifyClinicProfitRefresh } from "@/lib/services/clinic-profit";
import { formatCurrency } from "@/lib/utils";
interface CheckoutProcedureLine {
  id: string;
  name: string;
  total_amount: number;
  paid_amount: number;
  remaining: number;
  session_kind: string | null;
}

interface CheckoutSummary {
  patientId: string;
  patientName: string;
  patientPhone: string | null;
  doctorId: string;
  doctorName: string;
  appointmentId: string | null;
  queueEntryId: string | null;
  procedures: CheckoutProcedureLine[];
  totalDue: number;
}

interface SessionCheckoutModalProps {
  appointmentId?: string | null;
  queueEntryId?: string | null;
  clinicId?: string | null;
  onClose: () => void;
  onPaid: () => void;
}

export function SessionCheckoutModal({
  appointmentId,
  queueEntryId,
  clinicId,
  onClose,
  onPaid,
}: SessionCheckoutModalProps) {
  const [summary, setSummary] = useState<CheckoutSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [paidAmount, setPaidAmount] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    let cancelled = false;

    async function load() {
      setLoading(true);
      setError("");
      try {
        const params = new URLSearchParams();
        if (appointmentId) params.set("appointment_id", appointmentId);
        if (queueEntryId) params.set("queue_entry_id", queueEntryId);

        let res: Response;
        try {
          res = await fetch(`/api/operations/checkout-summary?${params}`, {
            credentials: "include",
            headers: authPortalHeaders("accountant"),
          });
        } catch {
          throw new Error("تعذر الاتصال بالسيرفر — تأكد أن التطبيق يعمل");
        }
        const json = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(json.error ?? "تعذر تحميل الحساب");

        if (!cancelled) {
          const s = json.summary as CheckoutSummary;
          setSummary(s);
          setPaidAmount(s.totalDue > 0 ? String(s.totalDue) : "");
        }
      } catch (e) {
        if (!cancelled) {
          setError(e instanceof Error ? e.message : "تعذر تحميل الحساب");
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    void load();
    return () => {
      cancelled = true;
    };
  }, [appointmentId, queueEntryId]);

  async function handlePay(e: React.FormEvent) {
    e.preventDefault();
    if (!summary) return;

    const paid = Number(paidAmount || 0);
    if (summary.totalDue > 0 && (!Number.isFinite(paid) || paid <= 0)) {
      setError("أدخل مبلغ الدفع");
      return;
    }

    setSaving(true);
    setError("");
    try {
      const res = await fetch("/api/operations/checkout", {
        method: "POST",
        credentials: "include",
        headers: {
          "Content-Type": "application/json",
          ...authPortalHeaders("accountant"),
        },
        body: JSON.stringify({
          appointment_id: summary.appointmentId,
          queue_entry_id: summary.queueEntryId,
          paid_amount: paid,
        }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? "تعذر إتمام الدفع");

      if (clinicId) {
        notifySessionMutation({
          clinicId,
          doctorId: summary.doctorId,
          patientId: summary.patientId,
        });
        notifyClinicProfitRefresh(clinicId);
      }
      if (clinicId) {
        notifyQueueRefresh({ scope: "clinic", clinicId });
      }
      notifyQueueRefresh({ scope: "doctor", doctorId: summary.doctorId });

      onPaid();
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : "تعذر إتمام الدفع");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 sm:items-center">
      <div className="max-h-[92vh] w-full max-w-lg overflow-y-auto rounded-t-2xl bg-white p-6 shadow-2xl sm:rounded-2xl">
        <div className="mb-4 flex items-center justify-between">
          <h2 className="flex items-center gap-2 text-lg font-bold text-slate-800">
            <Receipt className="h-5 w-5 text-primary" />
            الحساب النهائي
          </h2>
          <button type="button" onClick={onClose} className="rounded-lg p-1 hover:bg-slate-100">
            <X className="h-5 w-5 text-slate-500" />
          </button>
        </div>

        {loading ? (
          <div className="flex justify-center py-12">
            <RefreshCw className="h-6 w-6 animate-spin text-primary" />
          </div>
        ) : summary ? (
          <>
            <div className="mb-4 rounded-xl bg-slate-50 p-3 text-sm">
              <p className="font-semibold text-slate-800">{summary.patientName}</p>
              <p className="mt-1 flex items-center gap-1 text-slate-500">
                <Stethoscope className="h-3.5 w-3.5" />
                {summary.doctorName}
              </p>
            </div>

            <div className="mb-4">
              <p className="mb-2 text-sm font-medium text-slate-600">
                إجراءات الطبيب اليوم
              </p>
              {summary.procedures.length === 0 ? (
                <p className="rounded-lg border border-dashed border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800">
                  لم يُسجّل إجراء بعد — تأكد أن الطبيب أدخل الجلسة من إدخال الجلسة
                </p>
              ) : (
                <ul className="space-y-2">
                  {summary.procedures.map((line) => (
                    <li
                      key={line.id}
                      className="flex items-center justify-between rounded-lg border border-slate-100 bg-white px-3 py-2 text-sm"
                    >
                      <span className="font-medium text-slate-700">{line.name}</span>
                      <span className="text-slate-600" dir="ltr">
                        {formatCurrency(line.total_amount)} د.ع
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </div>

            <div className="mb-4 rounded-xl border border-violet-200 bg-violet-50 px-4 py-3">
              <p className="text-xs text-violet-700">المبلغ المستحق</p>
              <p className="text-2xl font-bold text-violet-900" dir="ltr">
                {formatCurrency(summary.totalDue)} د.ع
              </p>
            </div>

            {error && (
              <p className="mb-3 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-600">
                {error}
              </p>
            )}

            <form onSubmit={handlePay} className="space-y-4">
              <div>
                <label className="mb-1 block text-sm font-medium text-slate-600">
                  المبلغ المدفوع الآن (د.ع)
                </label>
                <input
                  type="number"
                  min={0}
                  step="any"
                  value={paidAmount}
                  onChange={(e) => setPaidAmount(e.target.value)}
                  dir="ltr"
                  className="w-full rounded-xl border border-slate-200 bg-slate-50 px-4 py-2.5 text-sm focus:border-primary focus:outline-none"
                />
              </div>

              <div className="flex gap-2 pt-2">
                <button
                  type="submit"
                  disabled={saving}
                  className="flex flex-1 items-center justify-center gap-2 rounded-xl bg-primary py-3 text-sm font-bold text-white disabled:opacity-60"
                >
                  {saving && <RefreshCw className="h-4 w-4 animate-spin" />}
                  تأكيد الدفع وإغلاق الزيارة
                </button>
                <button
                  type="button"
                  onClick={onClose}
                  className="rounded-xl border border-slate-200 px-4 py-3 text-sm text-slate-600"
                >
                  إلغاء
                </button>
              </div>
            </form>
          </>
        ) : (
          <p className="py-8 text-center text-sm text-red-600">{error || "تعذر التحميل"}</p>
        )}
      </div>
    </div>
  );
}
