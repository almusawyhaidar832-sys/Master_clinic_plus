import { NextRequest, NextResponse } from "next/server";
import {
  createApiSessionClient,
  getApiCallerProfile,
} from "@/lib/auth/api-session";
import {
  appointmentConfirmationMessage,
  paymentReceiptMessage,
} from "@/lib/whatsapp";
import {
  sessionInvoiceWhatsAppMessage,
  type SessionInvoiceData,
} from "@/lib/invoices/session-invoice";
import {
  resolveWhatsAppClinic,
  whatsappNoClinicError,
} from "@/lib/whatsapp/resolve-clinic";
import { deliverWhatsAppMessage } from "@/lib/whatsapp/send-message";

export async function POST(request: NextRequest) {
  const profile = await getApiCallerProfile();
  if (!profile) {
    return NextResponse.json({ error: "غير مصرح" }, { status: 401 });
  }

  const body = await request.json();
  const { type, phone, payload } = body as {
    type: "appointment_confirmation" | "payment_receipt" | "session_invoice";
    phone: string;
    payload: Record<string, unknown>;
  };

  if (!phone?.trim()) {
    return NextResponse.json({ error: "رقم الهاتف مطلوب" }, { status: 400 });
  }

  const supabase = await createApiSessionClient();
  const resolved = await resolveWhatsAppClinic(supabase, profile.clinic_id);
  if (!resolved) {
    return NextResponse.json(whatsappNoClinicError(), { status: 400 });
  }

  const { clinicId, clinic } = resolved;

  let messageBody: string;

  if (type === "appointment_confirmation") {
    messageBody = appointmentConfirmationMessage({
      patientName: payload.patientName,
      date: payload.date,
      time: payload.time,
      doctorName: payload.doctorName,
      clinic,
    });
  } else if (type === "payment_receipt") {
    messageBody = paymentReceiptMessage({
      patientName: String(payload.patientName ?? ""),
      paidAmount: String(payload.paidAmount ?? ""),
      clinic,
      doctorName: payload.doctorName ? String(payload.doctorName) : null,
    });
  } else if (type === "session_invoice") {
    const invoiceData = payload.invoiceData as SessionInvoiceData;
    if (!invoiceData?.patientName) {
      return NextResponse.json({ error: "بيانات الفاتورة ناقصة" }, { status: 400 });
    }
    messageBody = sessionInvoiceWhatsAppMessage({
      ...invoiceData,
      clinic: invoiceData.clinic ?? clinic,
    });
  } else {
    return NextResponse.json({ error: "نوع غير مدعوم" }, { status: 400 });
  }

  const outcome = await deliverWhatsAppMessage(supabase, {
    clinicId,
    rawPhone: phone,
    messageBody,
    messageType: type,
  });

  if (!outcome.ok && outcome.configured) {
    return NextResponse.json(
      {
        error: "فشل إرسال الواتساب",
        providerError: outcome.providerError,
        normalizedPhone: outcome.normalizedPhone,
      },
      { status: 502 }
    );
  }

  return NextResponse.json({
    ok: true,
    message: messageBody,
    status: outcome.status,
    normalizedPhone: outcome.normalizedPhone,
    configured: outcome.configured,
  });
}
