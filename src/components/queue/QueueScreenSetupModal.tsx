"use client";

import { useCallback, useEffect, useState } from "react";
import QRCode from "qrcode";
import { Alert } from "@/components/ui/Alert";
import { Modal } from "@/components/ui/Modal";
import { Check, Copy, Download, ExternalLink, Monitor, QrCode, RefreshCw, Tv } from "lucide-react";
import { authPortalHeaders } from "@/lib/auth/api-portal";

interface ScreenQrInfo {
  clinicId: string;
  clinicCode: string;
  screenUrl: string;
  clinicName: string;
  unreachableOnMobile?: boolean;
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
        color: { dark: "#0e446b", light: "#ffffff" },
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
    <Modal
      onClose={onClose}
      title="ربط شاشة التلفاز"
      subtitle="شاشة الانتظار · Queue screen"
      icon={Monitor}
      size="md"
    >
        <div className="space-y-4">
          <div className="rounded-2xl border border-slate-border bg-surface p-4">
            <p className="text-sm leading-relaxed text-slate-text">
              <strong>الباركود للجوال فقط</strong> — التلفاز ما يحتاج كاميرا. على شاشة
              العيادة: افتح Chrome واكتب رمز العيادة (أو استخدم HDMI).
            </p>

            <ol className="mt-3 list-decimal space-y-1.5 ps-5 text-sm text-slate-muted marker:font-bold marker:text-premium-500">
              <li>افتح <strong>Chrome</strong> على تلفاز العيادة</li>
              <li>اكتب <span className="font-mono">/queue-screen</span> وادخل رمز العيادة</li>
              <li>
                <strong>مرة واحدة فقط</strong> — يُحفظ الرمز ويفتح تلقائياً كل يوم
              </li>
              <li>من Chrome: <strong>تثبيت التطبيق</strong> → إضافة للشاشة الرئيسية</li>
            </ol>
          </div>

          {error && <Alert variant="error">{error}</Alert>}

          {loading && !info ? (
            <div className="flex flex-col items-center gap-3">
              <div className="mc-skeleton h-[264px] w-[264px] rounded-2xl" />
              <div className="mc-skeleton h-24 w-full rounded-2xl" />
            </div>
          ) : info && qrDataUrl ? (
            <div className="flex flex-col items-center gap-3">
              <div className="rounded-3xl bg-mc-pearl p-2 shadow-gold ring-1 ring-inset ring-premium-300/60">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={qrDataUrl}
                  alt="باركود شاشة الانتظار"
                  className="rounded-2xl bg-white p-3"
                  width={240}
                  height={240}
                />
              </div>

              <div className="relative w-full overflow-hidden rounded-2xl bg-mc-navy p-4 text-center text-white shadow-soft">
                <p className="text-[11px] font-semibold uppercase tracking-[0.12em] text-premium-300">
                  رمز عيادتك — اكتبه على تلفاز Chrome
                </p>
                <p className="mt-1 font-mono text-3xl font-black tracking-[0.2em] text-premium-200" dir="ltr">
                  {info.clinicCode}
                </p>
                <p className="mt-2 text-xs text-white/75">
                  على التلفاز: افتح{" "}
                  <span className="font-mono text-white" dir="ltr">
                    /queue-screen
                  </span>{" "}
                  ثم أدخل هذا الرمز
                </p>
                <p className="mt-2 break-all rounded-lg bg-white/10 px-2 py-1 text-[11px] text-white/80" dir="ltr">
                  {info.screenUrl}
                </p>
              </div>

              <div className="grid w-full grid-cols-2 gap-2">
                <button
                  type="button"
                  className="mc-btn-soft"
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
                  {copied ? <Check className="h-4 w-4 text-success-text" /> : <Copy className="h-4 w-4 text-premium-500" />}
                  {copied ? "تم النسخ" : "نسخ الرابط"}
                </button>
                <a
                  href={info.screenUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="mc-btn-soft"
                >
                  <ExternalLink className="h-4 w-4 text-premium-500" />
                  فتح الشاشة
                </a>
              </div>

              <button
                type="button"
                className="mc-btn-navy w-full py-2.5"
                onClick={() => {
                  const link = document.createElement("a");
                  link.download = `queue-screen-${info.clinicCode}.png`;
                  link.href = qrDataUrl;
                  link.click();
                }}
              >
                <Download className="h-4 w-4" />
                تحميل الباركود (اختياري — للطباعة)
              </button>

              <div className="w-full rounded-2xl border border-warning-border bg-warning p-4 text-sm text-warning-text">
                    <p className="mb-2 flex items-center gap-1.5 font-bold">
                      <Tv className="h-4 w-4" />
                      تلفاز Chrome بدون كاميرا
                    </p>
                    <ol className="list-decimal space-y-2 ps-5 text-xs leading-relaxed">
                      <li>
                        <strong>من Chrome على التلفاز (بدون كاميرا):</strong> اكتب عنوان
                        الموقع ثم <span className="font-mono">/queue-screen</span> — تظهر
                        صفحة تطلب <strong>رمز العيادة</strong> أعلاه (
                        <span className="font-mono">{info.clinicCode}</span>) — تفتح شاشة
                        <strong> عيادتك فقط</strong>.
                      </li>
                      <li>
                        <strong>HDMI:</strong> من المحاسب اضغط «شاشة المرضى» → وصّل
                        التلفاز بكابل HDMI.
                      </li>
                      <li>
                        <strong>باركود (اختياري):</strong> يُمسح من <strong>جوال</strong> مو
                        من التلفاز — ثم يفتح الرابط على الجوال أو التلفاز.
                      </li>
                    </ol>
                  </div>
            </div>
          ) : null}

          <Alert variant="info">
            <p className="text-xs leading-relaxed">
              <strong>ملاحظة:</strong> الشاشة العادية (بدون إنترنت) تحتاج لابتوب أو
              حاسبة موصولة بـ HDMI. التلفاز الذكي يحتاج فقط متصفح Chrome مفتوح على
              الرابط.
            </p>
          </Alert>

          <button type="button" onClick={load} disabled={loading} className="mc-btn-soft w-full py-2.5">
            <RefreshCw className={`h-4 w-4 text-premium-500 ${loading ? "animate-spin" : ""}`} />
            تحديث الباركود
          </button>
        </div>
    </Modal>
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
