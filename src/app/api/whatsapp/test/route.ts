import { NextRequest, NextResponse } from "next/server";
import {
  createApiSessionClient,
  getApiCallerProfile,
} from "@/lib/auth/api-session";
import { validatePatientPhone } from "@/lib/phone";
import { testNotificationMessage } from "@/lib/whatsapp";
import {
  resolveWhatsAppClinic,
  whatsappNoClinicError,
} from "@/lib/whatsapp/resolve-clinic";
import { deliverWhatsAppMessage } from "@/lib/whatsapp/send-message";
import { requireWhatsAppManageAccess } from "@/lib/whatsapp/require-api-access";
import { describeWhatsAppDeliveryError } from "@/lib/whatsapp/delivery-errors";
import {
  resolveEvolutionSession,
} from "@/lib/whatsapp/evolution-client";
import { resolveWhatsAppInstanceForClinic } from "@/lib/whatsapp/resolve-instance";
import { phoneToLocalDisplay } from "@/lib/phone";

/**
 * POST /api/whatsapp/test
 * Body: { phone?: string } — defaults to WHATSAPP_TEST_PHONE env or profile.phone
 */
export async function POST(request: NextRequest) {
  const access = await requireWhatsAppManageAccess(request);
  if (!access.ok) return access.response;

  const profile =
    access.profile ?? (await getApiCallerProfile(request));
  if (!profile) {
    return NextResponse.json(
      { error: "غير مصرح — سجّل الدخول من بوابة المحاسب" },
      { status: 401 }
    );
  }

  let bodyPhone = "";
  try {
    const body = await request.json();
    bodyPhone = (body?.phone as string)?.trim() ?? "";
  } catch {
    /* empty body ok */
  }

  const supabase = await createApiSessionClient(request);
  const { data: profileRow } = await supabase
    .from("profiles")
    .select("phone")
    .eq("id", profile.id)
    .maybeSingle();

  const rawPhone =
    bodyPhone ||
    process.env.WHATSAPP_TEST_PHONE?.trim() ||
    (profileRow?.phone as string | null)?.trim() ||
    "";

  if (!rawPhone) {
    return NextResponse.json(
      {
        error:
          "أدخل رقم هاتفك في النافذة، أو ضعه في ملفك (المستخدمين) أو WHATSAPP_TEST_PHONE",
      },
      { status: 400 }
    );
  }

  const validated = validatePatientPhone(rawPhone);
  if (!validated.ok) {
    return NextResponse.json({ error: validated.message }, { status: 400 });
  }

  const resolved = await resolveWhatsAppClinic(supabase, profile.clinic_id);
  if (!resolved) {
    const err = whatsappNoClinicError();
    return NextResponse.json(err, { status: 400 });
  }

  const { clinicId, clinicName } = resolved;
  const messageBody = testNotificationMessage(clinicName);

  const outcome = await deliverWhatsAppMessage(supabase, {
    clinicId,
    rawPhone: validated.normalized,
    messageBody,
    messageType: "test_notification",
  });

  const instanceName = await resolveWhatsAppInstanceForClinic(clinicId);
  const session = await resolveEvolutionSession(instanceName, { skipCache: true });

  if (!outcome.ok && outcome.configured) {
    console.error("[whatsapp/test] failed", {
      providerError: outcome.providerError,
      status: outcome.providerStatus,
      phone: outcome.normalizedPhone,
    });
    return NextResponse.json(
      {
        ok: false,
        error: "فشل إرسال الرسالة التجريبية",
        providerError: outcome.providerError,
        normalizedPhone: outcome.normalizedPhone,
        hint: "راجع سجلات الاستضافة أو Supabase — ابحث عن [whatsapp]",
      },
      { status: 502 }
    );
  }

  const deliveryNote = outcome.deliveryWarning
    ? describeWhatsAppDeliveryError(outcome.deliveryWarning)
    : null;

  return NextResponse.json({
    ok: true,
    status: outcome.status,
    normalizedPhone: outcome.normalizedPhone,
    configured: outcome.configured,
    providerMessageStatus: outcome.providerMessageStatus ?? null,
    deliveryWarning: outcome.deliveryWarning ?? null,
    deliveryNote,
    linkedPhoneDisplay: session.linkedPhone
      ? phoneToLocalDisplay(session.linkedPhone)
      : null,
    evolutionLinked: session.linked,
    message:
      outcome.status === "pending"
        ? "لم يُضبط WHATSAPP_API_URL — سُجّلت الرسالة كمعلّقة"
        : deliveryNote
          ? "قبل Evolution الطلب — تحقق من وصول الرسالة على الجوال"
          : "تم إرسال الرسالة التجريبية — تحقق من وصولها خلال دقيقة",
  });
}
