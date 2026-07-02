import { NextRequest, NextResponse } from "next/server";
import {
  createApiSessionClient,
  getApiCallerProfile,
  isApiAssistantRole,
  isApiStaffRole,
} from "@/lib/auth/api-session";
import { getAdminClient } from "@/lib/supabase/admin";
import { getPatientDisplayPhone, validatePatientPhone } from "@/lib/phone";
import {
  resolveWhatsAppClinic,
  whatsappNoClinicError,
} from "@/lib/whatsapp/resolve-clinic";
import { getWhatsAppConfig } from "@/lib/whatsapp/config";
import { resolveEvolutionSession } from "@/lib/whatsapp/evolution-client";
import { resolveWhatsAppInstanceForClinic } from "@/lib/whatsapp/resolve-instance";
import { describeWhatsAppDeliveryError } from "@/lib/whatsapp/delivery-errors";
import { sendAccountingWhatsAppPackage } from "@/lib/whatsapp/session-package-server";

const MAX_PDF_BYTES = 8 * 1024 * 1024;

function validatePdfSize(base64: string | undefined | null): string | null {
  if (!base64?.trim()) return null;
  const approxBytes = Math.ceil((base64.trim().length * 3) / 4);
  if (approxBytes > MAX_PDF_BYTES) return "حجم ملف PDF كبير جداً";
  return null;
}

/** POST — إرسال يدوي: نص تفاصيل + PDF فاتورة + PDF وصفة (اختياري) */
export async function POST(req: NextRequest) {
  try {
    const profile = await getApiCallerProfile(req);
    if (!profile?.clinic_id) {
      return NextResponse.json({ error: "غير مصرح" }, { status: 401 });
    }

    const role = String(profile.role ?? "");
    if (!isApiStaffRole(role) && !isApiAssistantRole(role)) {
      return NextResponse.json({ error: "غير مصرح" }, { status: 403 });
    }

    const body = (await req.json().catch(() => ({}))) as {
      operation_id?: string;
      queue_entry_id?: string;
      phone?: string;
      patient_id?: string;
      invoice_text?: string;
      invoice_pdf_base64?: string;
      invoice_filename?: string;
      prescription_pdf_base64?: string;
      prescription_filename?: string;
      prescription_caption?: string;
    };

    const operationId = String(body.operation_id ?? "").trim();
    const invoiceText = String(body.invoice_text ?? "").trim();
    if (!operationId || !invoiceText) {
      return NextResponse.json(
        { error: "operation_id و invoice_text مطلوبان" },
        { status: 400 }
      );
    }

    for (const b64 of [body.invoice_pdf_base64, body.prescription_pdf_base64]) {
      const sizeErr = validatePdfSize(b64);
      if (sizeErr) {
        return NextResponse.json({ error: sizeErr }, { status: 400 });
      }
    }

    const supabase = await createApiSessionClient(req);
    const resolved = await resolveWhatsAppClinic(supabase, profile.clinic_id);
    if (!resolved) {
      return NextResponse.json(whatsappNoClinicError(), { status: 400 });
    }

    const admin = getAdminClient();
    let phone = String(body.phone ?? "").trim();

    if (!phone && body.patient_id) {
      const { data: patient } = await admin
        .from("patients")
        .select("phone, phone_number")
        .eq("id", body.patient_id)
        .eq("clinic_id", profile.clinic_id)
        .maybeSingle();
      phone = getPatientDisplayPhone(patient ?? {}) || "";
    }

    if (!phone) {
      const { data: op } = await admin
        .from("patient_operations")
        .select("patient:patients(phone, phone_number)")
        .eq("id", operationId)
        .eq("clinic_id", profile.clinic_id)
        .maybeSingle();
      const patient = op?.patient as {
        phone?: string | null;
        phone_number?: string | null;
      } | null;
      phone = getPatientDisplayPhone(patient ?? {}) || "";
    }

    if (!phone) {
      return NextResponse.json(
        { error: describeWhatsAppDeliveryError("no_patient_phone") },
        { status: 400 }
      );
    }

    const phoneCheck = validatePatientPhone(phone);
    if (!phoneCheck.ok) {
      return NextResponse.json({ error: phoneCheck.message }, { status: 400 });
    }
    phone = phoneCheck.normalized;

    const cfg = getWhatsAppConfig();
    if (cfg.configured && cfg.provider === "evolution") {
      const instanceName = await resolveWhatsAppInstanceForClinic(
        resolved.clinicId
      );
      const session = await resolveEvolutionSession(instanceName);
      if (!session.linked) {
        return NextResponse.json(
          {
            error: describeWhatsAppDeliveryError("whatsapp_not_linked"),
            hint: `جلسة واتساب عيادتك (${instanceName}) غير متصلة — افتح /dashboard/whatsapp وامسح QR`,
            instanceName,
            configured: true,
          },
          { status: 400 }
        );
      }
    }

    const result = await sendAccountingWhatsAppPackage(admin, {
      clinicId: resolved.clinicId,
      operationId,
      queueEntryId: body.queue_entry_id ?? null,
      phone,
      invoiceText,
      invoicePdfBase64: body.invoice_pdf_base64 ?? null,
      invoiceFileName: body.invoice_filename,
      prescriptionPdfBase64: body.prescription_pdf_base64 ?? null,
      prescriptionFileName: body.prescription_filename,
      prescriptionCaption: body.prescription_caption,
    });

    if (!result.ok && result.configured) {
      return NextResponse.json(
        {
          ...result,
          error: result.errors.join(" — ") || "تعذر إرسال الحزمة",
          configured: true,
        },
        { status: 502 }
      );
    }

    return NextResponse.json(result);
  } catch (err) {
    console.error("[whatsapp/send-session-package]", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "خطأ" },
      { status: 500 }
    );
  }
}
