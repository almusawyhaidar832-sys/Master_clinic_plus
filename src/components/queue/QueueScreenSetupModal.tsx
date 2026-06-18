"use client";

import { useCallback, useEffect, useState } from "react";
import QRCode from "qrcode";
import { Button } from "@/components/ui/Button";
import { Alert } from "@/components/ui/Alert";
import { Copy, Download, ExternalLink, Monitor, QrCode, RefreshCw, X } from "lucide-react";
import { authPortalHeaders } from "@/lib/auth/api-portal";

interface ScreenQrInfo {
  clinicId: string;
  clinicCode: string;
  screenUrl: string;
  clinicName: string;
  unreachableOnMobile?: boolean;
}

function manualScreenUrlParts(screenUrl: string): {
  hostPath: string;
  clinicCode: string;
} {
  try {
    const url = new URL(screenUrl);
    return {
      hostPath: `${url.host}${url.pathname}`,
      clinicCode: url.searchParams.get("clinic") ?? "",
    };
  } catch {
    return { hostPath: screenUrl, clinicCode: "" };
  }
}

interface QueueScreenSetupModalProps {
  open: boolean;
  onClose: () => void;
}

export function QueueScreenSetupModal({ open, onClose }: QueueScreenSetupModalProps) {
  const [info, setInfo] = useState<ScreenQrInfo | null>(null);
  const [qrDataUrl, setQrDataUrl] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    setCopied(false);
    try {
      const origin =
        typeof window !== "undefined"
          ? encodeURIComponent(window.location.origin)
          : "";
      const qs = origin ? `?origin=${origin}` : "";
      const res = await fetch(`/api/queue/screen/qr${qs}`, {
        headers: authPortalHeaders("accountant"),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "تعذر تحميل باركود الشاشة");

      setInfo(data);
      const dataUrl = await QRCode.toDataURL(data.screenUrl, {
        width: 280,
        margin: 2,
        color: { dark: "#0056b3", light: "#ffffff" },
      });
      setQrDataUrl(dataUrl);
    } catch (e) {
      setError(e instanceof Error ? e.message : "تعذر تحميل باركود الشاشة");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (open) void load();
  }, [open, load]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/50 p-4 sm:items-center">
      <div className="max-h-[90vh] w-full max-w-md overflow-y-auto rounded-2xl bg-white shadow-xl">
        <div className="flex items-center justify-between border-b border-slate-200 px-5 py-4">
          <h2 className="flex items-center gap-2 text-lg font-bold text-slate-800">
            <Monitor className="h-5 w-5 text-primary" />
            ربط شاشة التلفاز
          </h2>
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg p-1 hover:bg-slate-100"
            aria-label="إغلاق"
          >
            <X className="h-5 w-5 text-slate-400" />
          </button>
        </div>

        <div className="space-y-4 p-5">
          <p className="text-sm leading-relaxed text-slate-600">
            إن كان التلفاز <strong>بدون كاميرا</strong> — استخدم كابل HDMI (الأسهل) أو
            انسخ الرابط وافتحه من جوالك. الباركود اختياري فقط.
          </p>

          <ol className="list-decimal space-y-1 pr-5 text-sm text-slate-600">
            <li>افتح <strong>Chrome</strong> على تلفاز العيادة أو جهاز مربوط به</li>
            <li>امسح الباركود أدناه (أو انسخ الرابط)</li>
            <li>اترك الصفحة مفتوحة — النداء يظهر تلقائياً</li>
          </ol>

          {error && <Alert variant="error">{error}</Alert>}

          {loading && !info ? (
            <div className="flex h-48 items-center justify-center">
              <RefreshCw className="h-8 w-8 animate-spin text-primary" />
            </div>
          ) : info && qrDataUrl ? (
            <div className="flex flex-col items-center gap-3">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={qrDataUrl}
                alt="باركود شاشة الانتظار"
                className="rounded-xl border border-slate-200 bg-white p-3"
                width={240}
                height={240}
              />

              <div className="w-full rounded-lg bg-slate-50 p-3 text-center">
                <p className="text-xs text-slate-muted">رمز العيادة (رابط قصير)</p>
                <p className="font-mono text-lg font-bold tracking-widest text-primary">
                  {info.clinicCode}
                </p>
                <p className="mt-2 break-all text-xs text-slate-600" dir="ltr">
                  {info.screenUrl}
                </p>
              </div>

              <div className="flex w-full flex-wrap gap-2">
                <Button
                  type="button"
                  variant="outline"
                  className="flex-1"
                  onClick={async () => {
                    try {
                      await navigator.clipboard.writeText(info.screenUrl);
                      setCopied(true);
                      setTimeout(() => setCopied(false), 2000);
                    } catch {
                      /* ignore */
                    }
                  }}
                >
                  <Copy className="ml-2 h-4 w-4" />
                  {copied ? "تم النسخ" : "نسخ الرابط"}
                </Button>
                <a
                  href={info.screenUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex flex-1 items-center justify-center gap-2 rounded-lg border border-slate-200 px-4 py-2 text-sm font-medium hover:bg-slate-50"
                >
                  <ExternalLink className="h-4 w-4" />
                  فتح الشاشة
                </a>
              </div>

              <Button
                type="button"
                className="w-full"
                onClick={() => {
                  const link = document.createElement("a");
                  link.download = `queue-screen-${info.clinicCode}.png`;
                  link.href = qrDataUrl;
                  link.click();
                }}
              >
                <Download className="ml-2 h-4 w-4" />
                تحميل الباركود (اختياري — للطباعة)
              </Button>

              {(() => {
                const parts = manualScreenUrlParts(info.screenUrl);
                return (
                  <div className="w-full rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-950">
                    <p className="mb-2 font-bold">تلفاز بدون باركود — 3 طرق</p>
                    <ol className="list-decimal space-y-2 pr-5 text-xs leading-relaxed">
                      <li>
                        <strong>HDMI (مُفضّل):</strong> من غرفة الانتظار اضغط «شاشة
                        المرضى» على حاسبة المحاسب → وصّل التلفاز بكابل HDMI → اختر
                        مدخل HDMI. لا كتابة ولا باركود.
                      </li>
                      <li>
                        <strong>واتساب للجوال:</strong> اضغط «نسخ الرابط» → أرسله لنفسك
                        على واتساب → افتحه من جوالك → اعرض الشاشة على التلفاز
                        (Miracast / Chromecast) إن وُجد.
                      </li>
                      <li>
                        <strong>كتابة يدوية</strong> (تلفاز فيه متصفح فقط): اكتب على
                        لوحة التلفاز:
                        <span
                          className="mt-1 block rounded bg-white px-2 py-1 font-mono text-[11px] text-slate-800"
                          dir="ltr"
                        >
                          https://{parts.hostPath}?clinic={parts.clinicCode}
                        </span>
                        أو على مرحلتين: العنوان ثم{" "}
                        <span className="font-mono">?clinic={parts.clinicCode}</span>
                      </li>
                    </ol>
                  </div>
                );
              })()}
            </div>
          ) : null}

          <Alert variant="info">
            <p className="text-xs leading-relaxed">
              <strong>ملاحظة:</strong> الشاشة العادية (بدون إنترنت) تحتاج لابتوب أو
              حاسبة موصولة بـ HDMI. التلفاز الذكي يحتاج فقط متصفح Chrome مفتوح على
              الرابط.
            </p>
          </Alert>

          <Button type="button" variant="outline" onClick={load} disabled={loading} className="w-full">
            <RefreshCw className={`ml-2 h-4 w-4 ${loading ? "animate-spin" : ""}`} />
            تحديث الباركود
          </Button>
        </div>
      </div>
    </div>
  );
}

/** زر يفتح نافذة إعداد شاشة التلفاز */
export function QueueScreenSetupButton({
  className,
  label = "ربط التلفاز",
}: {
  className?: string;
  label?: string;
}) {
  const [open, setOpen] = useState(false);

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className={className}
      >
        <QrCode className="h-4 w-4" />
        {label}
      </button>
      <QueueScreenSetupModal open={open} onClose={() => setOpen(false)} />
    </>
  );
}
