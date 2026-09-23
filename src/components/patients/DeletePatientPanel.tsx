"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { AlertTriangle, RefreshCw, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { Modal } from "@/components/ui/Modal";
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
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-debt-border bg-surface-card p-4">
        <div className="flex min-w-0 items-start gap-3">
          <span className="mc-kpi__icon mc-tone-danger h-10 w-10">
            <Trash2 className="h-4 w-4" />
          </span>
          <div className="min-w-0">
            <p className="text-sm font-bold text-debt-text">حذف المريض نهائياً</p>
            <p className="mt-0.5 text-xs leading-relaxed text-slate-muted">
              يُحذف الملف المالي والأرشيف الطبي وجميع الجلسات والأشعة — لا يمكن
              استرجاعه.
            </p>
          </div>
        </div>
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="border-debt-border text-debt-text hover:bg-debt"
          onClick={() => setOpen(true)}
        >
          <Trash2 className="h-4 w-4" />
          حذف من العيادة
        </Button>
      </div>

      {open ? (
        <Modal
          onClose={closeDialog}
          title="تأكيد الحذف النهائي"
          subtitle={patientName}
          icon={AlertTriangle}
          size="md"
          footer={
            <>
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
                variant="danger"
                className="flex-1"
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
            </>
          }
        >
          <div className="space-y-4">
            <p className="text-sm text-slate-text">
              سيتم حذف <strong>{patientName}</strong> وجميع بياناته من العيادة
              بشكل دائم.
            </p>

            <ul className="space-y-1.5 rounded-xl border border-debt-border bg-debt px-4 py-3 text-xs text-debt-text">
              <li className="flex items-center gap-2">
                <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-current" />
                جميع الجلسات والمدفوعات والديون
              </li>
              <li className="flex items-center gap-2">
                <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-current" />
                الأرشيف الطبي والأشعة والوصفات
              </li>
              <li className="flex items-center gap-2">
                <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-current" />
                المواعيد وسجل الانتظار
              </li>
            </ul>

            <label className="block">
              <span className="mb-1.5 block text-xs font-medium text-slate-muted">
                للتأكيد، اكتب اسم المريض:{" "}
                <span className="font-bold text-slate-text">{patientName}</span>
              </span>
              <input
                type="text"
                value={confirmName}
                onChange={(e) => setConfirmName(e.target.value)}
                className="mc-field focus:border-debt-border focus:ring-red-500/10"
                placeholder={patientName}
                autoComplete="off"
                disabled={saving}
              />
            </label>

            {error ? <Alert variant="error">{error}</Alert> : null}
          </div>
        </Modal>
      ) : null}
    </>
  );
}
