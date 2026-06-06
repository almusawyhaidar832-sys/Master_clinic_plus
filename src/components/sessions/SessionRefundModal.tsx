"use client";

import { useEffect, useState } from "react";
import { X, Undo2 } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { Alert } from "@/components/ui/Alert";
import { formatCurrency } from "@/lib/utils";
import { translateDbError } from "@/lib/db-errors";
import type { PatientOperation } from "@/types";

interface SessionRefundModalProps {
  operation: PatientOperation;
  maxRefundable: number;
  open: boolean;
  onClose: () => void;
  onSaved: (info?: { amount: number }) => void;
  patientName?: string;
  doctorName?: string;
}

export function SessionRefundModal({
  operation,
  maxRefundable,
  open,
  onClose,
  onSaved,
  patientName,
  doctorName,
}: SessionRefundModalProps) {
  const [amount, setAmount] = useState("");
  const [reason, setReason] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (open) {
      setAmount(maxRefundable > 0 ? String(maxRefundable) : "");
      setReason("");
      setError(null);
      setLoading(false);
    }
  }, [open, maxRefundable]);

  if (!open) return null;

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);

    try {
      const res = await fetch("/api/refunds", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          sessionId: operation.id,
          amount: Number(amount),
          reason: reason.trim(),
        }),
      });
      const data = (await res.json()) as {
        error?: string;
        success?: boolean;
        refund?: { amount?: number };
      };

      if (!res.ok || data.error) {
        setError(translateDbError(data.error ?? "تعذر تسجيل الإرجاع"));
        setLoading(false);
        return;
      }

      onSaved({ amount: Number(data.refund?.amount ?? amount) });
      onClose();
    } catch {
      setError("تعذر الاتصال بالسيرفر");
      setLoading(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div
        className="w-full max-w-md rounded-xl border border-slate-border bg-white shadow-xl"
        role="dialog"
        aria-modal="true"
        aria-labelledby="refund-modal-title"
      >
        <div className="flex items-center justify-between border-b border-slate-border px-4 py-3">
          <h2
            id="refund-modal-title"
            className="flex items-center gap-2 text-base font-bold text-slate-text"
          >
            <Undo2 className="h-5 w-5 text-primary" />
            استرجاع مبلغ
          </h2>
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg p-1 text-slate-muted hover:bg-surface hover:text-slate-text"
            aria-label="إغلاق"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4 p-4">
          {(patientName || doctorName) && (
            <div className="rounded-lg bg-surface px-3 py-2 text-sm">
              {patientName && (
                <p>
                  <span className="text-slate-muted">المراجع: </span>
                  <span className="font-semibold">{patientName}</span>
                </p>
              )}
              {doctorName && (
                <p>
                  <span className="text-slate-muted">الطبيب: </span>
                  <span className="font-semibold text-primary">{doctorName}</span>
                </p>
              )}
            </div>
          )}
          <p className="text-sm text-slate-muted">
            القابل للإرجاع من هذه الجلسة:{" "}
            <span className="font-semibold text-slate-text tabular-nums">
              {formatCurrency(maxRefundable)}
            </span>
          </p>

          {error && <Alert variant="error">{error}</Alert>}

          <div>
            <label
              htmlFor="refund-amount"
              className="mb-1 block text-sm font-medium text-slate-text"
            >
              المبلغ المسترجع
            </label>
            <input
              id="refund-amount"
              type="number"
              min={0.01}
              max={maxRefundable}
              step="0.01"
              required
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              className="w-full rounded-lg border border-slate-border px-3 py-2 text-sm tabular-nums focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary"
              dir="ltr"
            />
          </div>

          <div>
            <label
              htmlFor="refund-reason"
              className="mb-1 block text-sm font-medium text-slate-text"
            >
              سبب الإرجاع
            </label>
            <textarea
              id="refund-reason"
              required
              rows={3}
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="مثال: إلغاء الموعد، خطأ في التحصيل..."
              className="w-full resize-none rounded-lg border border-slate-border px-3 py-2 text-sm focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary"
            />
          </div>

          <div className="flex gap-2 pt-1">
            <Button type="submit" disabled={loading || maxRefundable <= 0}>
              {loading ? "جاري الحفظ..." : "تأكيد الإرجاع"}
            </Button>
            <Button type="button" variant="outline" onClick={onClose} disabled={loading}>
              إلغاء
            </Button>
          </div>
        </form>
      </div>
    </div>
  );
}
