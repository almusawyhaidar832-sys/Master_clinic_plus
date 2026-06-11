import { authPortalHeaders } from "@/lib/auth/api-portal";
import type { AuthPortalId } from "@/lib/auth/portal-access";

export async function sendWhatsAppPdf(input: {
  pdfBase64: string;
  filename: string;
  caption: string;
  messageType: string;
  phone?: string | null;
  patientId?: string | null;
  operationId?: string | null;
  prescriptionId?: string | null;
  portal?: AuthPortalId;
}): Promise<{ ok: boolean; error?: string; configured?: boolean }> {
  const res = await fetch("/api/whatsapp/send-pdf", {
    method: "POST",
    credentials: "include",
    headers: {
      "Content-Type": "application/json",
      ...authPortalHeaders(input.portal ?? "accountant"),
    },
    body: JSON.stringify({
      pdf_base64: input.pdfBase64,
      filename: input.filename,
      caption: input.caption,
      message_type: input.messageType,
      phone: input.phone ?? undefined,
      patient_id: input.patientId ?? undefined,
      operation_id: input.operationId ?? undefined,
      prescription_id: input.prescriptionId ?? undefined,
    }),
  });

  const json = (await res.json().catch(() => ({}))) as {
    ok?: boolean;
    error?: string;
    configured?: boolean;
  };

  if (!res.ok) {
    return { ok: false, error: json.error ?? "تعذر إرسال الواتساب" };
  }

  return {
    ok: Boolean(json.ok),
    configured: json.configured,
    error: json.error,
  };
}
