"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { AlertTriangle, RefreshCw, Trash2, X } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { Alert } from "@/components/ui/Alert";
import { authPortalHeaders } from "@/lib/auth/api-portal";
import { translateDbError } from "@/lib/db-errors";

interface DeletePatientPanelProps {
  patientId: string;
  patientName: string;
}

export function DeletePatientPanel({
  patientId,
  patientName,
}: DeletePatientPanelProps) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [confirmName, setConfirmName] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const nameMatches =
    confirmName.trim() === patientName.trim() && confirmName.trim().length > 0;

  async function handleDelete() {
    if (!nameMatches) {
      setError("اكتب اسم المريض بالضبط للتأكيد");
      return;
    }

    setSaving(true);
    setError(null);

    try {
      const res = await fetch(`/api/patients/${patientId}`, {
        method: "DELETE",
        credentials: "include",
        headers: authPortalHeaders("accountant"),
      });

      const json = (await res.json()) as { error?: string };

      if (!res.ok) {
        setError(translateDbError(json.error ?? "تعذر حذف المريض"));
        return;
      }

      router.push("/dashboard/patients");
      router.refresh();
    } catch {
      setError("تعذر الاتصال بالخادم");
    } finally {
      setSaving(false);
    }
  }

  function closeDialog() {
    if (saving) return;
    setOpen(false);
    setConfirmName("");
    setError(null);
  }

  return (
    <>
      <div className="rounded-xl border border-red-200 bg-red-50/60 p-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <p className="text-sm font-semibold text-red-800">حذف المريض نهائياً</p>
            <p className="mt-1 text-xs text-red-700/90 leading-relaxed">
              يُحذف الملف المالي والأرشيف الطبي وجميع الجلسات والأشعة — لا يمكن
              استرجاعه.
            </p>
          </div>
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="border-red-300 text-red-700 hover:bg-red-100"
            onClick={() => setOpen(true)}
          >
            <Trash2 className="h-4 w-4" />
            حذف من العيادة
          </Button>
        </div>
      </div>

      {open ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div className="w-full max-w-md rounded-2xl bg-white p-6 shadow-xl">
            <div className="mb-3 flex items-center justify-between">
              <div className="flex items-center gap-2 text-red-700">
                <AlertTriangle className="h-5 w-5" />
                <h2 className="text-lg font-bold">تأكيد الحذف النهائي</h2>
              </div>
              <button
                type="button"
                onClick={closeDialog}
                className="rounded-lg p-1 hover:bg-slate-100"
                disabled={saving}
              >
                <X className="h-5 w-5 text-slate-400" />
              </button>
            </div>

            <p className="mb-3 text-sm text-slate-600">
              سيتم حذف <strong>{patientName}</strong> وجميع بياناته من العيادة
              بشكل دائم.
            </p>

            <ul className="mb-4 list-inside list-disc space-y-1 text-xs text-slate-500">
              <li>جميع الجلسات والمدفوعات والديون</li>
              <li>الأرشيف الطبي والأشعة والوصفات</li>
              <li>المواعيد وسجل الانتظار</li>
            </ul>

            <label className="mb-4 block">
              <span className="mb-1 block text-xs font-medium text-slate-600">
                للتأكيد، اكتب اسم المريض:{" "}
                <span className="font-bold text-slate-800">{patientName}</span>
              </span>
              <input
                type="text"
                value={confirmName}
                onChange={(e) => setConfirmName(e.target.value)}
                className="w-full rounded-xl border border-slate-200 px-3 py-2 text-sm focus:border-red-400 focus:outline-none focus:ring-2 focus:ring-red-100"
                placeholder={patientName}
                autoComplete="off"
                disabled={saving}
              />
            </label>

            {error ? (
              <Alert variant="error" className="mb-3">
                {error}
              </Alert>
            ) : null}

            <div className="flex gap-2">
              <Button
                type="button"
                variant="outline"
                className="flex-1"
                onClick={closeDialog}
                disabled={saving}
              >
                إلغاء
              </Button>
              <Button
                type="button"
                className="flex-1 bg-red-600 hover:bg-red-700 text-white border-red-600"
                onClick={() => void handleDelete()}
                disabled={saving || !nameMatches}
              >
                {saving ? (
                  <RefreshCw className="h-4 w-4 animate-spin" />
                ) : (
                  <Trash2 className="h-4 w-4" />
                )}
                حذف نهائياً
              </Button>
            </div>
          </div>
        </div>
      ) : null}
    </>
  );
}
