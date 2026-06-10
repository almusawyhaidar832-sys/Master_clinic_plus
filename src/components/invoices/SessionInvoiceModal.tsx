"use client";

import { useState } from "react";
import { X, MessageCircle, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { Alert } from "@/components/ui/Alert";
import { ReportActions } from "@/components/reports/ReportActions";
import {
  SessionPaymentInvoiceDocument,
  sessionInvoicePrintId,
} from "@/components/invoices/SessionPaymentInvoiceDocument";
import {
  sessionInvoiceWhatsAppMessage,
  type SessionInvoiceData,
} from "@/lib/invoices/session-invoice";
import { downloadSessionInvoicePdf } from "@/lib/reports/pdf-export";
import { authPortalHeaders } from "@/lib/auth/api-portal";
import { getClinicDisplayName } from "@/lib/services/clinic-profile";

interface SessionInvoiceModalProps {
  data: SessionInvoiceData;
  onClose: () => void;
}

export function SessionInvoiceModal({ data, onClose }: SessionInvoiceModalProps) {
  const [pdfLoading, setPdfLoading] = useState(false);
  const [waLoading, setWaLoading] = useState(false);
  const [waMessage, setWaMessage] = useState<{
    type: "success" | "error" | "info";
    text: string;
  } | null>(null);

  const printId = sessionInvoicePrintId();
  const clinicName = getClinicDisplayName(data.clinic);

  async function sendWhatsApp() {
    if (!data.patientPhone?.trim()) {
      setWaMessage({
        type: "error",
        text: "لا يوجد رقم جوال للمراجع — أضف الرقم في ملف المريض",
      });
      return;
    }

    setWaLoading(true);
    setWaMessage(null);

    try {
      const res = await fetch("/api/whatsapp/send-session", {
        method: "POST",
        credentials: "include",
        headers: {
          "Content-Type": "application/json",
          ...authPortalHeaders("accountant"),
        },
        body: JSON.stringify({
          operation_id: data.operationId,
          phone: data.patientPhone,
        }),
      });

      const json = (await res.json()) as {
        ok?: boolean;
        error?: string;
        configured?: boolean;
        status?: string;
      };

      if (!res.ok) {
        setWaMessage({
          type: "error",
          text: json.error ?? "تعذر إرسال الواتساب",
        });
        return;
      }

      if (json.configured === false) {
        setWaMessage({
          type: "info",
          text: "واتساب غير مضبوط — انسخ الرسالة يدوياً أو اضبط WHATSAPP_* في الإعدادات",
        });
        return;
      }

      setWaMessage({
        type: "success",
        text: `✓ تم إرسال الفاتورة إلى ${data.patientName} عبر واتساب`,
      });
    } catch {
      setWaMessage({ type: "error", text: "تعذر الاتصال بالسيرفر" });
    } finally {
      setWaLoading(false);
    }
  }

  function openWhatsAppManual() {
    if (!data.patientPhone?.trim()) return;
    const text = encodeURIComponent(sessionInvoiceWhatsAppMessage(data));
    const phone = data.patientPhone.replace(/\D/g, "");
    window.open(`https://wa.me/${phone}?text=${text}`, "_blank", "noopener");
  }

  return (
    <div
      className="fixed inset-0 z-[60] flex items-end justify-center bg-black/50 p-0 sm:items-center sm:p-4"
      role="dialog"
      aria-modal="true"
    >
      <div className="flex max-h-[95vh] w-full max-w-2xl flex-col overflow-hidden rounded-t-2xl bg-surface sm:rounded-2xl">
        <div className="flex items-center justify-between border-b border-slate-border px-4 py-3 no-print">
          <div>
            <h2 className="text-lg font-bold text-slate-text">فاتورة الدفع</h2>
            <p className="text-xs text-slate-muted">
              {data.patientName} — {data.invoiceNumber}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg p-2 text-slate-muted hover:bg-surface-card"
            aria-label="إغلاق"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-4 space-y-4">
          {waMessage && (
            <Alert
              variant={
                waMessage.type === "success"
                  ? "success"
                  : waMessage.type === "error"
                    ? "error"
                    : "info"
              }
            >
              {waMessage.text}
            </Alert>
          )}

          <div className="no-print space-y-3">
            <ReportActions
              shareTitle={`فاتورة ${data.patientName} — ${clinicName}`}
              printTargetId={printId}
              pdfLoading={pdfLoading}
              onExportPdf={async () => {
                setPdfLoading(true);
                try {
                  await downloadSessionInvoicePdf({
                    patientName: data.patientName,
                    invoiceNumber: data.invoiceNumber,
                    elementId: printId,
                  });
                } finally {
                  setPdfLoading(false);
                }
              }}
            />

            <div className="flex flex-col gap-2 sm:flex-row">
              <Button
                type="button"
                className="flex-1 bg-[#25D366] hover:bg-[#1da851] text-white"
                disabled={waLoading || !data.patientPhone}
                onClick={() => void sendWhatsApp()}
              >
                {waLoading ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <MessageCircle className="h-4 w-4" />
                )}
                إرسال الفاتورة للمراجع (واتساب)
              </Button>
              {data.patientPhone && (
                <Button
                  type="button"
                  variant="outline"
                  className="flex-1"
                  onClick={openWhatsAppManual}
                >
                  فتح واتساب يدوياً
                </Button>
              )}
            </div>
          </div>

          <SessionPaymentInvoiceDocument data={data} />
        </div>

        <div className="border-t border-slate-border p-4 no-print">
          <Button type="button" variant="outline" className="w-full" onClick={onClose}>
            إغلاق ومتابعة العمل
          </Button>
        </div>
      </div>
    </div>
  );
}
