"use client";

import { useEffect, useState } from "react";
import { RefreshCw, Receipt, Stethoscope, User, ClipboardList, Wallet, CheckCircle2 } from "lucide-react";
import { Modal } from "@/components/ui/Modal";
import { Alert } from "@/components/ui/Alert";
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
    <Modal
      onClose={onClose}
      title="الحساب النهائي"
      subtitle={summary?.patientName}
      icon={Receipt}
      size="lg"
      closeOnBackdrop={false}
    >
        {loading ? (
          <div className="space-y-3">
            <div className="mc-skeleton h-16 rounded-2xl" />
            <div className="mc-skeleton h-24 rounded-2xl" />
            <div className="mc-skeleton h-20 rounded-2xl" />
          </div>
        ) : summary ? (
          <>
            <div className="mb-4 flex items-center gap-3 rounded-2xl border border-slate-border bg-surface p-3.5 text-sm">
              <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-primary-50 text-primary-700 ring-1 ring-inset ring-primary-200/70">
                <User className="h-5 w-5" />
              </span>
              <div className="min-w-0">
                <p className="truncate font-bold text-slate-text">{summary.patientName}</p>
                <p className="mt-0.5 flex items-center gap-1 text-xs text-slate-muted">
                  <Stethoscope className="h-3.5 w-3.5 text-premium-500" />
                  {summary.doctorName}
                </p>
              </div>
            </div>

            <div className="mb-4">
              <p className="mb-2 flex items-center gap-1.5 text-xs font-bold uppercase tracking-wide text-slate-muted">
                <ClipboardList className="h-3.5 w-3.5 text-premium-500" />
                إجراءات الطبيب اليوم
              </p>
              {summary.procedures.length === 0 ? (
                <p className="rounded-xl border border-dashed border-warning-border bg-warning px-3.5 py-2.5 text-sm text-warning-text">
                  لم يُسجّل إجراء بعد — تأكد أن الطبيب أدخل الجلسة من إدخال الجلسة
                </p>
              ) : (
                <ul className="divide-y divide-slate-border overflow-hidden rounded-2xl border border-slate-border">
                  {summary.procedures.map((line) => (
                    <li
                      key={line.id}
                      className="flex items-center justify-between gap-3 bg-surface-card px-4 py-2.5 text-sm"
                    >
                      <span className="font-medium text-slate-text">{line.name}</span>
                      <span className="font-semibold tabular-nums text-slate-text" dir="ltr">
                        {formatCurrency(line.total_amount)} د.ع
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </div>

            <div className="relative mb-4 overflow-hidden rounded-2xl bg-mc-navy px-5 py-4 text-white shadow-soft">
              <p className="text-[11px] font-semibold uppercase tracking-[0.12em] text-premium-300">المبلغ المستحق</p>
              <p className="mt-1 text-3xl font-black tabular-nums text-premium-200" dir="ltr">
                {formatCurrency(summary.totalDue)} د.ع
              </p>
            </div>

            {error && (
              <Alert variant="error" className="mb-3">
                {error}
              </Alert>
            )}

            <form onSubmit={handlePay} className="space-y-4">
              <div>
                <label className="mb-1.5 flex items-center gap-1.5 text-xs font-bold text-slate-muted">
                  <Wallet className="h-3.5 w-3.5 text-premium-500" />
                  المبلغ المدفوع الآن (د.ع)
                </label>
                <input
                  type="number"
                  min={0}
                  step="any"
                  value={paidAmount}
                  onChange={(e) => setPaidAmount(e.target.value)}
                  dir="ltr"
                  className="mc-field text-lg font-bold tabular-nums"
                />
              </div>

              <div className="flex gap-2 pt-1">
                <button
                  type="submit"
                  disabled={saving}
                  className="mc-btn-pearl flex-1 py-3"
                >
                  {saving ? <RefreshCw className="h-4 w-4 animate-spin" /> : <CheckCircle2 className="h-4 w-4" />}
                  تأكيد الدفع وإغلاق الزيارة
                </button>
                <button
                  type="button"
                  onClick={onClose}
                  className="mc-btn-soft px-5 py-3"
                >
                  إلغاء
                </button>
              </div>
            </form>
          </>
        ) : (
          <Alert variant="error">{error || "تعذر التحميل"}</Alert>
        )}
    </Modal>
  );
}
