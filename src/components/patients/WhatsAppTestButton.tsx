"use client";

import { useState } from "react";
import { Button } from "@/components/ui/Button";
import { Alert } from "@/components/ui/Alert";
import { validatePatientPhone } from "@/lib/phone";
import { MessageCircle } from "lucide-react";

export function WhatsAppTestButton() {
  const [open, setOpen] = useState(false);
  const [phone, setPhone] = useState("");
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<{
    type: "success" | "error";
    text: string;
  } | null>(null);

  async function sendTest() {
    setResult(null);
    const check = validatePatientPhone(phone);
    if (!check.ok) {
      setResult({ type: "error", text: check.message });
      return;
    }

    setLoading(true);
    try {
      const res = await fetch("/api/whatsapp/test", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ phone: check.normalized }),
      });
      const data = await res.json();
      if (!res.ok) {
        const detail = data.providerError
          ? ` — ${data.providerError}`
          : "";
        setResult({
          type: "error",
          text: (data.error ?? "فشل الإرسال") + detail,
        });
        return;
      }
      setResult({
        type: "success",
        text: `${data.message ?? "تم"} (${data.normalizedPhone ?? check.normalized})`,
      });
    } catch {
      setResult({ type: "error", text: "تعذر الاتصال بالخادم" });
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="rounded-xl border border-slate-border bg-surface/50 p-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="font-semibold text-slate-text">اختبار إشعار الواتساب</p>
          <p className="text-xs text-slate-muted">
            رسالة تجريبية لرقمك — الأخطاء تُسجَّل في السجلات ([whatsapp])
          </p>
        </div>
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() => setOpen((v) => !v)}
        >
          <MessageCircle className="h-4 w-4" />
          {open ? "إخفاء" : "اختبار الإشعار"}
        </Button>
      </div>

      {open && (
        <div className="mt-3 space-y-3 border-t border-slate-border pt-3">
          <div>
            <label className="mb-1 block text-sm font-medium text-slate-text">
              رقمك (للتجربة)
            </label>
            <input
              type="tel"
              dir="ltr"
              className="w-full max-w-sm rounded-lg border border-slate-border bg-white px-3 py-2 text-sm outline-none focus:border-primary focus:ring-1 focus:ring-primary"
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              placeholder="07XX XXX XXXX"
            />
          </div>
          {result && (
            <Alert variant={result.type === "success" ? "success" : "error"}>
              {result.text}
            </Alert>
          )}
          <Button
            type="button"
            size="sm"
            disabled={loading}
            onClick={sendTest}
          >
            {loading ? "جاري الإرسال..." : "إرسال رسالة تجريبية"}
          </Button>
        </div>
      )}
    </div>
  );
}
