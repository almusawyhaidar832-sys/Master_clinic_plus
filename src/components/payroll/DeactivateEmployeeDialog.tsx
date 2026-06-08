"use client";

import { useState } from "react";
import { Archive, RefreshCw, X } from "lucide-react";
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
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="w-full max-w-sm rounded-2xl bg-white p-6 shadow-xl">
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-lg font-bold text-slate-800">إيقاف موظف</h2>
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg p-1 hover:bg-slate-100"
          >
            <X className="h-5 w-5 text-slate-400" />
          </button>
        </div>

        <p className="mb-2 text-sm text-slate-600">
          إيقاف <strong>{person.full_name_ar}</strong> (
          {payrollCategoryLabel(person.category)})؟
        </p>
        <ul className="mb-4 list-inside list-disc space-y-1 text-xs text-slate-500">
          <li>يختفي من قائمة الرواتب والقائمة المنسدلة</li>
          <li>سجلات الرواتب السابقة تبقى محفوظة</li>
          <li>لا يُحذف من قاعدة البيانات — أرشفة فقط</li>
        </ul>

        {error && (
          <p className="mb-3 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">
            {error}
          </p>
        )}

        <div className="flex gap-2">
          <button
            type="button"
            onClick={onClose}
            className="flex-1 rounded-xl border border-slate-200 px-4 py-2.5 text-sm font-medium hover:bg-slate-50"
          >
            إلغاء
          </button>
          <button
            type="button"
            onClick={() => void handleDeactivate()}
            disabled={saving}
            className="flex flex-1 items-center justify-center gap-2 rounded-xl bg-amber-600 px-4 py-2.5 text-sm font-bold text-white hover:bg-amber-700 disabled:opacity-60"
          >
            {saving ? (
              <RefreshCw className="h-4 w-4 animate-spin" />
            ) : (
              <Archive className="h-4 w-4" />
            )}
            إيقاف الموظف
          </button>
        </div>
      </div>
    </div>
  );
}
