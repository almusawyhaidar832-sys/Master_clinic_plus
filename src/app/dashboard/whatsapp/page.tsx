"use client";

import { useCallback, useEffect, useState } from "react";
import { Card, CardHeader, CardTitle } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { Alert } from "@/components/ui/Alert";
import { createClient } from "@/lib/supabase/client";
import { getClinicIdFromProfile } from "@/lib/clinic-context";
import { QrCode, MessageCircle, RefreshCw } from "lucide-react";

export default function WhatsAppSettingsPage() {
  const [linked, setLinked] = useState(false);
  const [qrImage, setQrImage] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [messages, setMessages] = useState<
    { id: string; message_type: string; recipient_phone: string; status: string; created_at: string }[]
  >([]);

  const loadStatus = useCallback(async () => {
    const supabase = createClient();
    const clinicId = await getClinicIdFromProfile(supabase);
    if (!clinicId) return;

    const { data: clinic } = await supabase
      .from("clinics")
      .select("whatsapp_linked")
      .eq("id", clinicId)
      .maybeSingle();
    if (clinic) setLinked(clinic.whatsapp_linked);

    const { data: logs } = await supabase
      .from("whatsapp_messages")
      .select("id, message_type, recipient_phone, status, created_at")
      .order("created_at", { ascending: false })
      .limit(10);
    setMessages(logs ?? []);
  }, []);

  useEffect(() => {
    loadStatus();
  }, [loadStatus]);

  async function startScan() {
    setLoading(true);
    setQrImage(null);
    try {
      const res = await fetch("/api/whatsapp/qr");
      const data = await res.json();
      setLinked(!!data.linked);
      if (data.qr) {
        const src =
          typeof data.qr === "string" && data.qr.startsWith("data:")
            ? data.qr
            : `data:image/png;base64,${data.qr}`;
        setQrImage(src);
      }
      if (data.linked) {
        const supabase = createClient();
        await supabase
          .from("clinics")
          .update({ whatsapp_linked: true })
          .neq("id", "00000000-0000-0000-0000-000000000000");
      }
    } catch {
      /* bridge offline */
    }
    setLoading(false);
    loadStatus();
  }

  const typeLabels: Record<string, string> = {
    appointment_confirmation: "تأكيد موعد",
    payment_receipt: "إيصال دفع",
  };

  return (
    <div className="mx-auto max-w-lg space-y-6">
      <div>
        <h2 className="text-2xl font-bold text-slate-text">ربط واتساب</h2>
        <p className="text-slate-muted">اربط رقم العيادة مرة واحدة عبر مسح QR</p>
      </div>

      <Card className="text-center">
        <CardHeader>
          <div className="mx-auto mb-4 flex h-20 w-20 items-center justify-center rounded-2xl bg-green-50">
            <MessageCircle className="h-10 w-10 text-green-600" />
          </div>
          <CardTitle>
            {linked ? "واتساب مربوط ✓" : "امسح رمز QR من تطبيق واتساب"}
          </CardTitle>
        </CardHeader>

        {!linked && (
          <div className="mb-6 flex justify-center">
            {qrImage ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={qrImage}
                alt="رمز QR للربط"
                className="h-48 w-48 rounded-xl border border-slate-border"
              />
            ) : (
              <div className="flex h-48 w-48 items-center justify-center rounded-xl border-2 border-dashed border-slate-border bg-surface">
                <QrCode className="h-24 w-24 text-slate-muted" />
              </div>
            )}
          </div>
        )}

        <Button onClick={startScan} disabled={loading} className="w-full">
          {loading ? (
            <>
              <RefreshCw className="h-4 w-4 animate-spin" />
              جاري التحميل...
            </>
          ) : linked ? (
            "إعادة الربط"
          ) : (
            "عرض رمز QR"
          )}
        </Button>
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

      <Alert variant="info">
        يتطلب تشغيل جسر WhatsApp على WHATSAPP_API_URL في ملف البيئة
      </Alert>
    </div>
  );
}
