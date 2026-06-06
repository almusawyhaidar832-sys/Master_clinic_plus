import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import { formatCurrency } from "@/lib/utils";
import { deliverWhatsAppMessage } from "@/lib/whatsapp/send-message";
import { isPersistedTreatmentCaseId } from "@/lib/services/patient-treatment-cases";

const XRAY_BUCKET = "clinical-xrays";
const LINK_TTL_SEC = 60 * 60 * 24;

function num(v: unknown): number {
  const n = Number(v ?? 0);
  return Number.isFinite(n) ? n : 0;
}

export type WhatsAppSessionRow = {
  id: string;
  paid_amount: number;
  notes?: string | null;
};

export type CurrentCase = {
  id: string;
  treatment_name_ar: string;
  total_price: number;
  status: string;
  notes: string | null;
  fdi_chart_url: string | null;
  xrays_url: string | null;
  sessions: WhatsAppSessionRow[];
  remaining_balance: number;
  paid_this_session: number;
  session_number: number;
  total_sessions: number;
};

async function signedStorageUrl(
  supabase: SupabaseClient,
  storagePath: string
): Promise<string | null> {
  const { data, error } = await supabase.storage
    .from(XRAY_BUCKET)
    .createSignedUrl(storagePath, LINK_TTL_SEC);
  if (error || !data?.signedUrl) return null;
  return data.signedUrl;
}

function isChartFile(fileName: string): boolean {
  return /chart|fdi|مخطط|أسنان|dental/i.test(fileName);
}

function isXrayImageFile(fileName: string, mimeType: string): boolean {
  const name = fileName.toLowerCase();
  if (mimeType === "application/pdf" || name.endsWith(".pdf")) return false;
  return mimeType.startsWith("image/") || /\.(jpe?g|png|webp)$/i.test(name);
}

/** استعلام مباشر — cases + sessions + notes + fdi_chart_url + xrays_url + رقم الجلسة */
export async function fetchCurrentCaseFromDb(
  supabase: SupabaseClient,
  caseId: string,
  operationId: string
): Promise<CurrentCase | null> {
  if (!isPersistedTreatmentCaseId(caseId)) return null;

  const { data: currentCase, error: caseErr } = await supabase
    .from("patient_treatment_cases")
    .select(
      "id, treatment_name_ar, final_price, case_price, discount_total, total_paid, status"
    )
    .eq("id", caseId)
    .single();

  if (caseErr || !currentCase) {
    console.error("[sendUnifiedWhatsApp] fetch case failed", caseErr?.message);
    return null;
  }

  const { data: sessionsRaw } = await supabase
    .from("patient_operations")
    .select("id, paid_amount, notes, created_at")
    .eq("treatment_case_id", caseId)
    .order("created_at", { ascending: true });

  const sessions: WhatsAppSessionRow[] = (sessionsRaw ?? []).map((row) => {
    const r = row as {
      id: string;
      paid_amount?: unknown;
      notes?: string | null;
    };
    return {
      id: String(r.id),
      paid_amount: num(r.paid_amount),
      notes: r.notes ?? null,
    };
  });

  if (operationId && !sessions.some((s) => s.id === operationId)) {
    const { data: currentOp } = await supabase
      .from("patient_operations")
      .select("id, paid_amount, notes")
      .eq("id", operationId)
      .maybeSingle();
    if (currentOp) {
      sessions.push({
        id: String(currentOp.id),
        paid_amount: num(currentOp.paid_amount),
        notes: (currentOp as { notes?: string | null }).notes ?? null,
      });
    }
  }

  const total_sessions = Math.max(1, sessions.length);
  const sessionIdx = operationId
    ? sessions.findIndex((s) => s.id === operationId)
    : sessions.length - 1;
  const session_number = Math.max(1, sessionIdx >= 0 ? sessionIdx + 1 : total_sessions);

  const allOpIds = [
    ...new Set([
      ...sessions.map((s) => s.id),
      ...(operationId ? [operationId] : []),
    ]),
  ].filter(Boolean);

  const noteLines: string[] = [];

  if (allOpIds.length > 0) {
    const { data: teeth } = await supabase
      .from("operation_tooth_records")
      .select("tooth_number, procedure_ar, note")
      .in("operation_id", allOpIds)
      .order("tooth_number", { ascending: true });

    for (const row of teeth ?? []) {
      const r = row as {
        tooth_number: number;
        procedure_ar?: string | null;
        note?: string | null;
      };
      const note = String(r.note ?? "").trim();
      const proc = String(r.procedure_ar ?? "").trim();
      if (note && proc) noteLines.push(`سن ${r.tooth_number}: ${proc} — ${note}`);
      else if (note) noteLines.push(`سن ${r.tooth_number}: ${note}`);
      else if (proc) noteLines.push(`سن ${r.tooth_number}: ${proc}`);
    }
  }

  const currentSession =
    sessions.find((s) => s.id === operationId) ?? sessions.at(-1);
  const sessionNote = String(currentSession?.notes ?? "").trim();
  if (sessionNote) noteLines.unshift(sessionNote);

  let fdi_chart_url: string | null = null;
  let xrays_url: string | null = null;

  if (allOpIds.length > 0) {
    const { data: xrayRows } = await supabase
      .from("operation_xray_images")
      .select("storage_path, file_name, mime_type, created_at")
      .in("operation_id", allOpIds)
      .order("created_at", { ascending: false });

    for (const row of xrayRows ?? []) {
      const rec = row as Record<string, unknown>;
      const path = String(rec.storage_path ?? "").trim();
      if (!path) continue;
      const fileName = String(rec.file_name ?? "");
      const mimeType = String(rec.mime_type ?? "");

      if (!fdi_chart_url && isChartFile(fileName)) {
        fdi_chart_url = await signedStorageUrl(supabase, path);
      } else if (!xrays_url && isXrayImageFile(fileName, mimeType)) {
        xrays_url = await signedStorageUrl(supabase, path);
      }
      if (fdi_chart_url && xrays_url) break;
    }
  }

  const row = currentCase as Record<string, unknown>;
  const total_price =
    num(row.final_price) ||
    Math.max(0, num(row.case_price) - num(row.discount_total));
  const paidSum = sessions.reduce((sum, s) => sum + s.paid_amount, 0);
  const remaining_balance = Math.max(0, total_price - paidSum);

  let paid_this_session = 0;
  if (operationId) {
    const { data: opRow } = await supabase
      .from("patient_operations")
      .select("paid_amount")
      .eq("id", operationId)
      .maybeSingle();
    paid_this_session = num(
      (opRow as { paid_amount?: unknown } | null)?.paid_amount
    );
  }

  return {
    id: String(row.id),
    treatment_name_ar:
      String(row.treatment_name_ar ?? "علاج").trim() || "علاج",
    total_price,
    status: String(row.status ?? "active").trim() || "active",
    notes: noteLines.length > 0 ? noteLines.join("\n") : null,
    fdi_chart_url,
    xrays_url,
    sessions,
    remaining_balance,
    paid_this_session,
    session_number,
    total_sessions,
  };
}

