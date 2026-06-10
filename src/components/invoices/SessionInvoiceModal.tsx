"use client";

import { useState } from "react";
import { X, MessageCircle, Loader2, CheckCircle2 } from "lucide-react";
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
import { notifyFinancialMutation } from "@/lib/sync/mutation-notify";

interface SessionInvoiceModalProps {
  data: SessionInvoiceData;
  invoiceId?: string | null;
  onClose: () => void;
  /** بعد الاعتماد النهائي — الفاتورة تُؤرشف وتختفي من العمليات النشطة */
  onFinalized?: () => void;
}

export function SessionInvoiceModal({
  data,
  invoiceId: invoiceIdProp,
  onClose,
  onFinalized,
}: SessionInvoiceModalProps) {
  const [pdfLoading, setPdfLoading] = useState(false);
  const [waLoading, setWaLoading] = useState(false);
  const [finalizeLoading, setFinalizeLoading] = useState(false);
  const [finalized, setFinalized] = useState(false);
  const [invoiceId, setInvoiceId] = useState<string | null>(
    invoiceIdProp ?? data.invoiceId ?? null
  );
  const [actionMessage, setActionMessage] = useState<{
    type: "success" | "error" | "info";
    text: string;
  } | null>(null);

  const printId = sessionInvoicePrintId();
  const clinicName = getClinicDisplayName(data.clinic);

  async function sendWhatsApp() {
    if (!data.patientPhone?.trim()) {
      setActionMessage({
        type: "error",
        text: "لا يوجد رقم جوال للمراجع — أضف الرقم في ملف المريض",
      });
      return;
    }

    setWaLoading(true);
    setActionMessage(null);

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
      };

      if (!res.ok) {
        setActionMessage({
          type: "error",
          text: json.error ?? "تعذر إرسال الواتساب",
        });
        return;
      }

      if (json.configured === false) {
        setActionMessage({
          type: "info",
          text: "واتساب غير مضبوط — انسخ الرسالة يدوياً أو اضبط WHATSAPP_* في الإعدادات",
        });
        return;
      }

      setActionMessage({
        type: "success",
        text: `✓ تم إرسال الفاتورة إلى ${data.patientName} عبر واتساب`,
      });
    } catch {
      setActionMessage({ type: "error", text: "تعذر الاتصال بالسيرفر" });
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

  async function handleFinalize() {
    setFinalizeLoading(true);
    setActionMessage(null);

    const snapshot: SessionInvoiceData = {
      ...data,
      invoiceId: invoiceId ?? data.invoiceId,
    };

    try {
      let activeInvoiceId = invoiceId;
      if (!activeInvoiceId) {
        const draftRes = await fetch("/api/invoices/draft", {
          method: "POST",
          credentials: "include",
          headers: {
            "Content-Type": "application/json",
            ...authPortalHeaders("accountant"),
          },
          body: JSON.stringify({
            operation_id: data.operationId,
            snapshot,
          }),
        });
        const draftJson = (await draftRes.json()) as {
          invoice_id?: string;
          error?: string;
        };
        if (!draftRes.ok) {
          setActionMessage({
            type: "error",
            text: draftJson.error ?? "تعذر إنشاء مسودة الفاتورة",
          });
          return;
        }
        activeInvoiceId = draftJson.invoice_id ?? null;
        setInvoiceId(activeInvoiceId);
      }

      const res = await fetch("/api/invoices/finalize", {
        method: "POST",
        credentials: "include",
        headers: {
          "Content-Type": "application/json",
          ...authPortalHeaders("accountant"),
        },
        body: JSON.stringify({
          operation_id: data.operationId,
          invoice_id: activeInvoiceId,
          snapshot: { ...snapshot, invoiceId: activeInvoiceId },
        }),
      });

      const json = (await res.json()) as {
        success?: boolean;
        error?: string;
        already_archived?: boolean;
      };

      if (!res.ok) {
        setActionMessage({
          type: "error",
          text: json.error ?? "تعذر اعتماد الفاتورة",
        });
        return;
      }

      setFinalized(true);
      setActionMessage({
        type: "success",
        text: json.already_archived
          ? "الفاتورة مؤرشفة مسبقاً — تم التحديث"
          : "✓ تم الاعتماد النهائي — نُقلت الفاتورة إلى السجل التاريخي",
      });

      if (data.clinic?.id) {
        notifyFinancialMutation({
          clinicId: data.clinic.id,
          doctorId: data.doctorId ?? undefined,
          patientId: data.patientId ?? undefined,
          alsoSessions: true,
        });
      }

      onFinalized?.();
    } catch {
      setActionMessage({ type: "error", text: "تعذر الاتصال بالسيرفر" });
    } finally {
      setFinalizeLoading(false);
    }
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
          {actionMessage && (
            <Alert
              variant={
                actionMessage.type === "success"
                  ? "success"
                  : actionMessage.type === "error"
                    ? "error"
                    : "info"
              }
            >
              {actionMessage.text}
            </Alert>
          )}

          {!finalized && (
            <Alert variant="info">
              بعد مراجعة الفاتورة اضغط <strong>اعتماد نهائي</strong> لنقلها إلى
              السجل التاريخي وإخفائها من جلسات اليوم.
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

        <div className="border-t border-slate-border p-4 no-print space-y-2">
          {!finalized ? (
            <>
              <Button
                type="button"
                className="w-full"
                disabled={finalizeLoading}
                onClick={() => void handleFinalize()}
              >
                {finalizeLoading ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <CheckCircle2 className="h-4 w-4" />
                )}
                اعتماد نهائي — نقل إلى السجل التاريخي
              </Button>
              <Button
                type="button"
                variant="outline"
                className="w-full"
                onClick={onClose}
              >
                إغلاق مؤقت (تبقى في العمليات النشطة)
              </Button>
            </>
          ) : (
            <Button type="button" className="w-full" onClick={onClose}>
              إغلاق
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}
