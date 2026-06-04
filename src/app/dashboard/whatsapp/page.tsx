"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Card, CardHeader, CardTitle } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { Alert } from "@/components/ui/Alert";
import { createClient } from "@/lib/supabase/client";
import { getClinicIdFromProfile } from "@/lib/clinic-context";
import { QrCode, MessageCircle, RefreshCw, Wifi, WifiOff } from "lucide-react";

type ConnState = "open" | "close" | "connecting" | "unknown";

export default function WhatsAppSettingsPage() {
  const [linked, setLinked] = useState(false);
  const [connState, setConnState] = useState<ConnState>("unknown");
  const [qrImage, setQrImage] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [instanceName, setInstanceName] = useState<string | null>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const qrRefreshRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const [bridgeConfigured, setBridgeConfigured] = useState<boolean | null>(
    null
  );
  const [messages, setMessages] = useState<
    {
      id: string;
      message_type: string;
      recipient_phone: string;
      status: string;
      created_at: string;
    }[]
  >([]);

  /** سجل الرسائل فقط — حالة الربط تُحدَّث من Evolution API وليس من DB (تجنّب الوميض). */
  const loadMessageLog = useCallback(async () => {
    const supabase = createClient();
    const clinicId = await getClinicIdFromProfile(supabase);
    if (!clinicId) return;

    const { data: clinic } = await supabase
      .from("clinics")
      .select("whatsapp_session_id")
      .eq("id", clinicId)
      .maybeSingle();
    if (clinic?.whatsapp_session_id) {
      setInstanceName(clinic.whatsapp_session_id as string);
    }

    const { data: logs } = await supabase
      .from("whatsapp_messages")
      .select("id, message_type, recipient_phone, status, created_at")
      .order("created_at", { ascending: false })
      .limit(10);
    setMessages(logs ?? []);
  }, []);

  const checkConnection = useCallback(async (): Promise<boolean | null> => {
    try {
      const res = await fetch("/api/whatsapp/status");
      const data = await res.json();
      if (typeof data.configured === "boolean") {
        setBridgeConfigured(data.configured);
      }
      const state = (data.state as ConnState) ?? "unknown";
      setConnState(state);
      if (data.linked) {
        setLinked(true);
        setQrImage(null);
        if (data.instanceName) setInstanceName(data.instanceName);
        return true;
      }
      if (state === "connecting") {
        return false;
      }
      setLinked(false);
      return false;
    } catch {
      return null;
    }
  }, []);

  const stopPolling = useCallback(() => {
    if (pollRef.current) {
      clearInterval(pollRef.current);
      pollRef.current = null;
    }
    if (qrRefreshRef.current) {
      clearInterval(qrRefreshRef.current);
      qrRefreshRef.current = null;
    }
  }, []);

  const fetchQr = useCallback(async () => {
    const status = await checkConnection();
    if (status === true) {
      stopPolling();
      return;
    }
    if (status === null) {
      setError("تعذر قراءة حالة الاتصال — أعد المحاولة");
      return;
    }

    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/whatsapp/qr");
      const data = await res.json();

      if (typeof data.configured === "boolean") {
        setBridgeConfigured(data.configured);
      }
      if (data.instanceName) setInstanceName(data.instanceName);

      if (data.linked) {
        setLinked(true);
        setQrImage(null);
        setConnState("open");
        stopPolling();
        setLoading(false);
        return;
      }

      if (data.error || data.message) {
        setError(data.error ?? data.message);
      }

      if (data.qr) {
        const src =
          typeof data.qr === "string" && data.qr.startsWith("data:")
            ? data.qr
            : typeof data.qr === "string"
              ? `data:image/png;base64,${data.qr}`
              : null;
        setQrImage(src);
        setConnState((data.state as ConnState) ?? "connecting");
      } else if (!data.linked) {
        setError(
          (prev) =>
            prev ??
            "لم يُرجع الجسر رمز QR — تأكد أن Evolution API يعمل وأن المفتاح صحيح"
        );
      }
    } catch {
      setError("تعذر الاتصال بجسر الواتساب — تحقق من WHATSAPP_API_URL");
    }
    setLoading(false);
  }, [checkConnection, stopPolling]);

  const startLinkedKeepalive = useCallback(() => {
    stopPolling();
    pollRef.current = setInterval(() => {
      void checkConnection();
    }, 30000);
  }, [checkConnection, stopPolling]);

  const startScan = useCallback(async () => {
    stopPolling();
    await fetchQr();
    pollRef.current = setInterval(async () => {
      const ok = await checkConnection();
      if (ok) {
        stopPolling();
        startLinkedKeepalive();
        void loadMessageLog();
      }
    }, 4000);
    qrRefreshRef.current = setInterval(async () => {
      const ok = await checkConnection();
      if (ok) {
        stopPolling();
        startLinkedKeepalive();
        return;
      }
      void fetchQr();
    }, 15000);
  }, [
    fetchQr,
    checkConnection,
    loadMessageLog,
    stopPolling,
    startLinkedKeepalive,
  ]);

  const restartSession = useCallback(async () => {
    setLoading(true);
    setError(null);
    stopPolling();
    try {
      const res = await fetch("/api/whatsapp/restart", { method: "POST" });
      const data = await res.json();
      if (!res.ok) {
        setError(data.message ?? "تعذر إعادة ضبط الجلسة");
        setLoading(false);
        return;
      }
      if (data.qr) {
        const src =
          typeof data.qr === "string" && data.qr.startsWith("data:")
            ? data.qr
            : `data:image/png;base64,${data.qr}`;
        setQrImage(src);
        setConnState("connecting");
      }
      setLinked(false);
      await startScan();
    } catch {
      setError("تعذر الاتصال بالجسر");
    }
    setLoading(false);
  }, [startScan, stopPolling]);

  useEffect(() => {
    void loadMessageLog();
    void checkConnection().then((connected) => {
      if (connected) startLinkedKeepalive();
      else void startScan();
    });
    return () => stopPolling();
  }, [loadMessageLog, checkConnection, startScan, startLinkedKeepalive, stopPolling]);

  const typeLabels: Record<string, string> = {
    appointment_confirmation: "تأكيد موعد",
    payment_receipt: "إيصال دفع",
    test_notification: "رسالة تجريبية",
  };

  const stateLabel: Record<ConnState, string> = {
    open: "متصل",
    close: "غير متصل",
    connecting: "بانتظار مسح QR",
    unknown: "غير معروف",
  };

  return (
    <div className="mx-auto max-w-lg space-y-6">
      <div>
        <h2 className="text-2xl font-bold text-slate-text">ربط واتساب</h2>
        <p className="text-slate-muted">
          Evolution API (Baileys) — امسح QR من تطبيق واتساب على جوال العيادة
        </p>
      </div>

      <Card className="text-center">
        <CardHeader>
          <div className="mx-auto mb-4 flex h-20 w-20 items-center justify-center rounded-2xl bg-green-50">
            <MessageCircle className="h-10 w-10 text-green-600" />
          </div>
          <CardTitle>
            {linked ? "واتساب مربوط ✓" : "امسح رمز QR من تطبيق واتساب"}
          </CardTitle>
          <p className="mt-2 flex items-center justify-center gap-2 text-sm text-slate-muted">
            {linked ? (
              <Wifi className="h-4 w-4 text-emerald-600" />
            ) : (
              <WifiOff className="h-4 w-4" />
            )}
            الحالة: {stateLabel[connState]}
            {instanceName && (
              <span className="text-xs" dir="ltr">
                ({instanceName})
              </span>
            )}
          </p>
        </CardHeader>

        {error && (
          <div className="mb-4 px-4">
            <Alert variant="error">{error}</Alert>
          </div>
        )}

        {!linked && (
          <div className="mb-6 flex flex-col items-center gap-2 px-4">
            {qrImage ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={qrImage}
                alt="رمز QR للربط — WhatsApp"
                className="h-56 w-56 rounded-xl border-2 border-green-200 bg-white p-2 shadow-md"
              />
            ) : (
              <div className="flex h-56 w-56 items-center justify-center rounded-xl border-2 border-dashed border-slate-border bg-surface">
                <QrCode className="h-24 w-24 text-slate-muted" />
              </div>
            )}
            <p className="text-xs text-slate-muted max-w-xs">
              واتساب → الإعدادات → الأجهزة المرتبطة → ربط جهاز. يتجدد الرمز
              كل 15 ثانية — امسح خلال 20 ثانية.
            </p>
          </div>
        )}

        <div className="flex flex-col gap-2 px-4 pb-4">
          <Button
            onClick={linked ? restartSession : startScan}
            disabled={loading}
            className="w-full"
          >
            {loading ? (
              <>
                <RefreshCw className="h-4 w-4 animate-spin" />
                جاري التحميل...
              </>
            ) : linked ? (
              "إعادة الربط (QR جديد)"
            ) : (
              "عرض رمز QR"
            )}
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={checkConnection}
            disabled={loading}
          >
            تحديث حالة الاتصال
          </Button>
          {!linked && (
            <Button
              variant="outline"
              size="sm"
              onClick={restartSession}
              disabled={loading}
              className="text-amber-800 border-amber-300"
            >
              QR جديد (بعد خطأ الربط)
            </Button>
          )}
        </div>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">
            خطأ «Couldn&apos;t link device» على الجوال؟
          </CardTitle>
        </CardHeader>
        <ul className="list-disc space-y-2 pr-5 text-sm text-slate-muted">
          <li>
            اضغط <strong>QR جديد (بعد خطأ الربط)</strong> ثم امسح فوراً — لا
            تنتظر دقيقة.
          </li>
          <li>
            على الجوال: احذف جهازاً قديماً من «الأجهزة المرتبطة» إن وصلت
            للحد (4 أجهزة).
          </li>
          <li>حدّث تطبيق واتساب من المتجر، واستخدم نفس شبكة Wi‑Fi أو 4G مستقرة.</li>
          <li>
            في Railway (مشروع Evolution): اترك{" "}
            <code dir="ltr">CONFIG_SESSION_PHONE_VERSION</code> فارغاً، وحدّث
            الصورة إلى <code dir="ltr">evoapicloud/evolution-api:v2.3.6</code>{" "}
            أو أحدث.
          </li>
          <li>
            تأكد <code dir="ltr">SERVER_URL</code> في Evolution = نفس رابط
            Railway العام للجسر.
          </li>
        </ul>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>رسائل تلقائية (عربي)</CardTitle>
        </CardHeader>
        <ul className="space-y-3 text-sm text-slate-muted">
          <li className="rounded-lg bg-surface p-3">
            <strong className="text-slate-text">تأكيد الموعد:</strong> التاريخ،
            الوقت، اسم الطبيب
          </li>
          <li className="rounded-lg bg-surface p-3">
            <strong className="text-slate-text">إيصال دفع:</strong> المبلغ
            المدفوع + شكر —{" "}
            <span className="text-debt-text">بدون ذكر متبقي أو ديون</span>
          </li>
        </ul>
      </Card>

      {messages.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>آخر الرسائل</CardTitle>
          </CardHeader>
          <ul className="space-y-2 text-sm">
            {messages.map((m) => (
              <li
                key={m.id}
                className="flex justify-between border-b border-slate-border/40 py-2"
              >
                <span>
                  {typeLabels[m.message_type] ?? m.message_type}
                  <br />
                  <span className="text-xs" dir="ltr">
                    {m.recipient_phone}
                  </span>
                </span>
                <span className="text-xs text-slate-muted">{m.status}</span>
              </li>
            ))}
          </ul>
        </Card>
      )}

      {bridgeConfigured === false && (
        <Alert variant="error">
          <strong>الجسر غير مُضبّط على سيرفر التطبيق.</strong>
          <br />
          إذا تفتح الموقع من Railway: ادخل مشروع Next.js → Variables وأضف
          WHATSAPP_API_URL و WHATSAPP_API_KEY (نفس قيم Evolution) ثم Redeploy.
          <br />
          محلياً: ضعها في <code className="text-xs">.env.local</code> وأعد{" "}
          <code className="text-xs">npm run dev</code>.
        </Alert>
      )}

      {bridgeConfigured === true && !qrImage && !linked && !loading && (
        <Alert variant="info">
          اضغط «عرض رمز QR» إذا لم يظهر الرمز تلقائياً. تأكد أن سيرفر Evolution
          على Railway يعمل (الرابط ينتهي بـ .up.railway.app).
        </Alert>
      )}

      {bridgeConfigured === true && (
        <p className="text-center text-xs text-emerald-700">
          ✓ متغيرات الواتساب مُحمّلة — الجسر: {instanceName ?? "master_clinic"}
        </p>
      )}
    </div>
  );
}