type MessageAudience = "patient" | "doctor";

/** قالب موحّد احترافي — المراجع والطبيب */
function buildUnifiedWhatsAppBody(
  currentCase: CurrentCase,
  params: {
    patientName: string;
    doctorName: string;
    clinicName: string;
  },
  audience: MessageAudience
): string {
  const paid = formatCurrency(Math.max(0, currentCase.paid_this_session));
  const remaining = formatCurrency(currentCase.remaining_balance);
  const divider = "─────────────────";
  const detailsTitle =
    audience === "patient" ? "تفاصيل زيارتك" : "ملخص الجلسة";

  const header =
    audience === "patient"
      ? `🏥 *${params.clinicName}*\n${divider}\n\nمرحباً *${params.patientName}* 👋`
      : `🏥 *تقرير زيارة — ${params.clinicName}*\n${divider}`;

  let message = header;

  if (currentCase.status === "completed") {
    message += `\n\n🎉 *مبروك إتمام العلاج*`;
  }

  message += `

📋 *${detailsTitle}:*
🔢 *الجلسة:* ${currentCase.session_number} من أصل ${currentCase.total_sessions}
${divider}

👤 *المراجع:* ${params.patientName}
👨‍⚕️ *الطبيب المشرف:* ${params.doctorName}
🦷 *الإجراء:* ${currentCase.treatment_name_ar}
💰 *المبلغ المدفوع (هذه الجلسة):* ${paid}
📊 *الذمة المتبقية الكلية:* ${remaining}`;

  if (currentCase.notes) {
    message += `\n\n📝 *ملاحظات الطبيب:*\n${currentCase.notes}`;
  }

  if (currentCase.xrays_url || currentCase.fdi_chart_url) {
    message += `\n\n📎 *المرفقات الطبية:*`;
    if (currentCase.xrays_url) {
      message += `\n🩻 *الأشعة:* ${currentCase.xrays_url}`;
    }
    if (currentCase.fdi_chart_url) {
      message += `\n🦷 *المخطط:* ${currentCase.fdi_chart_url}`;
    }
    message += `\n_(الروابط صالحة لمدة 24 ساعة)_`;
  }

  if (audience === "patient") {
    message += `\n\n${divider}

نحن نهتم لأدق التفاصيل في علاجك، ونتمنى لك دوام الصحة والشفاء العاجل 🌿

مع تحيات فريق *${params.clinicName}* الطبي 🤍`;
  } else {
    message += `\n\n${divider}\n📲 *${params.clinicName}* — إشعار متابعة`;
  }

  return message;
}

