"use client";

import { useState } from "react";
import { Pencil } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { Alert } from "@/components/ui/Alert";
import { authPortalHeaders } from "@/lib/auth/api-portal";
import { notifyFinancialMutation } from "@/lib/sync/mutation-notify";
import { notifyClinicSync } from "@/lib/sync/clinic-events";
import { formatCurrency } from "@/lib/utils";
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

  const [open, setOpen] = useState(false);
  const [paid, setPaid] = useState(String(operation.paid_amount ?? 0));
  const [total, setTotal] = useState(String(operation.total_amount ?? 0));
  const [notes, setNotes] = useState(operation.notes ?? "");
  const [date, setDate] = useState(
    operation.operation_date ?? operation.created_at?.split("T")[0] ?? ""
  );
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  async function save() {
    setLoading(true);
    setMessage(null);
    try {
      const payload: Record<string, unknown> = {
        paid_amount: Number(paid) || 0,
        notes: notes.trim() || null,
        operation_date: date || undefined,
        notify_patient: false,
      };

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

      notifyFinancialMutation({
        clinicId: operation.clinic_id,
        doctorId: operation.doctor_id,
        patientId: operation.patient_id,
        alsoSessions: true,
      });
      notifyClinicSync({
        topic: ["audit", "financial"],
        clinicId: operation.clinic_id,
        doctorId: operation.doctor_id,
        patientId: operation.patient_id,
        source: "mutation",
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
        تعديل المبلغ
      </Button>
    );
  }

  return (
    <div className="mt-2 rounded-lg border border-primary/30 bg-primary/5 p-3">
      <p className="mb-2 text-sm font-bold text-slate-text">
        تعديل: {opName(operation)}
      </p>
      <p className="mb-2 text-xs text-slate-muted">
        يُحدَّث المبلغ وحصة الطبيب حسب نسبته — عند الطبيب وكشف التحصيل وسجل
        المراقبة
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
