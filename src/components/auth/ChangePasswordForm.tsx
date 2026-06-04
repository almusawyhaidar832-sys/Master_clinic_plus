"use client";

import { useState } from "react";
import Link from "next/link";
import { Button } from "@/components/ui/Button";
import { Alert } from "@/components/ui/Alert";
import { KeyRound, Eye, EyeOff } from "lucide-react";

type Props = {
  backHref: string;
  backLabel?: string;
};

export function ChangePasswordForm({
  backHref,
  backLabel = "العودة",
}: Props) {
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [showNew, setShowNew] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState<{
    type: "success" | "error";
    text: string;
  } | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setMessage(null);
    setLoading(true);

    try {
      const res = await fetch("/api/auth/change-password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ newPassword, confirmPassword }),
      });
      const data = await res.json();

      if (!res.ok) {
        setMessage({ type: "error", text: data.error ?? "فشل التحديث" });
        setLoading(false);
        return;
      }

      setMessage({
        type: "success",
        text: data.message ?? "تم تحديث كلمة المرور بنجاح",
      });
      setNewPassword("");
      setConfirmPassword("");
    } catch {
      setMessage({ type: "error", text: "تعذر الاتصال بالخادم" });
    }
    setLoading(false);
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div className="flex items-center gap-2 text-primary">
        <KeyRound className="h-5 w-5" />
        <h2 className="text-lg font-bold text-slate-text">تغيير كلمة المرور</h2>
      </div>

      <p className="text-sm text-slate-muted">
        أدخل كلمة مرور جديدة (8 أحرف أو أكثر). لا تشاركها مع أحد.
      </p>

      {message && (
        <Alert variant={message.type === "success" ? "success" : "error"}>
          {message.text}
        </Alert>
      )}

      <div>
        <label className="mb-1 block text-sm font-medium text-slate-text">
          كلمة المرور الجديدة
        </label>
        <div className="relative">
          <input
            type={showNew ? "text" : "password"}
            dir="ltr"
            autoComplete="new-password"
            required
            minLength={8}
            className="touch-input w-full rounded-xl border border-slate-border bg-surface px-4 py-3 pr-12 text-base"
            value={newPassword}
            onChange={(e) => setNewPassword(e.target.value)}
          />
          <button
            type="button"
            className="touch-target absolute left-1 top-1/2 -translate-y-1/2 text-slate-muted"
            onClick={() => setShowNew((v) => !v)}
          >
            {showNew ? (
              <EyeOff className="h-4 w-4" />
            ) : (
              <Eye className="h-4 w-4" />
            )}
          </button>
        </div>
      </div>

      <div>
        <label className="mb-1 block text-sm font-medium text-slate-text">
          تأكيد كلمة المرور
        </label>
        <div className="relative">
          <input
            type={showConfirm ? "text" : "password"}
            dir="ltr"
            autoComplete="new-password"
            required
            minLength={8}
            className="touch-input w-full rounded-xl border border-slate-border bg-surface px-4 py-3 pr-12 text-base"
            value={confirmPassword}
            onChange={(e) => setConfirmPassword(e.target.value)}
          />
          <button
            type="button"
            className="touch-target absolute left-1 top-1/2 -translate-y-1/2 text-slate-muted"
            onClick={() => setShowConfirm((v) => !v)}
          >
            {showConfirm ? (
              <EyeOff className="h-4 w-4" />
            ) : (
              <Eye className="h-4 w-4" />
            )}
          </button>
        </div>
      </div>

      <div className="flex flex-wrap gap-2 pt-2">
        <Button type="submit" disabled={loading}>
          {loading ? "جاري الحفظ..." : "حفظ كلمة المرور"}
        </Button>
        <Link
          href={backHref}
          className="touch-target inline-flex items-center justify-center rounded-xl border border-slate-border px-4 py-3 text-base font-medium text-slate-text hover:bg-surface"
        >
          {backLabel}
        </Link>
      </div>
    </form>
  );
}
