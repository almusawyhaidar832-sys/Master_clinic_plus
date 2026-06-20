"use client";



import { useEffect, useState } from "react";
import { flushSync } from "react-dom";

import { X, MessageCircle, Loader2, CheckCircle2 } from "lucide-react";

import { Button } from "@/components/ui/Button";

import { Alert } from "@/components/ui/Alert";

import { ReportActions } from "@/components/reports/ReportActions";

import {

  SessionPaymentInvoiceDocument,

  sessionInvoicePrintId,

} from "@/components/invoices/SessionPaymentInvoiceDocument";

import {

  PrescriptionPrintDocument,

  prescriptionPrintId,

} from "@/components/prescriptions/PrescriptionPrintDocument";

import {

  sessionInvoiceWhatsAppMessage,

  type SessionInvoiceData,

} from "@/lib/invoices/session-invoice";

import { fetchPrescriptionPrintData, resolvePrescriptionForSession } from "@/lib/prescriptions/client";
import { prescriptionHasContent } from "@/lib/prescriptions/content";
import { prescriptionWhatsAppMessage } from "@/lib/prescriptions/messages";

import type { PrescriptionPrintData } from "@/lib/prescriptions/types";

import { downloadSessionInvoicePdf } from "@/lib/reports/pdf-export";

import {
  generateElementPdfBase64,
  isPdfBase64TooLarge,
  withTimeout,
  waitForPaint,
  WHATSAPP_PDF_MAX_BYTES,
} from "@/lib/reports/pdf-from-html";

import { sendSessionWhatsAppPackage } from "@/lib/whatsapp/send-session-package-client";
import { sendWhatsAppPdf } from "@/lib/whatsapp/send-pdf-client";

import { authPortalHeaders } from "@/lib/auth/api-portal";

import { getClinicDisplayName } from "@/lib/services/clinic-profile";

import { notifyFinancialMutation } from "@/lib/sync/mutation-notify";

import { formatCurrency } from "@/lib/utils";

import { Wallet } from "lucide-react";



interface SessionInvoiceModalProps {

  data: SessionInvoiceData;

  invoiceId?: string | null;

  onClose: () => void;

  onFinalized?: () => void;

  queueEntryId?: string | null;

  /** وصفة الطبيب — تُرسل PDF منفصل مع الفاتورة بزر واحد */

  prescriptionId?: string | null;

  /** من السجل التاريخي — إعادة إرسال فقط بدون اعتماد */
  archivedHistory?: boolean;

}



