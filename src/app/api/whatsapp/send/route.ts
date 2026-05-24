import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { fetchClinicProfile } from "@/lib/services/clinic-profile";
import {
  appointmentConfirmationMessage,
  paymentReceiptMessage,
} from "@/lib/whatsapp";

export async function POST(request: NextRequest) {
  const body = await request.json();
  const { type, phone, payload } = body as {
    type: "appointment_confirmation" | "payment_receipt";
    phone: string;
    payload: Record<string, string>;
  };

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

  const apiUrl = process.env.WHATSAPP_API_URL;
  const {
    data: { user },
  } = await supabase.auth.getUser();
  let clinicId: string | null = clinic?.id ?? null;
  if (!clinicId && user) {
    const { data: profile } = await supabase
      .from("profiles")
      .select("clinic_id")
      .eq("id", user.id)
      .single();
    clinicId = profile?.clinic_id ?? null;
  }

  await supabase.from("whatsapp_messages").insert({
    clinic_id: clinicId,
    message_type: type,
    recipient_phone: phone,
    message_body_ar: messageBody,
    status: apiUrl ? "sent" : "pending",
    sent_at: apiUrl ? new Date().toISOString() : null,
  });

  if (apiUrl) {
    await fetch(`${apiUrl}/message/send`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${process.env.WHATSAPP_API_SECRET}`,
      },
      body: JSON.stringify({ phone, message: messageBody }),
    });
  }

  return NextResponse.json({ ok: true, message: messageBody });
}
