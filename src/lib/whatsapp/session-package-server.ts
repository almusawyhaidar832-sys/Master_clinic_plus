import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import { buildClinicalWhatsAppAppendix } from "@/lib/automation/notification-service";
import {
  deliverWhatsAppDocument,
  deliverWhatsAppMessage,
} from "@/lib/whatsapp/send-message";

export type SessionPackageSendResult = {
  ok: boolean;
  configured: boolean;
  textSent: boolean;
  invoiceSent: boolean;
  prescriptionSent: boolean;
  errors: string[];
};

/** إرسال يدوي من المحاسب: 1) نص تفاصيل 2) PDF فاتورة 3) PDF وصفة */
export async function sendAccountingWhatsAppPackage(
  admin: SupabaseClient,
  input: {
    clinicId: string;
    operationId: string;
    queueEntryId?: string | null;
    phone: string;
    invoiceText: string;
    invoicePdfBase64?: string | null;
    invoiceFileName?: string;
    prescriptionPdfBase64?: string | null;
    prescriptionFileName?: string;
    prescriptionCaption?: string;
  }
): Promise<SessionPackageSendResult> {
  const errors: string[] = [];
  let configured = true;
  let textSent = false;
  let invoiceSent = false;
  let prescriptionSent = false;

  const clinicalAppendix = await buildClinicalWhatsAppAppendix(
    admin,
    input.operationId,
    input.queueEntryId
  );
  const fullText = `${input.invoiceText.trim()}${clinicalAppendix}`.trim();

  const textOutcome = await deliverWhatsAppMessage(admin, {
    clinicId: input.clinicId,
    rawPhone: input.phone,
    messageBody: fullText,
    messageType: "session_accounting_package_text",
  });

  if (!textOutcome.configured) configured = false;
  textSent = textOutcome.ok && textOutcome.status === "sent";
  if (!textOutcome.ok && textOutcome.configured) {
    errors.push(textOutcome.providerError ?? "text_send_failed");
  }

  if (input.invoicePdfBase64?.trim()) {
    const invOutcome = await deliverWhatsAppDocument(admin, {
      clinicId: input.clinicId,
      rawPhone: input.phone,
      caption: "📎 إيصال الدفع — PDF",
      messageType: "session_invoice_pdf",
      pdfBase64: input.invoicePdfBase64,
      fileName: input.invoiceFileName ?? "invoice.pdf",
    });
    if (!invOutcome.configured) configured = false;
    invoiceSent = invOutcome.ok && invOutcome.status === "sent";
    if (!invOutcome.ok && invOutcome.configured) {
      errors.push(invOutcome.providerError ?? "invoice_pdf_failed");
    }
  }

  if (input.prescriptionPdfBase64?.trim()) {
    const rxOutcome = await deliverWhatsAppDocument(admin, {
      clinicId: input.clinicId,
      rawPhone: input.phone,
      caption: input.prescriptionCaption?.trim() || "💊 الوصفة الطبية — PDF",
      messageType: "prescription_pdf",
      pdfBase64: input.prescriptionPdfBase64,
      fileName: input.prescriptionFileName ?? "prescription.pdf",
    });
    if (!rxOutcome.configured) configured = false;
    prescriptionSent = rxOutcome.ok && rxOutcome.status === "sent";
    if (!rxOutcome.ok && rxOutcome.configured) {
      errors.push(rxOutcome.providerError ?? "prescription_pdf_failed");
    }
  }

  const ok =
    errors.length === 0 &&
    (textSent || !configured) &&
    (!input.invoicePdfBase64?.trim() || invoiceSent || !configured) &&
    (!input.prescriptionPdfBase64?.trim() || prescriptionSent || !configured);

  return {
    ok,
    configured,
    textSent,
    invoiceSent,
    prescriptionSent,
    errors,
  };
}
