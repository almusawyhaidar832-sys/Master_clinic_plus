"use client";

import { useState } from "react";
import { Pencil } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { Alert } from "@/components/ui/Alert";
import type { PatientOperation } from "@/types";
import { opName } from "@/types";

type Props = {
  operation: PatientOperation;
  onSaved: () => void;
};

export function SessionEditDialog({ operation, onSaved }: Props) {
  const [open, setOpen] = useState(false);
  const [paid, setPaid] = useState(String(operation.paid_amount ?? 0));
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
      const res = await fetch(`/api/operations/${operation.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          paid_amount: Number(paid) || 0,
          notes: notes.trim() || null,
          operation_date: date || undefined,
          notify_patient: true,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setMessage(data.error ?? "فشل الحفظ");
        setLoading(false);
        return;
      }
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
        تعديل السجل
      </Button>
    );
  }

  return (
    <div className="mt-2 rounded-lg border border-primary/30 bg-primary/5 p-3">
      <p className="mb-2 text-sm font-bold text-slate-text">
        تعديل: {opName(operation)}
      </p>
      <p className="mb-2 text-xs text-slate-muted">
        يُسجّل التعديل في سجل التدقيق (Audit Log)
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
        <label className="text-xs font-medium text-slate-text">
          المبلغ المدفوع
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
          {loading ? "جاري الحفظ..." : "حفظ"}
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
