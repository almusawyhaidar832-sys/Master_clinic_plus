"use client";

import { useEffect, useMemo, useState } from "react";
import { Pencil } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { Alert } from "@/components/ui/Alert";
import { authPortalHeaders } from "@/lib/auth/api-portal";
import { notifyOperationEditMutation } from "@/lib/sync/mutation-notify";
import { formatCurrency } from "@/lib/utils";
import { createClient } from "@/lib/supabase/client";
import type { PatientOperation } from "@/types";
import { opName } from "@/types";

type Props = {
  operation: PatientOperation;
  onSaved: () => void;
  authPortal?: "accountant" | "doctor";
};

export function SessionEditDialog({
  operation,
  onSaved,
  authPortal = "accountant",
}: Props) {
  const isPlan =
    operation.session_kind === "plan" || Number(operation.total_amount) > 0;
  const isRefund = operation.session_kind === "refund";

  const [open, setOpen] = useState(false);
  const [paid, setPaid] = useState(String(operation.paid_amount ?? 0));
  const [total, setTotal] = useState(String(operation.total_amount ?? 0));
  const [notes, setNotes] = useState(operation.notes ?? "");
  const [date, setDate] = useState(
    operation.operation_date ?? operation.created_at?.split("T")[0] ?? ""
  );
  const [isReviewStatement, setIsReviewStatement] = useState(
    Boolean(operation.is_review_statement)
  );
  const [reviewFee, setReviewFee] = useState(
    String(
      Number((operation as { review_fee_amount?: number }).review_fee_amount ?? 0)
    )
  );
  const [clinicReviewFee, setClinicReviewFee] = useState(0);
  const [reason, setReason] = useState("");
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    const supabase = createClient();
    void supabase
      .from("clinics")
      .select("review_fee_enabled, review_fee_amount")
      .eq("id", operation.clinic_id)
      .maybeSingle()
      .then(({ data }) => {
        if (data?.review_fee_enabled) {
          setClinicReviewFee(Number(data.review_fee_amount ?? 0));
        }
      });
  }, [open, operation.clinic_id]);

  const paidNum = Number(paid) || 0;
  const reviewFeeNum = isReviewStatement ? Number(reviewFee) || 0 : 0;
  const treatmentPaid = Math.max(0, paidNum - reviewFeeNum);

  const classificationChanged =
    isReviewStatement !== Boolean(operation.is_review_statement) ||
    reviewFeeNum !==
      Number((operation as { review_fee_amount?: number }).review_fee_amount ?? 0);

  const previewHint = useMemo(() => {
    if (!isReviewStatement || reviewFeeNum <= 0) {
      return "المبلغ كله يُحسب للطبيب حسب نسبته (ما عدا راتب ثابت).";
    }
    if (reviewFeeNum >= paidNum) {
      return `كشفية فقط — ${formatCurrency(paidNum)} للعيادة، حصة الطبيب 0.`;
    }
    return `علاج ${formatCurrency(treatmentPaid)} + كشفية ${formatCurrency(reviewFeeNum)} — الكشفية للعيادة فقط.`;
  }, [isReviewStatement, paidNum, reviewFeeNum, treatmentPaid]);

  async function save() {
    if (classificationChanged && !reason.trim()) {
      setMessage("أدخل سبب التصحيح (يظهر في سجل المراقبة للإدارة)");
      return;
    }
    if (isReviewStatement && reviewFeeNum <= 0) {
      setMessage("حدد مبلغ الكشفية أو ألغِ خيار كشفية مراجع");
      return;
    }
    if (isReviewStatement && reviewFeeNum > paidNum) {
      setMessage("مبلغ الكشفية لا يمكن أن يتجاوز المدفوع");
      return;
    }

    setLoading(true);
    setMessage(null);
    try {
      const payload: Record<string, unknown> = {
        paid_amount: paidNum,
        notes: notes.trim() || null,
        operation_date: date || undefined,
        notify_patient: false,
        is_review_statement: isReviewStatement,
        review_fee_amount: isReviewStatement ? reviewFeeNum : 0,
      };

      if (classificationChanged && reason.trim()) {
        payload.audit_note = reason.trim();
      }

      if (isPlan) {
        payload.total_amount = Number(total) || 0;
      }

      const res = await fetch(`/api/operations/${operation.id}`, {
        method: "PATCH",
        credentials: "include",
        headers: {
          "Content-Type": "application/json",
          ...authPortalHeaders(authPortal),
        },
        body: JSON.stringify(payload),
      });
      const data = await res.json();
      if (!res.ok) {
        setMessage(data.error ?? "فشل الحفظ");
        setLoading(false);
        return;
      }

      notifyOperationEditMutation({
        clinicId: operation.clinic_id,
        doctorId: operation.doctor_id,
        patientId: operation.patient_id,
      });

      setOpen(false);
      onSaved();
    } catch {
      setMessage("تعذر الاتصال بالخادم");
    }
    setLoading(false);
  }

  if (!open) {
    return (
      <Button
        type="button"
        variant="outline"
        size="sm"
        className="touch-target mt-2 w-full"
        onClick={() => setOpen(true)}
      >
        <Pencil className="h-4 w-4" />
        تعديل الجلسة
      </Button>
    );
  }

  return (
    <div className="mt-2 rounded-lg border border-primary/30 bg-primary/5 p-3">
      <p className="mb-2 text-sm font-bold text-slate-text">
        تعديل: {opName(operation)}
      </p>
      <p className="mb-2 text-xs text-slate-muted">
        يُحدَّث المبلغ ونوع الجلسة (جلسة / كشفية) وحصة الطبيب — يظهر التعديل
        في محفظة الطبيب وسجل المراقبة
      </p>
      {message && (
        <Alert variant="error" className="mb-2">
          {message}
        </Alert>
      )}
      <div className="grid gap-2">
        <label className="text-xs font-medium text-slate-text">
          تاريخ الجلسة
          <input
            type="date"
            className="touch-input mt-1 w-full rounded-lg border border-slate-border px-3 py-2"
            value={date}
            onChange={(e) => setDate(e.target.value)}
          />
        </label>
        {isPlan && (
          <label className="text-xs font-medium text-slate-text">
            المبلغ الكلي للحالة
            <span className="mr-1 font-normal text-slate-muted">
              (كان {formatCurrency(Number(operation.total_amount ?? 0))})
            </span>
            <input
              type="number"
              min={0}
              dir="ltr"
              className="touch-input mt-1 w-full rounded-lg border border-slate-border px-3 py-2"
              value={total}
              onChange={(e) => setTotal(e.target.value)}
            />
          </label>
        )}
        <label className="text-xs font-medium text-slate-text">
          المبلغ المدفوع
          <span className="mr-1 font-normal text-slate-muted">
            (كان {formatCurrency(Number(operation.paid_amount ?? 0))})
          </span>
          <input
            type="number"
            min={0}
            dir="ltr"
            className="touch-input mt-1 w-full rounded-lg border border-slate-border px-3 py-2"
            value={paid}
            onChange={(e) => setPaid(e.target.value)}
          />
        </label>

        {!isRefund && !isPlan && (
          <div className="rounded-lg border border-slate-border/80 bg-white p-2">
            <label className="flex cursor-pointer items-center gap-2 text-sm font-medium text-slate-text">
              <input
                type="checkbox"
                checked={isReviewStatement}
                onChange={(e) => {
                  const checked = e.target.checked;
                  setIsReviewStatement(checked);
                  if (checked && Number(reviewFee) <= 0) {
                    const defaultFee =
                      clinicReviewFee > 0
                        ? clinicReviewFee
                        : Number(operation.paid_amount ?? 0);
                    setReviewFee(String(defaultFee));
                  }
                  if (!checked) setReviewFee("0");
                }}
              />
              كشفية مراجع (ليست جلسة علاج)
            </label>
            {isReviewStatement && (
              <label className="mt-2 block text-xs font-medium text-slate-text">
                مبلغ الكشفية
                {clinicReviewFee > 0 && (
                  <span className="mr-1 font-normal text-slate-muted">
                    (الافتراضي {formatCurrency(clinicReviewFee)})
                  </span>
                )}
                <input
                  type="number"
                  min={0}
                  dir="ltr"
                  className="touch-input mt-1 w-full rounded-lg border border-slate-border px-3 py-2"
                  value={reviewFee}
                  onChange={(e) => setReviewFee(e.target.value)}
                />
              </label>
            )}
            <p className="mt-2 text-xs text-slate-muted">{previewHint}</p>
          </div>
        )}

        {classificationChanged && (
          <label className="text-xs font-medium text-slate-text">
            سبب التصحيح (للإدارة)
            <textarea
              className="mt-1 w-full rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-sm"
              rows={2}
              placeholder="مثال: كانت كشفية مراجع وليس جلسة علاج"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
            />
          </label>
        )}

        <label className="text-xs font-medium text-slate-text">
          ملاحظات
          <textarea
            className="mt-1 w-full rounded-lg border border-slate-border px-3 py-2 text-sm"
            rows={2}
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
          />
        </label>
      </div>
      <div className="mt-3 flex flex-wrap gap-2">
        <Button
          type="button"
          size="sm"
          disabled={loading}
          onClick={() => void save()}
        >
          {loading ? "جاري الحفظ..." : "حفظ التعديل"}
        </Button>
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() => setOpen(false)}
        >
          إلغاء
        </Button>
      </div>
    </div>
  );
}
