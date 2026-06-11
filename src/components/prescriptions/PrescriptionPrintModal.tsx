"use client";

import { useEffect, useState } from "react";
import { X, Printer, Loader2, CheckCircle2, MessageCircle } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { Alert } from "@/components/ui/Alert";
import { ReportActions } from "@/components/reports/ReportActions";
import {
  PrescriptionPrintDocument,
  prescriptionPrintId,
} from "@/components/prescriptions/PrescriptionPrintDocument";
import {
  fetchPrescriptionPrintData,
  markPrescriptionPrinted,
} from "@/lib/prescriptions/client";
import { prescriptionWhatsAppMessage } from "@/lib/prescriptions/messages";
import { downloadPrescriptionPdf } from "@/lib/reports/pdf-export";
import { generateElementPdfBase64 } from "@/lib/reports/pdf-from-html";
import { sendSessionWhatsAppPackage } from "@/lib/whatsapp/send-session-package-client";
import type { PrescriptionPrintData } from "@/lib/prescriptions/types";
import type { AuthPortalId } from "@/lib/auth/portal-access";

interface PrescriptionPrintModalProps {
  prescriptionId: string;
  portal?: AuthPortalId;
  queueEntryId?: string | null;
  onClose: () => void;
  onPrinted?: () => void;
  /** بعد حفظ الجلسة بدون فاتورة دفع */
  afterSessionSave?: boolean;
}

