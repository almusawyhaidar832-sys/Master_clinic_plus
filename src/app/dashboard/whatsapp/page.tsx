"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/Button";
import { Alert } from "@/components/ui/Alert";
import { PageHeader } from "@/components/ui/PageHeader";
import { useLanguage } from "@/contexts/LanguageContext";
import { cn } from "@/lib/utils";
import { createClient } from "@/lib/supabase/client";
import { getClinicIdFromProfile } from "@/lib/clinic-context";
import { authPortalHeaders } from "@/lib/auth/api-portal";
import {
  QrCode,
  MessageCircle,
  RefreshCw,
  Wifi,
  WifiOff,
  Wrench,
  Stethoscope,
  LifeBuoy,
  Sparkles,
  Send,
} from "lucide-react";
import { WhatsAppTestButton } from "@/components/patients/WhatsAppTestButton";
import { WhatsAppRailwayHandoff } from "@/components/patients/WhatsAppRailwayHandoff";

type ConnState = "open" | "close" | "connecting" | "unknown";

export default function WhatsAppSettingsPage() {
  const { bi } = useLanguage();
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
    <div className="mx-auto max-w-6xl space-y-6">
      <PageHeader
        eyebrow={bi("التكاملات", "Integrations")}
        title="ربط واتساب"
        subtitle="Evolution API (Baileys) — امسح QR من تطبيق واتساب على جوال العيادة"
        icon={MessageCircle}
        className="mb-0"
        actions={
          <span
            className={cn(
              "inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-bold ring-1 ring-inset",
              linked
                ? "bg-success text-success-text ring-success-border"
                : connState === "connecting"
                  ? "bg-warning text-warning-text ring-warning-border"
                  : "bg-surface text-slate-muted ring-slate-border"
            )}
          >
            {linked ? <Wifi className="h-3.5 w-3.5" /> : <WifiOff className="h-3.5 w-3.5" />}
            {stateLabel[connState]}
          </span>
        }
      />

      <div className="grid items-start gap-5 lg:grid-cols-[minmax(0,1fr)_380px]">
      <div className="min-w-0 space-y-5">

      <section className="mc-panel">
        <div className="mc-panel-head">
          <h3 className="mc-panel-title">
            <QrCode />
            {bi("حالة الربط", "Connection status")}
          </h3>
          {instanceName && (
            <span className="rounded-md bg-surface px-2 py-0.5 font-mono text-[11px] text-slate-muted ring-1 ring-inset ring-slate-border" dir="ltr">
              ({instanceName})
            </span>
          )}
        </div>
        <div className="mc-panel-body text-center">
          <div
            className={cn(
              "mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-2xl ring-1 ring-inset",
              linked
                ? "bg-success text-success-text ring-success-border"
                : "bg-surface text-slate-muted ring-slate-border"
            )}
          >
            <MessageCircle className="h-8 w-8" />
          </div>
          <h4 className="text-lg font-bold text-slate-text">
            {linked ? "واتساب مربوط ✓" : "امسح رمز QR من تطبيق واتساب"}
          </h4>
          <p className="mt-2 flex items-center justify-center gap-2 text-sm text-slate-muted">
            {linked ? (
              <Wifi className="h-4 w-4 text-success-text" />
            ) : (
              <WifiOff className="h-4 w-4" />
            )}
            الحالة: {stateLabel[connState]}
          </p>
          {linked && linkedPhoneDisplay && (
            <div className="mx-auto mt-4 max-w-sm rounded-2xl border border-success-border bg-success px-4 py-3 text-sm text-success-text">
              <p className="font-semibold">الرقم المربوط</p>
              <p className="mt-1 text-xl font-black tracking-wide tabular-nums" dir="ltr">
                {linkedPhoneDisplay}
              </p>
              {linkedProfileName && (
                <p className="mt-1 text-xs opacity-90">{linkedProfileName}</p>
              )}
              <p className="mt-2 text-xs opacity-90">
                رسائل الحجز تُرسل من هذا الرقم — تأكد أنه واتساب العيادة الصحيح
              </p>
            </div>
          )}

        {error && (
          <div className="mt-4 text-start">
            <Alert variant="error">{error}</Alert>
          </div>
        )}

        {!linked && (
          <div className="mt-5 flex flex-col items-center gap-3">
            {qrImage ? (
              <div className="rounded-3xl bg-mc-pearl p-2 shadow-gold ring-1 ring-inset ring-premium-300/60">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={qrImage}
                alt="رمز QR للربط — WhatsApp"
                className="h-56 w-56 rounded-2xl bg-white p-2"
              />
              </div>
            ) : (
              <div className="flex h-56 w-56 items-center justify-center rounded-3xl border-2 border-dashed border-slate-border bg-surface">
                <QrCode className="h-24 w-24 text-slate-muted" strokeWidth={1.2} />
              </div>
            )}
            <p className="max-w-xs text-xs leading-relaxed text-slate-muted">
              واتساب → الإعدادات → الأجهزة المرتبطة → ربط جهاز. يتجدد الرمز
              كل 15 ثانية — امسح خلال 20 ثانية.
            </p>
          </div>
        )}
        </div>

        <div className="flex flex-col gap-2 border-t border-slate-border bg-surface px-5 py-4 sm:flex-row sm:flex-wrap">
          <Button
            onClick={linked ? restartSession : startScan}
            disabled={loading}
            className="w-full sm:flex-1"
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
            onClick={checkConnection}
            disabled={loading}
          >
            تحديث حالة الاتصال
          </Button>
          {!linked && (
            <Button
              variant="outline"
              onClick={restartSession}
              disabled={loading}
              className="text-warning-text hover:border-warning-border hover:bg-warning"
            >
              QR جديد (بعد خطأ الربط)
            </Button>
          )}
        </div>
      </section>

      <section className="mc-panel border-warning-border">
        <div className="mc-panel-head">
          <div>
            <h3 className="mc-panel-title">
              <Wrench />
              إصلاح واتساب تلقائياً
            </h3>
            <p className="mt-1 text-xs text-slate-muted">
              يحذف الجلسات الزائدة ويعيد ضبط الربط —{" "}
              <strong className="text-slate-text">تحتاج فقط مسح QR مرة واحدة</strong> من جوال العيادة.
            </p>
          </div>
        </div>
        <div className="mc-panel-body">
          {repairMessage && (
            <Alert variant="success" className="mb-3">
              {repairMessage}
            </Alert>
          )}
          <Button
            type="button"
            variant="premium"
            className="w-full"
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
          <ol className="mt-4 space-y-2 text-xs text-slate-muted">
            <li className="flex items-center gap-2.5">
              <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-mc-navy text-[11px] font-bold text-white">1</span>
              اضغط الزر أعلاه وانتظر 10–20 ثانية
            </li>
            <li className="flex items-center gap-2.5">
              <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-mc-navy text-[11px] font-bold text-white">2</span>
              امسح QR من واتسapp جوال العيادة (07770010105)
            </li>
          </ol>
        </div>
      </section>

      <WhatsAppTestButton portal="accountant" />

      <section className="mc-panel">
        <div className="mc-panel-head">
          <div>
            <h3 className="mc-panel-title">
              <Stethoscope />
              فحص شامل للسيرفر
            </h3>
            <p className="mt-1 text-xs text-slate-muted">
              يفحص Evolution على Railway بدون إرسال رسالة — يوضح إن كانت الجلسة
              «متصلة ظاهرياً» لكن معطّلة (zombie).
            </p>
          </div>
        </div>
        <div className="mc-panel-body space-y-3">
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
                <ol className="mt-2 list-decimal space-y-1 ps-5 text-sm">
                  {healthReport.fixSteps.map((step) => (
                    <li key={step}>{step}</li>
                  ))}
                </ol>
              )}
            </Alert>
          )}
        </div>
      </section>

      <WhatsAppRailwayHandoff serverUrl={evolutionPublicUrl} />
      </div>

      <aside className="space-y-5 lg:sticky lg:top-4">
      <section className="mc-panel">
        <div className="mc-panel-head">
          <h3 className="mc-panel-title">
            <LifeBuoy />
            خطأ «Couldn&apos;t link device» على الجوال؟
          </h3>
        </div>
        <ul className="mc-panel-body list-disc space-y-2 ps-9 text-sm leading-relaxed text-slate-muted">
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
      </section>

      <section className="mc-panel">
        <div className="mc-panel-head">
          <h3 className="mc-panel-title">
            <Sparkles />
            رسائل تلقائية (عربي)
          </h3>
        </div>
        <ul className="mc-panel-body space-y-2.5 text-sm text-slate-muted">
          <li className="rounded-xl border border-slate-border bg-surface p-3">
            <strong className="text-slate-text">تأكيد الموعد:</strong> التاريخ،
            الوقت، اسم الطبيب
          </li>
          <li className="rounded-xl border border-slate-border bg-surface p-3">
            <strong className="text-slate-text">إيصال دفع:</strong> المبلغ
            المدفوع + شكر —{" "}
            <span className="text-debt-text">بدون ذكر متبقي أو ديون</span>
          </li>
        </ul>
      </section>

      {messages.length > 0 && (
        <section className="mc-panel">
          <div className="mc-panel-head">
            <h3 className="mc-panel-title">
              <Send />
              آخر الرسائل
            </h3>
          </div>
          <ul className="divide-y divide-slate-border text-sm">
            {messages.map((m) => (
              <li
                key={m.id}
                className="flex items-center justify-between gap-3 px-5 py-3"
              >
                <span className="min-w-0">
                  <span className="block font-medium text-slate-text">
                    {typeLabels[m.message_type] ?? m.message_type}
                  </span>
                  <span className="text-xs tabular-nums text-slate-muted" dir="ltr">
                    {m.recipient_phone}
                  </span>
                </span>
                <span className="shrink-0 rounded-full bg-surface px-2 py-0.5 text-[11px] font-semibold text-slate-muted ring-1 ring-inset ring-slate-border">{m.status}</span>
              </li>
            ))}
          </ul>
        </section>
      )}
      </aside>
      </div>

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
        <p className="text-center text-xs font-medium text-success-text">
          ✓ متغيرات الواتساب مُحمّلة — الجسر: {instanceName ?? "master_clinic"}
        </p>
      )}
    </div>
  );
}
