"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import QRCode from "qrcode";
import { Button } from "@/components/ui/Button";
import { Alert } from "@/components/ui/Alert";
import { Copy, Download, ExternalLink, QrCode, RefreshCw, Smartphone } from "lucide-react";
import { authPortalHeaders } from "@/lib/auth/api-portal";

interface QrInfo {
  clinicId: string;
  bookingCode: string;
  bookingUrl: string;
  clinicName: string;
  unreachableOnMobile?: boolean;
}

export function ClinicBookingQr() {
  const [info, setInfo] = useState<QrInfo | null>(null);
  const [qrDataUrl, setQrDataUrl] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const canvasRef = useRef<HTMLCanvasElement>(null);

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
      const res = await fetch(`/api/booking/qr${qs}`, {
        headers: authPortalHeaders("accountant"),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "تعذر تحميل باركود الحجز");
      setInfo(data);

      const dataUrl = await QRCode.toDataURL(data.bookingUrl, {
        width: 320,
        margin: 2,
        color: { dark: "#0f766e", light: "#ffffff" },
      });
      setQrDataUrl(dataUrl);
    } catch (e) {
      setError(e instanceof Error ? e.message : "تعذر تحميل باركود الحجز");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  async function downloadPng() {
    if (!qrDataUrl || !info) return;
    const link = document.createElement("a");
    link.download = `booking-qr-${info.bookingCode}.png`;
    link.href = qrDataUrl;
    link.click();
  }

  async function downloadPrintCard() {
    if (!qrDataUrl || !info || !canvasRef.current) return;

    const canvas = canvasRef.current;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const w = 400;
    const h = 520;
    canvas.width = w;
    canvas.height = h;

    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, w, h);

    ctx.fillStyle = "#0f766e";
    ctx.fillRect(0, 0, w, 72);

    ctx.fillStyle = "#ffffff";
    ctx.font = "bold 22px sans-serif";
    ctx.textAlign = "center";
    ctx.fillText("احجز موعدك أونلاين", w / 2, 32);
    ctx.font = "16px sans-serif";
    ctx.fillText(info.clinicName, w / 2, 58);

    const img = new Image();
    img.src = qrDataUrl;
    await new Promise<void>((resolve) => {
      img.onload = () => {
        ctx.drawImage(img, (w - 280) / 2, 96, 280, 280);
        resolve();
      };
    });

    ctx.fillStyle = "#334155";
    ctx.font = "14px sans-serif";
    ctx.fillText("امسح الباركود للحجز", w / 2, 400);
    ctx.font = "12px monospace";
    ctx.fillStyle = "#64748b";
    ctx.fillText(info.bookingCode, w / 2, 430);

    ctx.font = "11px sans-serif";
    ctx.fillStyle = "#94a3b8";
    const urlLines = info.bookingUrl.replace(/^https?:\/\//, "");
    ctx.fillText(urlLines, w / 2, 460);

    const link = document.createElement("a");
    link.download = `booking-card-${info.bookingCode}.png`;
    link.href = canvas.toDataURL("image/png");
    link.click();
  }

  return (
    <section className="mc-panel">
      <div className="mc-panel-head">
        <h2 className="mc-panel-title">
          <QrCode />
          باركود حجز العيادة
        </h2>
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={load}
          disabled={loading}
        >
          <RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} />
        </Button>
      </div>

      <div className="mc-panel-body">
        {error && <Alert variant="error" className="mb-4">{error}</Alert>}

        {info?.unreachableOnMobile && (
          <Alert variant="warning" className="mb-4">
            <p className="font-medium">الباركود لا يعمل على الموبايل بعد</p>
            <p className="mt-1 text-xs leading-relaxed">
              شغّل السيرفر بـ{" "}
              <span className="font-mono">npm run dev:lan</span> وتأكد أن
              الموبايل على نفس Wi‑Fi. أو ضع في{" "}
              <span className="font-mono">.env.local</span>:{" "}
              <span className="font-mono" dir="ltr">
                NEXT_PUBLIC_APP_URL=http://192.168.x.x:3000
              </span>
            </p>
          </Alert>
        )}

        {info && !info.unreachableOnMobile && (
          <Alert variant="info" className="mb-4">
            <p className="flex items-center gap-2 font-medium">
              <Smartphone className="h-4 w-4 shrink-0" />
              جاهز للموبايل — امسح الباركود من كاميرا الجوال
            </p>
          </Alert>
        )}

        {loading && !info ? (
          <div className="grid items-center gap-6 md:grid-cols-[280px_minmax(0,1fr)]">
            <div className="mc-skeleton mx-auto h-[280px] w-[280px] rounded-3xl" />
            <div className="space-y-3">
              <div className="mc-skeleton h-16 rounded-2xl" />
              <div className="mc-skeleton h-10 rounded-xl" />
              <div className="mc-skeleton h-10 rounded-xl" />
            </div>
          </div>
        ) : info && qrDataUrl ? (
          <div className="grid items-center gap-6 md:grid-cols-[auto_minmax(0,1fr)]">
            <div className="mx-auto rounded-3xl bg-mc-pearl p-2 shadow-gold ring-1 ring-inset ring-premium-300/60">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={qrDataUrl}
              alt="باركود الحجز"
              className="rounded-2xl bg-white p-3"
              width={280}
              height={280}
            />
            </div>

            <div className="min-w-0 space-y-4">
            <p className="text-sm leading-relaxed text-slate-muted">
              عند مسح هذا الباركود يُوجَّه المريض مباشرة لبوابة حجز عيادتك فقط.
            </p>

            <div className="w-full rounded-2xl border border-slate-border bg-surface p-4">
              <p className="text-[11px] font-bold uppercase tracking-wide text-premium-600">رمز العيادة</p>
              <p className="mt-0.5 font-mono text-xl font-black tracking-[0.2em] text-slate-text">
                {info.bookingCode}
              </p>
              <p className="mt-2 break-all rounded-lg bg-surface-card px-2.5 py-1.5 font-mono text-xs text-primary-700 ring-1 ring-inset ring-slate-border" dir="ltr">
                {info.bookingUrl}
              </p>
            </div>

            <div className="flex w-full flex-wrap gap-2">
              <Button
                type="button"
                variant="outline"
                className="touch-target"
                onClick={async () => {
                  try {
                    await navigator.clipboard.writeText(info.bookingUrl);
                    setCopied(true);
                    setTimeout(() => setCopied(false), 2000);
                  } catch {
                    /* ignore */
                  }
                }}
              >
                <Copy className="h-4 w-4" />
                {copied ? "تم النسخ" : "نسخ رابط الموبايل"}
              </Button>
              <a
                href={info.bookingUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="mc-btn-soft touch-target"
              >
                <ExternalLink className="h-4 w-4" />
                تجربة على الموبايل
              </a>
            </div>

            <div className="flex w-full flex-wrap gap-2 border-t border-slate-border pt-4">
              <Button type="button" onClick={downloadPng}>
                <Download className="h-4 w-4" />
                تحميل الباركود (PNG)
              </Button>
              <Button type="button" variant="premium" onClick={downloadPrintCard}>
                <Download className="h-4 w-4" />
                تحميل كارت للطباعة
              </Button>
            </div>
            </div>
          </div>
        ) : !loading && !error ? (
          <p className="py-8 text-center text-sm text-slate-muted">
            لم يُحمَّل الباركود. اضغط تحديث أو أعد تحميل الصفحة.
          </p>
        ) : null}

        <canvas ref={canvasRef} className="hidden" />
      </div>
    </section>
  );
}
