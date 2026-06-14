import { NextRequest, NextResponse } from "next/server";
import {
  createApiSessionClient,
  getApiCallerProfile,
  isApiAssistantRole,
  isApiDoctorRole,
  isApiStaffRole,
} from "@/lib/auth/api-session";
import { getAdminClient } from "@/lib/supabase/admin";
import { getPatientDisplayPhone } from "@/lib/phone";
import {
  resolveWhatsAppClinic,
  whatsappNoClinicError,
} from "@/lib/whatsapp/resolve-clinic";
import { deliverWhatsAppDocument } from "@/lib/whatsapp/send-message";
import { describeWhatsAppDeliveryError } from "@/lib/whatsapp/delivery-errors";
import { getWhatsAppConfig } from "@/lib/whatsapp/config";
import { resolveEvolutionSession } from "@/lib/whatsapp/evolution-client";
import { resolveWhatsAppInstanceForClinic } from "@/lib/whatsapp/resolve-instance";

const MAX_PDF_BYTES = 8 * 1024 * 1024;

/** POST — إرسال PDF (فاتورة / وصفة) للمراجع عبر واتساب */
export async function POST(req: NextRequest) {
  try {
    const profile = await getApiCallerProfile(req);
    if (!profile?.clinic_id) {
      return NextResponse.json({ error: "غير مصرح" }, { status: 401 });
    }

    const role = String(profile.role ?? "");
    if (!isApiStaffRole(role) && !isApiAssistantRole(role) && !isApiDoctorRole(role)) {
      return NextResponse.json({ error: "غير مصرح" }, { status: 403 });
    }

    const body = (await req.json().catch(() => ({}))) as {
      pdf_base64?: string;
      filename?: string;
      caption?: string;
      message_type?: string;
      phone?: string;
      patient_id?: string;
      operation_id?: string;
      prescription_id?: string;
    };

    const pdfBase64 = String(body.pdf_base64 ?? "").trim();
    if (!pdfBase64) {
      return NextResponse.json({ error: "pdf_base64 مطلوب" }, { status: 400 });
    }

    const approxBytes = Math.ceil((pdfBase64.length * 3) / 4);
    if (approxBytes > MAX_PDF_BYTES) {
      return NextResponse.json(
        { error: "حجم ملف PDF كبير جداً" },
        { status: 400 }
      );
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

    if (!phone && body.operation_id) {
      const { data: op } = await admin
        .from("patient_operations")
        .select("patient:patients(phone, phone_number)")
        .eq("id", body.operation_id)
        .eq("clinic_id", profile.clinic_id)
        .maybeSingle();
      const patient = op?.patient as {
        phone?: string | null;
        phone_number?: string | null;
      } | null;
      phone = getPatientDisplayPhone(patient ?? {}) || "";
    }

    if (!phone && body.prescription_id) {
      const { data: rx } = await admin
        .from("patient_prescriptions")
        .select("patient:patients(phone, phone_number)")
        .eq("id", body.prescription_id)
        .eq("clinic_id", profile.clinic_id)
        .maybeSingle();
      const patient = rx?.patient as {
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

    const caption = String(body.caption ?? "").trim() || "مرفق من العيادة";
    const fileName = String(body.filename ?? "document.pdf").trim() || "document.pdf";
    const messageType = String(body.message_type ?? "pdf_document").trim();

    const outcome = await deliverWhatsAppDocument(admin, {
      clinicId: resolved.clinicId,
      rawPhone: phone,
      caption,
      messageType,
      pdfBase64,
      fileName: fileName.endsWith(".pdf") ? fileName : `${fileName}.pdf`,
    });

    if (!outcome.ok && outcome.configured) {
      return NextResponse.json(
        {
          error: describeWhatsAppDeliveryError(
            outcome.providerError ?? "pdf_requires_evolution"
          ),
          configured: true,
        },
        { status: 502 }
      );
    }

    return NextResponse.json({
      ok: true,
      configured: outcome.configured,
      status: outcome.status,
    });
  } catch (err) {
    console.error("[whatsapp/send-pdf]", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "خطأ" },
      { status: 500 }
    );
  }
}