export function SessionInvoiceModal({

  data,

  invoiceId: invoiceIdProp,

  onClose,

  onFinalized,

  queueEntryId,

  prescriptionId,

  archivedHistory = false,

}: SessionInvoiceModalProps) {

  const [pdfLoading, setPdfLoading] = useState(false);

  const [waLoading, setWaLoading] = useState(false);

  const [finalizeLoading, setFinalizeLoading] = useState(false);

  const [finalized, setFinalized] = useState(archivedHistory);

  const [invoiceId, setInvoiceId] = useState<string | null>(

    invoiceIdProp ?? data.invoiceId ?? null

  );

  const [prescriptionData, setPrescriptionData] =
    useState<PrescriptionPrintData | null>(null);
  const [resolvedPrescriptionId, setResolvedPrescriptionId] = useState<string | null>(
    prescriptionId ?? null
  );
  const [prescriptionLoading, setPrescriptionLoading] = useState(false);

  const [actionMessage, setActionMessage] = useState<{

    type: "success" | "error" | "info";

    text: string;

  } | null>(null);



  const invoicePrintId = sessionInvoicePrintId();

  const rxPrintId = prescriptionPrintId();

  const clinicName = getClinicDisplayName(data.clinic);

  const hasPrescription = Boolean(
    resolvedPrescriptionId &&
      prescriptionData &&
      prescriptionHasContent(prescriptionData.prescription)
  );

  const PDF_TIMEOUT_MS = 25_000;

  useEffect(() => {
    setResolvedPrescriptionId(prescriptionId ?? null);
  }, [prescriptionId]);

  useEffect(() => {
    if (prescriptionId || (!queueEntryId && !data.operationId)) return;

    let cancelled = false;
    setPrescriptionLoading(true);

    void resolvePrescriptionForSession(
      { queueEntryId, operationId: data.operationId },
      "accountant",
      { retries: archivedHistory ? 2 : 3, retryDelayMs: 1500 }
    )
      .then((rx) => {
        if (cancelled || !rx) return;
        setResolvedPrescriptionId(rx.id);
      })
      .finally(() => {
        if (!cancelled) setPrescriptionLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [prescriptionId, queueEntryId, data.operationId, archivedHistory]);

  async function tryGeneratePdf(elementId: string): Promise<string | null> {
    try {
      const base64 = await withTimeout(
        generateElementPdfBase64(elementId),
        PDF_TIMEOUT_MS,
        "انتهت مهلة إنشاء الملف"
      );
      if (isPdfBase64TooLarge(base64, WHATSAPP_PDF_MAX_BYTES)) return null;
      return base64;
    } catch {
      return null;
    }
  }



  useEffect(() => {
    if (!resolvedPrescriptionId) {
      setPrescriptionData(null);
      return;
    }

    let cancelled = false;
    setPrescriptionLoading(true);

    void fetchPrescriptionPrintData(resolvedPrescriptionId, "accountant")
      .then((result) => {
        if (cancelled) return;
        setPrescriptionData(
          result && prescriptionHasContent(result.prescription) ? result : null
        );
      })
      .catch(() => {
        if (!cancelled) setPrescriptionData(null);
      })
      .finally(() => {
        if (!cancelled) setPrescriptionLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [resolvedPrescriptionId]);



  async function ensurePrescriptionReady(): Promise<PrescriptionPrintData | null> {
    if (prescriptionData && prescriptionHasContent(prescriptionData.prescription)) {
      return prescriptionData;
    }

    let rxId = resolvedPrescriptionId;
    if (!rxId && queueEntryId) {
      const rx = await resolvePrescriptionForSession({ queueEntryId }, "accountant", {
        retries: 2,
        retryDelayMs: 1000,
      });
      rxId = rx?.id ?? null;
      if (rxId) setResolvedPrescriptionId(rxId);
    }
    if (!rxId && data.operationId) {
      const rx = await resolvePrescriptionForSession(
        { operationId: data.operationId },
        "accountant",
        { retries: 2, retryDelayMs: 1000 }
      );
      rxId = rx?.id ?? null;
      if (rxId) setResolvedPrescriptionId(rxId);
    }

    if (!rxId) return null;

    try {
      const result = await fetchPrescriptionPrintData(rxId, "accountant");
      if (!prescriptionHasContent(result.prescription)) return null;
      flushSync(() => setPrescriptionData(result));
      await waitForPaint();
      await waitForPaint();
      return result;
    } catch {
      return null;
    }
  }



  async function sendWhatsAppPackage() {
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
      const inv = data.invoiceNumber.replace(/\s/g, "");
      const phone = data.patientPhone.trim();

      const textResult = await sendSessionWhatsAppPackage(
        {
          operationId: data.operationId,
          queueEntryId,
          phone,
          patientId: data.patientId ?? undefined,
          invoiceText: sessionInvoiceWhatsAppMessage(data),
        },
        "accountant"
      );

      if (textResult.configured === false) {
        setActionMessage({
          type: "info",
          text:
            textResult.error ??
            "واتساب غير مضبوط — اضبط WHATSAPP_API_URL و WHATSAPP_API_KEY في الإعدادات",
        });
        return;
      }

      if (!textResult.ok) {
        setActionMessage({
          type: "error",
          text: textResult.error ?? "تعذر إرسال تفاصيل الجلسة على واتساب",
        });
        return;
      }

      // الفاتورة تُرسل كنص — PDF اختياري (إن فشل أو كَبُر يكفي النص)
      let invoicePdfSent = false;
      const invoicePdfBase64 = await tryGeneratePdf(invoicePrintId);
      if (invoicePdfBase64) {
        const invoiceResult = await sendWhatsAppPdf({
          pdfBase64: invoicePdfBase64,
          filename: `invoice-${inv}.pdf`,
          caption: "📎 إيصال الدفع — PDF",
          messageType: "session_invoice_pdf",
          phone,
          patientId: data.patientId ?? undefined,
          operationId: data.operationId,
          portal: "accountant",
        });
        invoicePdfSent = invoiceResult.ok;
      }

      let prescriptionSent = false;
      let prescriptionExpected = false;
      const rxPrintData = await ensurePrescriptionReady();
      if (rxPrintData) {
        prescriptionExpected = true;
        await waitForPaint();
        const prescriptionPdfBase64 = await tryGeneratePdf(rxPrintId);
        if (prescriptionPdfBase64) {
          const rxResult = await sendWhatsAppPdf({
            pdfBase64: prescriptionPdfBase64,
            filename: `prescription-${data.patientName.replace(/\s/g, "-")}.pdf`,
            caption: prescriptionWhatsAppMessage(rxPrintData),
            messageType: "prescription_pdf",
            phone,
            patientId: data.patientId ?? undefined,
            operationId: rxPrintData.prescription.operation_id ?? data.operationId,
            prescriptionId: resolvedPrescriptionId ?? undefined,
            portal: "accountant",
          });
          prescriptionSent = rxResult.ok;
        }
      }

      const parts = [invoicePdfSent ? "فاتورة PDF" : "فاتورة (نص)"];
      if (prescriptionExpected) {
        parts.push(prescriptionSent ? "وصفة PDF" : "الوصفة (تعذر الإرسال)");
      }

      setActionMessage({
        type: "success",
        text: `✓ أُرسل للمراجع (${parts.join(" + ")})`,
      });
    } catch (e) {
      setActionMessage({
        type: "error",
        text: e instanceof Error ? e.message : "تعذر إرسال واتساب",
      });
    } finally {
      setWaLoading(false);
    }
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

            <h2 className="text-lg font-bold text-slate-text">
              {archivedHistory ? "إعادة إرسال من السجل" : "فاتورة الدفع"}
            </h2>

            <p className="text-xs text-slate-muted">

              {data.patientName} — {data.invoiceNumber}

              {hasPrescription ? " · مع وصفة طبية" : ""}

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



          {!finalized && !archivedHistory && (

            <Alert variant="info">

              اضغط <strong>إرسال واتساب</strong> ليرسل للمراجع: رسالة الفاتورة
              والتفاصيل (مخطط + ملاحظات + أشعة)
              {hasPrescription ? " ثم PDF الوصفة" : ""}. إن تعذر PDF الفاتورة
              تُرسل كنص. لا يُرسل شيء تلقائياً.

            </Alert>

          )}

          {archivedHistory && (
            <Alert variant="info">
              فاتورة مؤرشفة — يمكنك إعادة إرسال <strong>الفاتورة والوصفة</strong>{" "}
              للمراجع على واتساب. لن يُنشأ سجل جديد.
            </Alert>
          )}



          {((data.doctorShareTotal ?? 0) > 0 ||

            (data.clinicShareTotal ?? 0) > 0) &&

          data.caseTotalAmount > 0 ? (

            <div className="no-print flex items-start gap-2 rounded-xl border border-emerald-100 bg-emerald-50 p-3 text-sm text-emerald-800">

              <Wallet className="mt-0.5 h-4 w-4 shrink-0" />

              <div>

                <p className="font-semibold">التقسيم المالي على السعر النهائي</p>

                <p className="mt-1">

                  حصة الطبيب → المحفظة:{" "}

                  <strong>{formatCurrency(data.doctorShareTotal ?? 0)}</strong>

                  {" · "}

                  صافي العيادة:{" "}

                  <strong>{formatCurrency(data.clinicShareTotal ?? 0)}</strong>

                </p>

              </div>

            </div>

          ) : null}



          <div className="no-print space-y-3">

            <ReportActions

              shareTitle={`فاتورة ${data.patientName} — ${clinicName}`}

              printTargetId={invoicePrintId}

              pdfLoading={pdfLoading}

              onExportPdf={async () => {

                setPdfLoading(true);

                try {

                  await downloadSessionInvoicePdf({

                    patientName: data.patientName,

                    invoiceNumber: data.invoiceNumber,

                    elementId: invoicePrintId,

                  });

                } finally {

                  setPdfLoading(false);

                }

              }}

            />



            <Button

              type="button"

              className="w-full bg-[#25D366] hover:bg-[#1da851] text-white"

              disabled={waLoading || prescriptionLoading || !data.patientPhone}

              onClick={() => void sendWhatsAppPackage()}

            >

              {waLoading || prescriptionLoading ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <MessageCircle className="h-4 w-4" />
              )}

              {prescriptionLoading
                ? "جاري تحميل الوصفة..."
                : hasPrescription
                  ? archivedHistory
                    ? "إعادة إرسال (فاتورة + وصفة)"
                    : "إرسال للمراجع (فاتورة + وصفة PDF)"
                  : archivedHistory
                    ? "إعادة إرسال الفاتورة"
                    : "إرسال للمراجع (فاتورة)"}

            </Button>

          </div>



          <SessionPaymentInvoiceDocument data={data} printId={invoicePrintId} />

          {(hasPrescription || prescriptionLoading) && prescriptionData && (
            <div className="space-y-2 border-t border-slate-border pt-4">

              <h3 className="text-sm font-bold text-slate-text">

                الوصفة الطبية (تُرسل PDF منفصل)

              </h3>

              <PrescriptionPrintDocument

                data={prescriptionData}

                printId={rxPrintId}

              />

            </div>

          )}

        </div>



        <div className="border-t border-slate-border p-4 no-print space-y-2">

          {!finalized && !archivedHistory ? (

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
