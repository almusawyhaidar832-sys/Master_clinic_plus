"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Card, CardHeader, CardTitle } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { Alert } from "@/components/ui/Alert";
import { createClient } from "@/lib/supabase/client";
import { getClinicIdFromProfile } from "@/lib/clinic-context";
import { authPortalHeaders } from "@/lib/auth/api-portal";
import { QrCode, MessageCircle, RefreshCw, Wifi, WifiOff, Wrench } from "lucide-react";
import { WhatsAppTestButton } from "@/components/patients/WhatsAppTestButton";
import { WhatsAppRailwayHandoff } from "@/components/patients/WhatsAppRailwayHandoff";

type ConnState = "open" | "close" | "connecting" | "unknown";

export default function WhatsAppSettingsPage() {
  const [linked, setLinked] = useState(false);
  const [connState, setConnState] = useState<ConnState>("unknown");
  const [qrImage, setQrImage] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [instanceName, setInstanceName] = useState<string | null>(null);
  const [linkedPhoneDisplay, setLinkedPhoneDisplay] = useState<string | null>(
    null
  );
  const [linkedProfileName, setLinkedProfileName] = useState<string | null>(
    null
  );
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const qrRefreshRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const [bridgeConfigured, setBridgeConfigured] = useState<boolean | null>(
    null
  );
  const [repairMessage, setRepairMessage] = useState<string | null>(null);
  const [healthReport, setHealthReport] = useState<{
    diagnosisAr: string;
    fixSteps: string[];
    railwayMessage?: string;
    zombieRisk?: boolean;
  } | null>(null);
  const [healthLoading, setHealthLoading] = useState(false);
  const [evolutionPublicUrl, setEvolutionPublicUrl] = useState<string | null>(
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

  const applyStatusPayload = useCallback(
    (data: {
      linked?: boolean;
      state?: ConnState;
      instanceName?: string;
      linkedPhoneDisplay?: string | null;
      profileName?: string | null;
      evolutionPublicUrl?: string | null;
    }) => {
      if (typeof data.state === "string") {
        setConnState(data.state as ConnState);
      }
      if (data.instanceName) setInstanceName(data.instanceName);
      if (typeof data.evolutionPublicUrl === "string") {
        setEvolutionPublicUrl(data.evolutionPublicUrl);
      }
      if (data.linked) {
        setLinkedPhoneDisplay(data.linkedPhoneDisplay?.trim() || null);
        setLinkedProfileName(data.profileName?.trim() || null);
      } else {
        setLinkedPhoneDisplay(null);
        setLinkedProfileName(null);
      }
    },
    []
  );

  const whatsappFetch = useCallback(
    (path: string, init?: RequestInit) =>
      fetch(path, {
        ...init,
        credentials: "include",
        headers: {
          ...authPortalHeaders("accountant"),
          ...(init?.headers as Record<string, string> | undefined),
        },
      }),
    []
  );

  const checkConnection = useCallback(async (): Promise<boolean | null> => {
    try {
      const res = await whatsappFetch("/api/whatsapp/status");
      const data = await res.json();
      if (typeof data.configured === "boolean") {
        setBridgeConfigured(data.configured);
      }
      applyStatusPayload(data);
      const state = (data.state as ConnState) ?? "unknown";
      if (data.linked) {
        setLinked(true);
        setQrImage(null);
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
  }, [applyStatusPayload, whatsappFetch]);

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
      const res = await whatsappFetch("/api/whatsapp/qr");
      const data = await res.json();

      if (typeof data.configured === "boolean") {
        setBridgeConfigured(data.configured);
      }
      if (data.instanceName) setInstanceName(data.instanceName);
      applyStatusPayload(data);

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
  }, [checkConnection, stopPolling, applyStatusPayload, whatsappFetch]);

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
      const res = await whatsappFetch("/api/whatsapp/restart", { method: "POST" });
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
      setLinkedPhoneDisplay(null);
      setLinkedProfileName(null);
      await startScan();
    } catch {
      setError("تعذر الاتصال بالجسر");
    }
    setLoading(false);
  }, [startScan, stopPolling]);

  const runAutoRepair = useCallback(async () => {
    setLoading(true);
    setError(null);
    setRepairMessage(null);
    stopPolling();
    try {
      const res = await whatsappFetch("/api/whatsapp/auto-repair", {
        method: "POST",
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? data.message ?? "تعذر الإصلاح التلقائي");
        setLoading(false);
        return;
      }

      const deleted =
        Array.isArray(data.deletedInstances) && data.deletedInstances.length > 0
          ? `حُذفت ${data.deletedInstances.length} جلسة زائدة. `
          : "";
      setRepairMessage(`${deleted}${data.message ?? "تم الإصلاح"}`);

      if (data.instanceName) setInstanceName(data.instanceName);

      if (data.linked) {
        setLinked(true);
        setConnState("open");
        setQrImage(null);
        startLinkedKeepalive();
        void loadMessageLog();
      } else if (data.qr) {
        const src =
          typeof data.qr === "string" && data.qr.startsWith("data:")
            ? data.qr
            : typeof data.qr === "string"
              ? `data:image/png;base64,${data.qr}`
              : null;
        setQrImage(src);
        setLinked(false);
        setConnState("connecting");
        await startScan();
      } else if (data.error) {
        setError(data.error);
      }
    } catch {
      setError("تعذر الاتصال بالخادم أثناء الإصلاح");
    }
    setLoading(false);
  }, [
    whatsappFetch,
    stopPolling,
    startScan,
    startLinkedKeepalive,
    loadMessageLog,
  ]);

  const runHealthCheck = useCallback(async () => {
    setHealthLoading(true);
    setHealthReport(null);
    try {
      const res = await whatsappFetch("/api/whatsapp/health");
      const data = await res.json();
      setHealthReport({
        diagnosisAr: data.diagnosisAr ?? "تعذر الفحص",
        fixSteps: Array.isArray(data.fixSteps) ? data.fixSteps : [],
        railwayMessage: data.railwayMessage,
        zombieRisk: data.zombieRisk,
      });
    } catch {
      setHealthReport({
        diagnosisAr: "تعذر الاتصال بفحص واتساب",
        fixSteps: [],
      });
    }
    setHealthLoading(false);
  }, [whatsappFetch]);

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
    appointment_created: "حجز موعد جديد",
    appointment_accepted: "قبول موعد",
    appointment_rejected: "رفض موعد",
    appointment_modified: "تعديل موعد",
    appointment_submitted: "طلب حجز",
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

      <Card className="border-amber-200 bg-amber-50/80">
        <CardHeader>
          <CardTitle className="text-base text-amber-950">
            إصلاح واتساب تلقائياً
          </CardTitle>
          <p className="text-sm text-amber-900/90">
            يحذف الجلسات الزائدة ويعيد ضبط الربط —{" "}
            <strong>تحتاج فقط مسح QR مرة واحدة</strong> من جوال العيادة.
          </p>
        </CardHeader>
        <div className="px-4 pb-4">
          {repairMessage && (
            <Alert variant="success" className="mb-3">
              {repairMessage}
            </Alert>
          )}
          <Button
            type="button"
            className="w-full bg-amber-700 hover:bg-amber-800"
            disabled={loading}
            onClick={runAutoRepair}
          >
            {loading ? (
              <>
                <RefreshCw className="h-4 w-4 animate-spin" />
                جاري الإصلاح...
              </>
            ) : (
              <>
                <Wrench className="h-4 w-4" />
                إصلاح واتساب الآن (خطوتين فقط)
              </>
            )}
          </Button>
          <ol className="mt-3 list-decimal space-y-1 pr-5 text-xs text-amber-950/80">
            <li>اضغط الزر أعلاه وانتظر 10–20 ثانية</li>
            <li>امسح QR من واتسapp جوال العيادة (07770010105)</li>
          </ol>
        </div>
      </Card>

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
          {linked && linkedPhoneDisplay && (
            <div className="mx-auto mt-3 max-w-sm rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm">
              <p className="font-semibold text-emerald-900">الرقم المربوط</p>
              <p className="mt-1 text-lg font-bold tracking-wide text-emerald-800" dir="ltr">
                {linkedPhoneDisplay}
              </p>
              {linkedProfileName && (
                <p className="mt-1 text-xs text-emerald-700">{linkedProfileName}</p>
              )}
              <p className="mt-2 text-xs text-emerald-700">
                رسائل الحجز تُرسل من هذا الرقم — تأكد أنه واتساب العيادة الصحيح
              </p>
            </div>
          )}
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

      <WhatsAppTestButton portal="accountant" />

      <Card className="border-slate-border bg-surface/60">
        <CardHeader>
          <CardTitle className="text-base">فحص شامل للسيرفر</CardTitle>
          <p className="text-sm text-slate-muted">
            يفحص Evolution على Railway بدون إرسال رسالة — يوضح إن كانت الجلسة
            «متصلة ظاهرياً» لكن معطّلة (zombie).
          </p>
        </CardHeader>
        <div className="space-y-3 px-4 pb-4">
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={healthLoading}
            onClick={() => void runHealthCheck()}
          >
            {healthLoading ? (
              <>
                <RefreshCw className="h-4 w-4 animate-spin" />
                جاري الفحص...
              </>
            ) : (
              "فحص شامل"
            )}
          </Button>
          {healthReport && (
            <Alert variant={healthReport.zombieRisk ? "error" : "info"}>
              <p className="font-semibold">{healthReport.diagnosisAr}</p>
              {healthReport.fixSteps.length > 0 && (
                <ol className="mt-2 list-decimal space-y-1 pr-5 text-sm">
                  {healthReport.fixSteps.map((step) => (
                    <li key={step}>{step}</li>
                  ))}
                </ol>
              )}
            </Alert>
          )}
        </div>
      </Card>

      <WhatsAppRailwayHandoff serverUrl={evolutionPublicUrl} />

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
