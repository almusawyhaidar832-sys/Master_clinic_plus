import { authPortalHeaders } from "@/lib/auth/api-portal";
import type { AuthPortalId } from "@/lib/auth/portal-access";

export async function sendSessionWhatsAppPackage(
  input: {
    operationId: string;
    queueEntryId?: string | null;
    phone?: string | null;
    patientId?: string | null;
    invoiceText: string;
    invoicePdfBase64?: string | null;
    invoiceFilename?: string;
    prescriptionPdfBase64?: string | null;
    prescriptionFilename?: string;
    prescriptionCaption?: string;
  },
  portal: AuthPortalId = "accountant"
): Promise<{
  ok: boolean;
  configured?: boolean;
  textSent?: boolean;
  invoiceSent?: boolean;
  prescriptionSent?: boolean;
  error?: string;
}> {
  const res = await fetch("/api/whatsapp/send-session-package", {
    method: "POST",
    credentials: "include",
    headers: {
      "Content-Type": "application/json",
      ...authPortalHeaders(portal),
    },
    body: JSON.stringify({
      operation_id: input.operationId,
      queue_entry_id: input.queueEntryId ?? undefined,
      phone: input.phone ?? undefined,
      patient_id: input.patientId ?? undefined,
      invoice_text: input.invoiceText,
      invoice_pdf_base64: input.invoicePdfBase64 ?? undefined,
      invoice_filename: input.invoiceFilename,
      prescription_pdf_base64: input.prescriptionPdfBase64 ?? undefined,
      prescription_filename: input.prescriptionFilename,
      prescription_caption: input.prescriptionCaption,
    }),
  });

  const json = (await res.json().catch(() => ({}))) as {
    ok?: boolean;
    configured?: boolean;
    textSent?: boolean;
    invoiceSent?: boolean;
    prescriptionSent?: boolean;
    error?: string;
  };

  if (!res.ok) {
    return { ok: false, error: json.error ?? "تعذر إرسال واتساب" };
  }

  return {
    ok: Boolean(json.ok),
    configured: json.configured,
    textSent: json.textSent,
    invoiceSent: json.invoiceSent,
    prescriptionSent: json.prescriptionSent,
  };
}
