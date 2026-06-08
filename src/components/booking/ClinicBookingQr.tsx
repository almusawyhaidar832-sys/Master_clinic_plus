"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import QRCode from "qrcode";
import { Button } from "@/components/ui/Button";
import { Alert } from "@/components/ui/Alert";
import { Card, CardHeader, CardTitle } from "@/components/ui/Card";
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
    <Card>
      <CardHeader className="flex flex-row items-center justify-between gap-2">
        <CardTitle className="flex items-center gap-2">
          <QrCode className="h-5 w-5 text-teal-600" />
          باركود حجز العيادة
        </CardTitle>
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={load}
          disabled={loading}
        >
          <RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} />
        </Button>
      </CardHeader>

      <div className="p-4 pt-0">
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
          <div className="flex h-64 items-center justify-center">
            <RefreshCw className="h-8 w-8 animate-spin text-teal-600" />
          </div>
        ) : info && qrDataUrl ? (
          <div className="flex flex-col items-center gap-4">
            <p className="text-center text-sm text-slate-muted">
              عند مسح هذا الباركود يُوجَّه المريض مباشرة لبوابة حجز عيادتك فقط.
            </p>

            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={qrDataUrl}
              alt="باركود الحجز"
              className="rounded-xl border border-slate-200 bg-white p-3 shadow-sm"
              width={280}
              height={280}
            />

            <div className="w-full rounded-lg bg-slate-50 p-3 text-center">
              <p className="text-xs text-slate-muted">رمز العيادة</p>
              <p className="font-mono text-lg font-bold tracking-widest text-teal-700">
                {info.bookingCode}
              </p>
              <p className="mt-2 break-all text-sm text-teal-800" dir="ltr">
                {info.bookingUrl}
              </p>
            </div>

            <div className="flex w-full flex-wrap justify-center gap-2">
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
                <Copy className="ml-2 h-4 w-4" />
                {copied ? "تم النسخ" : "نسخ رابط الموبايل"}
              </Button>
              <a
                href={info.bookingUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="touch-target inline-flex items-center justify-center gap-2 rounded-lg border border-slate-border bg-surface-card px-4 py-2 text-sm font-medium text-slate-text hover:bg-surface"
              >
                <ExternalLink className="h-4 w-4" />
                تجربة على الموبايل
              </a>
            </div>

            <div className="flex w-full flex-wrap justify-center gap-2">
              <Button type="button" onClick={downloadPng}>
                <Download className="ml-2 h-4 w-4" />
                تحميل الباركود (PNG)
              </Button>
              <Button type="button" variant="outline" onClick={downloadPrintCard}>
                <Download className="ml-2 h-4 w-4" />
                تحميل كارت للطباعة
              </Button>
            </div>
          </div>
        ) : !loading && !error ? (
          <p className="py-8 text-center text-sm text-slate-muted">
            لم يُحمَّل الباركود. اضغط تحديث أو أعد تحميل الصفحة.
          </p>
        ) : null}

        <canvas ref={canvasRef} className="hidden" />
      </div>
    </Card>
  );
}
