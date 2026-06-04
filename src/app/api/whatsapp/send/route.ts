import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getClinicIdFromProfile } from "@/lib/clinic-context";
import { fetchClinicProfile } from "@/lib/services/clinic-profile";
import {
  appointmentConfirmationMessage,
  paymentReceiptMessage,
} from "@/lib/whatsapp";
import { deliverWhatsAppMessage } from "@/lib/whatsapp/send-message";

export async function POST(request: NextRequest) {
  const body = await request.json();
  const { type, phone, payload } = body as {
    type: "appointment_confirmation" | "payment_receipt";
    phone: string;
    payload: Record<string, string>;
  };

  if (!phone?.trim()) {
    return NextResponse.json({ error: "رقم الهاتف مطلوب" }, { status: 400 });
  }

  const supabase = await createClient();
  const clinic = await fetchClinicProfile(supabase);

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
      patientName: payload.patientName,
      paidAmount: payload.paidAmount,
      clinic,
      doctorName: payload.doctorName || null,
    });
  } else {
    return NextResponse.json({ error: "نوع غير مدعوم" }, { status: 400 });
  }

  const clinicId = clinic?.id ?? (await getClinicIdFromProfile(supabase));
  if (!clinicId) {
    return NextResponse.json({ error: "لا توجد عيادة" }, { status: 400 });
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
