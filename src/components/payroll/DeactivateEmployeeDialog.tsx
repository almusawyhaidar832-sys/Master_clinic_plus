"use client";

import { useState } from "react";
import { Archive, RefreshCw } from "lucide-react";
import { Modal } from "@/components/ui/Modal";
import { authPortalHeaders } from "@/lib/auth/api-portal";
import {
  payrollCategoryLabel,
  type PayrollPerson,
} from "@/lib/services/payroll-persons";

interface DeactivateEmployeeDialogProps {
  person: PayrollPerson;
  onClose: () => void;
  onDeactivated: () => void;
}

export function DeactivateEmployeeDialog({
  person,
  onClose,
  onDeactivated,
}: DeactivateEmployeeDialogProps) {
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  async function handleDeactivate() {
    setSaving(true);
    setError("");

    const res = await fetch("/api/payroll/deactivate-employee", {
      method: "POST",
      credentials: "include",
      headers: {
        "Content-Type": "application/json",
        ...authPortalHeaders("accountant"),
      },
      body: JSON.stringify({
        category: person.category,
        id: person.id,
      }),
    });

    const json = await res.json();
    setSaving(false);

    if (!res.ok) {
      setError(json.error ?? "تعذر الإيقاف");
      return;
    }

    onDeactivated();
    onClose();
  }


  return (
    <Modal
      onClose={onClose}
      title="إيقاف موظف"
      subtitle={payrollCategoryLabel(person.category)}
      icon={Archive}
      size="sm"
      closeOnBackdrop={false}
      footer={
        <>
          <button
            type="button"
            onClick={onClose}
            className="mc-btn-soft flex-1 py-2.5"
          >
            إلغاء
          </button>
          <button
            type="button"
            onClick={() => void handleDeactivate()}
            disabled={saving}
            className="inline-flex flex-1 items-center justify-center gap-2 rounded-xl border border-warning-border bg-warning px-4 py-2.5 text-sm font-bold text-warning-text transition-colors hover:brightness-95 disabled:opacity-60"
          >
            {saving ? (
              <RefreshCw className="h-4 w-4 animate-spin" />
            ) : (
              <Archive className="h-4 w-4" />
            )}
            إيقاف الموظف
          </button>
        </>
      }
    >
      <p className="mb-3 text-sm text-slate-text">
        إيقاف <strong>{person.full_name_ar}</strong> (
        {payrollCategoryLabel(person.category)})؟
      </p>
      <ul className="space-y-1.5 rounded-xl border border-slate-border bg-surface p-3.5 text-xs text-slate-muted">
        {[
          "يختفي من قائمة الرواتب والقائمة المنسدلة",
          "سجلات الرواتب السابقة تبقى محفوظة",
          "لا يُحذف من قاعدة البيانات — أرشفة فقط",
        ].map((item) => (
          <li key={item} className="flex items-start gap-2">
            <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-premium-400" />
            {item}
          </li>
        ))}
      </ul>

      {error && (
        <p className="mt-3 rounded-xl border border-debt-border bg-debt px-3.5 py-2.5 text-sm text-debt-text">
          {error}
        </p>
      )}
    </Modal>
  );
}
