import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getClinicIdFromProfile } from "@/lib/clinic-context";
import { fetchClinicProfile, getClinicDisplayName } from "@/lib/services/clinic-profile";
import { getApiCallerProfile } from "@/lib/auth/api-session";
import { validatePatientPhone } from "@/lib/phone";
import { testNotificationMessage } from "@/lib/whatsapp";
import { deliverWhatsAppMessage } from "@/lib/whatsapp/send-message";

/**
 * POST /api/whatsapp/test
 * Body: { phone?: string } — defaults to WHATSAPP_TEST_PHONE env or profile.phone
 */
export async function POST(request: NextRequest) {
  const profile = await getApiCallerProfile();
  if (!profile) {
    return NextResponse.json({ error: "غير مصرح" }, { status: 401 });
  }

  let bodyPhone = "";
  try {
    const body = await request.json();
    bodyPhone = (body?.phone as string)?.trim() ?? "";
  } catch {
    /* empty body ok */
  }

  const supabase = await createClient();
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

  const clinic = await fetchClinicProfile(supabase);
  const clinicId = clinic?.id ?? (await getClinicIdFromProfile(supabase));
  if (!clinicId) {
    return NextResponse.json({ error: "لا توجد عيادة" }, { status: 400 });
  }

  const clinicName = getClinicDisplayName(clinic);
  const messageBody = testNotificationMessage(clinicName);

  const outcome = await deliverWhatsAppMessage(supabase, {
    clinicId,
    rawPhone: validated.normalized,
    messageBody,
    messageType: "test_notification",
  });

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

  return NextResponse.json({
    ok: true,
    status: outcome.status,
    normalizedPhone: outcome.normalizedPhone,
    configured: outcome.configured,
    message:
      outcome.status === "pending"
        ? "لم يُضبط WHATSAPP_API_URL — سُجّلت الرسالة كمعلّقة"
        : "تم إرسال الرسالة التجريبية",
  });
}
