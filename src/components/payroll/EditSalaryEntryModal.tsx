"use client";

import { useState } from "react";
import { X, RefreshCw, Trash2 } from "lucide-react";
import { authPortalHeaders } from "@/lib/auth/api-portal";
import { translateDbError } from "@/lib/db-errors";
import {
  isSalaryReasonRequired,
  validateSalaryEntryReason,
} from "@/lib/services/salary-entry-reason";
import type { PayrollRecord, SalaryEntry, SalarySlip } from "@/types";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { CurrencyInput } from "@/components/ui/CurrencyInput";
import { formatCurrency, parseFormattedNumber } from "@/lib/utils";

function parsePositiveAmount(raw: string): number | null {
  const n = parseFloat(parseFormattedNumber(raw));
  if (!Number.isFinite(n) || n <= 0) return null;
  return n;
}

type EditSalaryEntryModalProps = {
  entry: SalaryEntry;
  typeLabel: string;
  monthFrom: string;
  monthTo: string;
  boardLocked: boolean;
  onClose: () => void;
  onSaved: (result: {
    entries: SalaryEntry[];
    slip?: SalarySlip | null;
    payrollRecord?: PayrollRecord | null;
    deleted?: boolean;
  }) => void;
};

export function EditSalaryEntryModal({
  entry,
  typeLabel,
  monthFrom,
  monthTo,
  boardLocked,
  onClose,
  onSaved,
}: EditSalaryEntryModalProps) {
  const [amount, setAmount] = useState(String(entry.amount ?? 0));
  const [entryDate, setEntryDate] = useState(entry.entry_date);
  const [notes, setNotes] = useState(entry.notes_ar ?? "");
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState("");

  function parseAmount(): number | null {
    return parsePositiveAmount(amount);
  }

  async function handleSave(e: React.FormEvent) {
    e.preventDefault();
    setError("");

    if (boardLocked) {
      setError("هذا الشهر مُغلق أو أرشيف — لا يمكن التعديل");
      return;
    }

    const parsed = parseAmount();
    if (parsed == null) {
      setError("أدخل مبلغاً أكبر من صفر");
      return;
    }

    if (entryDate < monthFrom || entryDate > monthTo) {
      setError(`تاريخ الحركة يجب أن يكون بين ${monthFrom} و ${monthTo}`);
      return;
    }

    const reasonError = validateSalaryEntryReason(entry.entry_type, notes);
    if (reasonError) {
      setError(reasonError);
      return;
    }

    setSaving(true);
    try {
      const res = await fetch(`/api/payroll/salary-entries/${entry.id}`, {
        method: "PATCH",
        credentials: "include",
        headers: {
          ...authPortalHeaders("accountant"),
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          amount: parsed,
          entry_date: entryDate,
          notes_ar: notes || null,
        }),
      });
      const json = (await res.json()) as {
        error?: string;
        entries?: SalaryEntry[];
        slip?: SalarySlip | null;
        payroll_record?: PayrollRecord | null;
      };

      if (!res.ok) {
        setError(translateDbError(json.error ?? "تعذر الحفظ"));
        return;
      }

      onSaved({
        entries: json.entries ?? [],
        slip: json.slip,
        payrollRecord: json.payroll_record,
      });
      onClose();
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete() {
    setError("");

    if (boardLocked) {
      setError("هذا الشهر مُغلق أو أرشيف — لا يمكن الحذف");
      return;
    }

    const ok = window.confirm(
      `حذف ${typeLabel} بمبلغ ${formatCurrency(Number(entry.amount))}؟\n\nسُعاد حساب الراتب تلقائياً.`
    );
    if (!ok) return;

    setDeleting(true);
    try {
      const res = await fetch(`/api/payroll/salary-entries/${entry.id}`, {
        method: "DELETE",
        credentials: "include",
        headers: authPortalHeaders("accountant"),
      });
      const json = (await res.json()) as {
        error?: string;
        entries?: SalaryEntry[];
        slip?: SalarySlip | null;
        payroll_record?: PayrollRecord | null;
      };

      if (!res.ok) {
        setError(translateDbError(json.error ?? "تعذر الحذف"));
        return;
      }

      onSaved({
        entries: json.entries ?? [],
        slip: json.slip,
        payrollRecord: json.payroll_record,
        deleted: true,
      });
      onClose();
    } finally {
      setDeleting(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div
        className="w-full max-w-md rounded-2xl border border-slate-border bg-surface-card p-5 shadow-elevated"
        role="dialog"
        aria-modal="true"
        aria-labelledby="edit-salary-entry-title"
      >
        <div className="mb-4 flex items-start justify-between gap-3">
          <div>
            <h3
              id="edit-salary-entry-title"
              className="text-lg font-bold text-slate-text"
            >
              تعديل الحركة
            </h3>
            <p className="mt-1 text-sm text-slate-muted">{typeLabel}</p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg p-1 text-slate-muted hover:bg-surface"
            aria-label="إغلاق"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <form onSubmit={(e) => void handleSave(e)} className="space-y-4">
          <CurrencyInput
            label={entry.entry_type === "daily_wage" ? "أجر اليوم" : "المبلغ"}
            value={amount}
            onChange={setAmount}
            disabled={boardLocked || saving || deleting}
          />
          <Input
            label="التاريخ"
            type="date"
            value={entryDate}
            onChange={(e) => setEntryDate(e.target.value)}
            min={monthFrom}
            max={monthTo}
            dir="ltr"
            className="text-left"
            disabled={boardLocked || saving || deleting}
          />
          <Input
            label={
              isSalaryReasonRequired(entry.entry_type)
                ? "السبب (مطلوب)"
                : "ملاحظات"
            }
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            disabled={boardLocked || saving || deleting}
          />

          {error ? (
            <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">
              {error}
            </p>
          ) : null}

          <div className="flex flex-wrap gap-2 pt-1">
            <Button
              type="submit"
              disabled={boardLocked || saving || deleting}
              className="flex-1"
            >
              {saving ? (
                <RefreshCw className="h-4 w-4 animate-spin" />
              ) : (
                "حفظ التعديل"
              )}
            </Button>
            <Button
              type="button"
              variant="danger"
              disabled={boardLocked || saving || deleting}
              onClick={() => void handleDelete()}
            >
              {deleting ? (
                <RefreshCw className="h-4 w-4 animate-spin" />
              ) : (
                <>
                  <Trash2 className="h-4 w-4" />
                  حذف
                </>
              )}
            </Button>
            <Button
              type="button"
              variant="outline"
              onClick={onClose}
              disabled={saving || deleting}
            >
              إلغاء
            </Button>
          </div>
        </form>
      </div>
    </div>
  );
}