export function PrescriptionPrintModal({
  prescriptionId,
  portal = "accountant",
  queueEntryId,
  onClose,
  onPrinted,
  afterSessionSave = false,
}: PrescriptionPrintModalProps) {
  const [data, setData] = useState<PrescriptionPrintData | null>(null);
  const [loading, setLoading] = useState(true);
  const [printing, setPrinting] = useState(false);
  const [pdfLoading, setPdfLoading] = useState(false);
  const [waLoading, setWaLoading] = useState(false);
  const [printed, setPrinted] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [actionMessage, setActionMessage] = useState<{
    type: "success" | "error" | "info";
    text: string;
  } | null>(null);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      setLoading(true);
      setError(null);
      try {
        const result = await fetchPrescriptionPrintData(prescriptionId, portal);
        if (!cancelled) setData(result);
      } catch (e) {
        if (!cancelled) {
          setError(e instanceof Error ? e.message : "تعذر تحميل الوصفة");
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [prescriptionId, portal]);

  const printId = prescriptionPrintId();

  async function handlePrintAndMark() {
    setPrinting(true);
    setError(null);
    try {
      window.print();
      await markPrescriptionPrinted(prescriptionId, portal);
      setPrinted(true);
      onPrinted?.();
    } catch (e) {
      setError(e instanceof Error ? e.message : "تعذر تسجيل الطباعة");
    } finally {
      setPrinting(false);
    }
  }

  async function sendWhatsApp() {
    if (!data) return;

    if (!data.patientPhone?.trim()) {
      setActionMessage({
        type: "error",
        text: "لا يوجد رقم جوال للمراجع — أضف الرقم في ملف المريض",
      });
      return;
    }

    const operationId = data.prescription.operation_id;
    if (!operationId) {
      setActionMessage({
        type: "error",
        text: "الوصفة غير مربوطة بجلسة — أعد فتح الزيارة من الطابور",
      });
      return;
    }

    setWaLoading(true);
    setActionMessage(null);

    try {
      const prescriptionPdfBase64 = await generateElementPdfBase64(printId);
      const intro = `💊 *وصفة طبية — ${data.patientName}*\n\nمرحباً ${data.patientName}،\nتفاصيل زيارتك ووصفتك الطبية:`;

      const result = await sendSessionWhatsAppPackage(
        {
          operationId,
          queueEntryId,
          phone: data.patientPhone,
          patientId: data.prescription.patient_id,
          invoiceText: intro,
          prescriptionPdfBase64,
          prescriptionFilename: `وصفة-${data.patientName.replace(/\s/g, "-")}.pdf`,
          prescriptionCaption: prescriptionWhatsAppMessage(data),
        },
        portal
      );

      if (!result.ok) {
        setActionMessage({
          type: "error",
          text: result.error ?? "تعذر إرسال الواتساب",
        });
        return;
      }

      if (result.configured === false) {
        setActionMessage({
          type: "info",
          text: "واتساب غير مضبوط — اضبط WHATSAPP_* في الإعدادات",
        });
        return;
      }

      await markPrescriptionPrinted(prescriptionId, portal).catch(() => undefined);
      setPrinted(true);
      onPrinted?.();

      setActionMessage({
        type: "success",
        text: `✓ أُرسل للمراجع (تفاصيل + PDF الوصفة)`,
      });
    } catch (e) {
      setActionMessage({
        type: "error",
        text: e instanceof Error ? e.message : "تعذر إرسال الواتساب",
      });
    } finally {
      setWaLoading(false);
    }
  }

  const zClass = afterSessionSave ? "z-[65]" : "z-50";

  return (
    <div
      className={`fixed inset-0 ${zClass} flex items-end justify-center bg-slate-900/50 p-0 sm:items-center sm:p-4`}
      role="dialog"
      aria-modal="true"
    >
      <div className="flex max-h-[95vh] w-full max-w-2xl flex-col overflow-hidden rounded-t-2xl bg-white shadow-premium sm:rounded-2xl">
        <div className="sticky top-0 z-10 flex items-center justify-between border-b border-slate-border bg-white px-4 py-3 no-print">
          <div>
            <h2 className="text-lg font-bold text-slate-text">وصفة طبية</h2>
            <p className="text-xs text-slate-muted">
              {data?.patientName ?? "..."} — طباعة أو إرسال PDF منفصل عن الفاتورة
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg p-2 text-slate-muted hover:bg-surface"
            aria-label="إغلاق"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-4 space-y-4">
          {afterSessionSave && !loading && data && (
            <Alert variant="info">
              هذه الوصفة <strong>منفصلة</strong> عن فاتورة الدفع — يمكنك إرسال كل
              واحدة لوحدها للمراجع على واتساب.
            </Alert>
          )}

          {loading && (
            <div className="flex items-center justify-center gap-2 py-12 text-slate-muted">
              <Loader2 className="h-5 w-5 animate-spin" />
              جاري تحميل الوصفة...
            </div>
          )}

          {error && <Alert variant="error">{error}</Alert>}
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

          {printed && !actionMessage && (
            <Alert variant="success">
              <CheckCircle2 className="inline h-4 w-4 me-1" />
              تمت الطباعة / الإرسال وتسجيلها
            </Alert>
          )}

          {data && !loading && (
            <>
              <div className="no-print space-y-3">
                <ReportActions
                  shareTitle={`وصفة ${data.patientName}`}
                  printTargetId={printId}
                  pdfLoading={pdfLoading}
                  onExportPdf={async () => {
                    setPdfLoading(true);
                    try {
                      await downloadPrescriptionPdf({
                        patientName: data.patientName,
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
                    إرسال للمراجع (تفاصيل + PDF الوصفة)
                  </Button>
                </div>
              </div>

              <PrescriptionPrintDocument data={data} printId={printId} />
            </>
          )}
        </div>

        {data && !loading && (
          <div className="border-t border-slate-border p-4 no-print space-y-2">
            <Button
              type="button"
              className="w-full"
              onClick={() => void handlePrintAndMark()}
              disabled={printing}
            >
              {printing ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Printer className="h-4 w-4" />
              )}
              {printed ? "تمت الطباعة" : "طباعة وتسليم للمراجع"}
            </Button>
            <Button type="button" variant="outline" className="w-full" onClick={onClose}>
              إغلاق
            </Button>
          </div>
        )}
      </div>

      {data && (
        <div className="print-only hidden">
          <PrescriptionPrintDocument data={data} printId={printId} />
        </div>
      )}
    </div>
  );
}