export type SendUnifiedWhatsAppInput = {
  supabase: SupabaseClient;
  operationId: string;
  caseId: string | null;
  clinicId: string;
  clinicName: string;
  patientName: string;
  doctorName: string;
  patientPhone?: string | null;
  doctorPhone?: string | null;
  skipPatient?: boolean;
  skipDoctor?: boolean;
  patientMessageType?: "session_update" | "treatment_completed";
};

export type SendUnifiedWhatsAppResult = {
  ok: boolean;
  patientBody: string | null;
  doctorBody: string | null;
  patientSent: boolean;
  doctorSent: boolean;
  patientPending: boolean;
  errors: string[];
  skipped?: string;
};

/**
 * نقطة إرسال واتساب الوحيدة — رسالة واحدة للمراجع ورسالة واحدة للطبيب
 * (ملاحظات + أشعة + مخطط FDI في نفس الرسالة).
 */
export async function sendUnifiedWhatsApp(
  input: SendUnifiedWhatsAppInput
): Promise<SendUnifiedWhatsAppResult> {
  const errors: string[] = [];
  const caseId = input.caseId?.trim() || null;

  if (!caseId || !isPersistedTreatmentCaseId(caseId)) {
    return {
      ok: false,
      patientBody: null,
      doctorBody: null,
      patientSent: false,
      doctorSent: false,
      patientPending: false,
      errors: ["missing_or_invalid_case_id"],
      skipped: "missing_case_id",
    };
  }

  const currentCase = await fetchCurrentCaseFromDb(
    input.supabase,
    caseId,
    input.operationId
  );

  if (!currentCase) {
    return {
      ok: false,
      patientBody: null,
      doctorBody: null,
      patientSent: false,
      doctorSent: false,
      patientPending: false,
      errors: ["case_fetch_failed"],
      skipped: "case_fetch_failed",
    };
  }

  const meta = {
    patientName: input.patientName,
    doctorName: input.doctorName,
    clinicName: input.clinicName,
  };

  const patientBody = buildUnifiedWhatsAppBody(currentCase, meta, "patient");
  const doctorBody = buildUnifiedWhatsAppBody(currentCase, meta, "doctor");

  console.log(
    "\n========== هذا هو نص الرسالة الذي سيصل للمراجع ==========\n"
  );
  console.log(patientBody);
  console.log(
    "\n==========================================================\n"
  );

  let patientSent = false;
  let doctorSent = false;
  let patientPending = false;

  if (!input.skipPatient && input.patientPhone?.trim()) {
    const wa = await deliverWhatsAppMessage(input.supabase, {
      clinicId: input.clinicId,
      rawPhone: input.patientPhone,
      messageBody: patientBody,
      messageType: input.patientMessageType ?? "session_update",
    });
    patientSent = wa.ok && wa.status === "sent";
    patientPending = !wa.configured || wa.status === "pending";
    if (!wa.ok && wa.configured) {
      errors.push(`patient_wa:${wa.providerError ?? wa.status}`);
    }
    if (!wa.configured) errors.push("whatsapp_not_configured");
  }

  if (!input.skipDoctor && input.doctorPhone?.trim()) {
    const wa = await deliverWhatsAppMessage(input.supabase, {
      clinicId: input.clinicId,
      rawPhone: input.doctorPhone,
      messageBody: doctorBody,
      messageType: "doctor_payment_alert",
    });
    doctorSent = wa.ok && wa.status === "sent";
    if (!wa.ok && wa.configured) {
      errors.push(`doctor_wa:${wa.providerError ?? wa.status}`);
    }
  }

  return {
    ok: errors.length === 0,
    patientBody,
    doctorBody,
    patientSent,
    doctorSent,
    patientPending,
    errors,
  };
}
