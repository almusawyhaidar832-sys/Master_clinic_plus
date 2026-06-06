import type { SupabaseClient } from "@supabase/supabase-js";
import { formatCurrency } from "@/lib/utils";
import { getClinicDisplayName } from "@/lib/services/clinic-profile";
import { isPersistedTreatmentCaseId } from "@/lib/services/patient-treatment-cases";
import { FINANCIAL_EPSILON } from "@/lib/services/patient-financial-plan";
import type { ClinicProfile } from "@/types/clinic-profile";

const CLINICAL_XRAY_BUCKET = "clinical-xrays";
const MEDICAL_RECORD_LINK_TTL_SEC = 60 * 60 * 24;

type WhatsAppCaseContext = {
  treatment_name_ar?: string | null;
  notes?: string | null;
  medical_pdf_url?: string | null;
  xray_url?: string | null;
  FDI_chart_image_url?: string | null;
};

async function signedClinicalStorageUrl(
  admin: SupabaseClient,
  storagePath: string
): Promise<string | null> {
  const { data: signed, error } = await admin.storage
    .from(CLINICAL_XRAY_BUCKET)
    .createSignedUrl(storagePath, MEDICAL_RECORD_LINK_TTL_SEC);
  if (error || !signed?.signedUrl) return null;
  return signed.signedUrl;
}

function classifyClinicalFile(row: Record<string, unknown>): {
  path: string;
  isPdf: boolean;
  isChart: boolean;
  isImage: boolean;
} | null {
  const path = String(row.storage_path ?? "").trim();
  if (!path) return null;
  const name = String(row.file_name ?? "").toLowerCase();
  const mime = String(row.mime_type ?? "");
  const isPdf = mime === "application/pdf" || name.endsWith(".pdf");
  const isChart = /chart|fdi|مخطط|أسنان|dental/.test(name);
  const isImage =
    !isPdf &&
    (mime.startsWith("image/") || /\.(jpe?g|png|webp)$/i.test(name));
  return { path, isPdf, isChart, isImage };
}

async function fetchWhatsAppCaseContext(
  admin: SupabaseClient,
  input: { caseId?: string | null; operationId?: string | null }
): Promise<WhatsAppCaseContext> {
  const caseCtx: WhatsAppCaseContext = {};
  const operationId = input.operationId?.trim();

  if (operationId) {
    const { data: teeth } = await admin
      .from("operation_tooth_records")
      .select("tooth_number, procedure_ar, note")
      .eq("operation_id", operationId)
      .order("tooth_number", { ascending: true });

    const noteLines = (teeth ?? [])
      .map((row) => {
        const rec = row as {
          tooth_number: number;
          procedure_ar?: string | null;
          note?: string | null;
        };
        const proc = String(rec.procedure_ar ?? "").trim();
        const note = String(rec.note ?? "").trim();
        if (note && proc) return `سن ${rec.tooth_number}: ${proc} — ${note}`;
        if (note) return `سن ${rec.tooth_number}: ${note}`;
        if (proc) return `سن ${rec.tooth_number}: ${proc}`;
        return "";
      })
      .filter(Boolean);

    if (noteLines.length > 0) {
      caseCtx.notes = noteLines.join("\n");
    }
  }

  const caseId = input.caseId?.trim();
  if (!caseId || !isPersistedTreatmentCaseId(caseId)) {
    return caseCtx;
  }

  const { data: caseRow } = await admin
    .from("patient_treatment_cases")
    .select("treatment_name_ar")
    .eq("id", caseId)
    .maybeSingle();

  if (caseRow) {
    const name = String(caseRow.treatment_name_ar ?? "").trim();
    if (name) caseCtx.treatment_name_ar = name;
  }

  const { data: ops } = await admin
    .from("patient_operations")
    .select("id")
    .eq("treatment_case_id", caseId);

  const opIds = (ops ?? [])
    .map((row) => String((row as { id?: string }).id ?? "").trim())
    .filter(Boolean);

  if (!opIds.length) return caseCtx;

  const { data: xrayRows } = await admin
    .from("operation_xray_images")
    .select("storage_path, file_name, mime_type, created_at")
    .in("operation_id", opIds)
    .order("created_at", { ascending: false });

  let pdfPath: string | null = null;
  let chartPath: string | null = null;
  let xrayPath: string | null = null;

  for (const row of xrayRows ?? []) {
    const file = classifyClinicalFile(row as Record<string, unknown>);
    if (!file) continue;
    if (file.isPdf && !pdfPath) {
      pdfPath = file.path;
      continue;
    }
    if (file.isChart && !chartPath) {
      chartPath = file.path;
      continue;
    }
    if (file.isImage && !xrayPath && file.path !== chartPath) {
      xrayPath = file.path;
    }
  }

  if (pdfPath) {
    caseCtx.medical_pdf_url = await signedClinicalStorageUrl(admin, pdfPath);
  }
  if (chartPath) {
    caseCtx.FDI_chart_image_url = await signedClinicalStorageUrl(admin, chartPath);
  }
  if (xrayPath) {
    caseCtx.xray_url = await signedClinicalStorageUrl(admin, xrayPath);
  }

  return caseCtx;
}

function formatMedicalRecordLinks(caseCtx: WhatsAppCaseContext): string {
  const lines: string[] = [];
  if (caseCtx.medical_pdf_url) {
    lines.push(`📄 PDF: ${caseCtx.medical_pdf_url}`);
  }
  if (caseCtx.FDI_chart_image_url) {
    lines.push(`🦷 مخطط الأسنان (FDI): ${caseCtx.FDI_chart_image_url}`);
  }
  if (caseCtx.xray_url) {
    lines.push(`🩻 الأشعة: ${caseCtx.xray_url}`);
  }
  return lines.join("\n");
}

function hasMedicalRecordLinks(caseCtx: WhatsAppCaseContext): boolean {
  return Boolean(
    caseCtx.medical_pdf_url ||
      caseCtx.FDI_chart_image_url ||
      caseCtx.xray_url
  );
}

export type WhatsAppNotificationParams = {
  admin: SupabaseClient;
  clinic?: ClinicProfile | null;
  clinicName?: string;
  patientName: string;
  doctorName: string;
  procedureLabel: string;
  paidThisSession: number;
  remainingBalance: number;
  treatmentCaseId?: string | null;
  operationId?: string | null;
};

/** رسالة واتساب للطبيب — منفصلة عن رسالة المراجع */
export async function buildDoctorWhatsAppMessage(
  params: WhatsAppNotificationParams
): Promise<string> {
  const clinicName =
    params.clinicName ?? getClinicDisplayName(params.clinic ?? null);
  const doctorLine = params.doctorName.trim() || "طبيب";
  const procedureLabel =
    params.procedureLabel.trim() || "علاج";
  const remainingBalance = Math.max(0, params.remainingBalance);
  const paid = formatCurrency(Math.max(0, params.paidThisSession));
  const remaining = formatCurrency(remainingBalance);

  const caseCtx = await fetchWhatsAppCaseContext(params.admin, {
    caseId: params.treatmentCaseId,
    operationId: params.operationId,
  });

  const resolvedProcedure =
    String(caseCtx.treatment_name_ar ?? "").trim() || procedureLabel;

  let notesBlock = "";
  if (caseCtx.notes) {
    notesBlock = `\n📝 *ملاحظات الطبيب:*\n${caseCtx.notes}`;
  }

  let medicalBlock = "";
  if (hasMedicalRecordLinks(caseCtx)) {
    medicalBlock = `\n📎 *السجل الطبي:*\n${formatMedicalRecordLinks(caseCtx)}\n(الروابط صالحة لمدة 24 ساعة)`;
  }

  return `🏥 *تقرير زيارة - ${clinicName}*

👨‍⚕️ *الطبيب:* ${doctorLine}
👤 *المراجع:* ${params.patientName}
🦷 *الإجراء:* ${resolvedProcedure}${notesBlock}
💰 *الدفعة الحالية:* ${paid}
📊 *الذمة المتبقية الكلية:* ${remaining}${medicalBlock}`;
}

/** رسالة واتساب للمراجع — منفصلة عن رسالة الطبيب */
export async function buildPatientWhatsAppMessage(
  params: WhatsAppNotificationParams
): Promise<string> {
  const clinicName =
    params.clinicName ?? getClinicDisplayName(params.clinic ?? null);
  const doctorLine = params.doctorName.trim() || "فريقنا الطبي";
  const procedureLabel = params.procedureLabel.trim() || "علاج";
  const remainingBalance = Math.max(0, params.remainingBalance);
  const paid = formatCurrency(Math.max(0, params.paidThisSession));
  const remaining = formatCurrency(remainingBalance);

  const caseCtx = await fetchWhatsAppCaseContext(params.admin, {
    caseId: params.treatmentCaseId,
    operationId: params.operationId,
  });

  const resolvedProcedure =
    String(caseCtx.treatment_name_ar ?? "").trim() || procedureLabel;

  let medicalBlock = "";
  if (hasMedicalRecordLinks(caseCtx)) {
    medicalBlock = `\n\n📄 *السجل الطبي البصري:*\n${formatMedicalRecordLinks(caseCtx)}\n(الروابط صالحة لمدة 24 ساعة — يرجى فتحها من جوالكم)`;
  }

  return `🏥 *${clinicName}*

أهلاً بك يا *${params.patientName}*،

📋 *تفاصيل زيارتك:*

👨‍⚕️ *الطبيب المشرف:* ${doctorLine}
🦷 *الإجراء:* ${resolvedProcedure}
💰 *المبلغ المدفوع:* ${paid}
📊 *إجمالي الذمة المتبقية:* ${remaining}${medicalBlock}

نحن نهتم لأدق التفاصيل في علاجك، ونتمنى لك دوام الصحة والشفاء العاجل.

مع تحيات فريق *${clinicName}* الطبي.`;
}

/** @deprecated استخدم buildPatientWhatsAppMessage أو buildDoctorWhatsAppMessage */
export type BuildWhatsAppMessageParams = WhatsAppNotificationParams;

/** @deprecated استخدم buildPatientWhatsAppMessage */
export async function buildWhatsAppMessage(
  params: BuildWhatsAppMessageParams
): Promise<string> {
  return buildPatientWhatsAppMessage(params);
}

const SESSION_ORDINAL_AR: Record<number, string> = {
  1: "الأولى",
  2: "الثانية",
  3: "الثالثة",
  4: "الرابعة",
  5: "الخامسة",
  6: "السادسة",
  7: "السابعة",
  8: "الثامنة",
  9: "التاسعة",
  10: "العاشرة",
};

/** حالة العلاج من ذمة الحالة فقط — لا من patients.treatment_status */
export function treatmentStatusAr(
  _status: string | null | undefined,
  remaining: number,
  caseFinalPrice?: number
): string {
  const finalP =
    caseFinalPrice != null && Number.isFinite(caseFinalPrice)
      ? caseFinalPrice
      : 0;
  if (finalP > FINANCIAL_EPSILON && remaining <= FINANCIAL_EPSILON) {
    return "مكتملة";
  }
  return "قيد العلاج";
}

export type SessionWhatsAppKind = "first" | "follow_up" | "completed";

export function resolveSessionWhatsAppKind(
  sessionNumber: number,
  treatmentCompleted: boolean
): SessionWhatsAppKind {
  if (treatmentCompleted) return "completed";
  if (sessionNumber <= 1) return "first";
  return "follow_up";
}

type CaseLinkedOperation = {
  id: string;
  treatment_case_id?: string | null;
};

/**
 * COUNT(*) WHERE treatment_case_id = caseId
 * لا يُعدّ كل جلسات المراجع — فقط جلسات هذه الحالة.
 */
export function countSessionsByCaseId(
  operations: CaseLinkedOperation[],
  caseId: string,
  currentOperationId?: string
): number {
  const cid = caseId.trim();
  if (!cid) return 1;

  const linked = operations.filter((o) => o.treatment_case_id?.trim() === cid);
  if (
    currentOperationId &&
    !linked.some((o) => o.id === currentOperationId)
  ) {
    return Math.max(1, linked.length + 1);
  }
  return Math.max(1, linked.length);
}

/** سطر تقدم الجلسة — رقم الجلسة وإجمالي جلسات هذه الحالة فقط */
export function sessionProgressLineAr(
  sessionNumber: number,
  totalInCase?: number
): string {
  const n = Math.max(1, Math.round(sessionNumber));
  const total = Math.max(n, Math.round(totalInCase ?? n));
  const ordinal = SESSION_ORDINAL_AR[n];
  const label = ordinal ? `الجلسة ${ordinal}` : `الجلسة رقم ${n}`;
  return `تم *إكمال ${label} من أصل ${total}*`;
}

export type FormattedSessionMessageParams = {
  clinic?: ClinicProfile | null;
  clinicName?: string;
  patientName: string;
  doctorName: string;
  caseId: string | null;
  operations: CaseLinkedOperation[];
  currentOperationId: string;
  paidThisSession: number;
  /** المتبقي لهذه الحالة تحديداً */
  remainingBalance: number;
  treatmentStatus: string;
  procedureLabel: string;
  teethSummary?: string;
  /** من استعلام COUNT مباشر قبل الإرسال */
  sessionCountFromDb?: number;
  totalSessionsInCase?: number;
  caseFinalPrice?: number;
};

/**
 * بناء رسالة الواتساب:
 * - العد: COUNT WHERE case_id = الحالة الحالية
 * - remaining_balance = 0 → اكتمال العلاج
 * - غير ذلك → الجلسة الأولى / الثانية / رقم X
 */
export function getFormattedSessionMessage(
  params: FormattedSessionMessageParams
): string {
  const clinicName =
    params.clinicName ?? getClinicDisplayName(params.clinic ?? null);
  const paid = formatCurrency(Math.max(0, params.paidThisSession));
  const remaining = formatCurrency(Math.max(0, params.remainingBalance));
  const doctorLine = params.doctorName.trim() || "فريقنا الطبي";
  const sessionNumber =
    params.sessionCountFromDb != null &&
    Number.isFinite(params.sessionCountFromDb)
      ? Math.max(1, Math.round(params.sessionCountFromDb))
      : 1;
  const totalInCase = Math.max(
    sessionNumber,
    Math.round(params.totalSessionsInCase ?? sessionNumber)
  );
  const caseFinal =
    params.caseFinalPrice != null && Number.isFinite(params.caseFinalPrice)
      ? params.caseFinalPrice
      : 0;
  const treatmentCompleted =
    caseFinal > FINANCIAL_EPSILON &&
    params.remainingBalance <= FINANCIAL_EPSILON;

  const teethBlock = params.teethSummary
    ? `\n\n🦷 تفاصيل إضافية:\n${params.teethSummary}`
    : "";

  const summary = `ملخص زيارتك:
• الإجراء: ${params.procedureLabel}
• الحالة: ${params.treatmentStatus}
• المبلغ المدفوع: ${paid}
• المبلغ المتبقي (الذمة): ${remaining}${teethBlock}`;

  const footer = `نحن نهتم لأدق التفاصيل في علاجك، ونتمنى لك دوام الصحة والشفاء العاجل. ابتسامتك هي نجاحنا!

مع تحيات فريق ${clinicName} الطبي.`;

  if (treatmentCompleted) {
    return `🎉 *تم إكمال العلاج بنجاح*

أهلاً بك يا ${params.patientName} في ${clinicName}.

يسعدنا إبلاغك بأنه قد *اكتملت خطتك العلاجية بالكامل* تحت إشراف الدكتور/ة: ${doctorLine}.

لا توجد ذمة متبقية على هذه الحالة — شكراً لثقتكم ولمتابعتكم معنا حتى النهاية.

${summary}

${footer}`;
  }

  const progressLine = sessionProgressLineAr(sessionNumber, totalInCase);

  return `أهلاً بك يا ${params.patientName} في ${clinicName}.

${progressLine} بنجاح تحت إشراف الدكتور/ة: ${doctorLine}.

${summary}

نحن بانتظاركم في الجلسة القادمة لمتابعة خطتكم العلاجية.

${footer}`;
}

export function patientSessionWhatsAppMessage(params: {
  clinic?: ClinicProfile | null;
  clinicName?: string;
  patientName: string;
  doctorName: string;
  sessionNumber: number;
  totalSessionsInCase: number;
  paidThisSession: number;
  remainingBalance: number;
  treatmentStatus: string;
  procedureLabel: string;
  teethSummary?: string;
  kind: SessionWhatsAppKind;
  caseId?: string | null;
  operations?: CaseLinkedOperation[];
  currentOperationId?: string;
  sessionCountFromDb?: number;
  caseFinalPrice?: number;
}): string {
  return getFormattedSessionMessage({
    clinic: params.clinic,
    clinicName: params.clinicName,
    patientName: params.patientName,
    doctorName: params.doctorName,
    caseId: params.caseId ?? null,
    operations: params.operations ?? [],
    currentOperationId: params.currentOperationId ?? "",
    paidThisSession: params.paidThisSession,
    remainingBalance: params.remainingBalance,
    treatmentStatus: params.treatmentStatus,
    procedureLabel: params.procedureLabel,
    teethSummary: params.teethSummary,
    sessionCountFromDb: params.sessionCountFromDb ?? params.sessionNumber,
    totalSessionsInCase: params.totalSessionsInCase ?? params.sessionNumber,
    caseFinalPrice: params.caseFinalPrice,
  });
}

/** @deprecated استخدم patientSessionWhatsAppMessage */
export function sessionUpdateWhatsAppMessage(params: {
  clinic?: ClinicProfile | null;
  clinicName?: string;
  patientName: string;
  doctorName: string;
  sessionNumber: number;
  totalSessionsInCase?: number;
  paidThisSession: number;
  remainingBalance: number;
  treatmentStatus: string;
  procedureLabel: string;
  teethSummary?: string;
  treatmentCompleted?: boolean;
}): string {
  const kind = resolveSessionWhatsAppKind(
    params.sessionNumber,
    Boolean(params.treatmentCompleted)
  );
  return patientSessionWhatsAppMessage({
    ...params,
    totalSessionsInCase: params.totalSessionsInCase ?? params.sessionNumber,
    kind,
  });
}

export function xrayLinkWhatsAppMessage(params: {
  clinic?: ClinicProfile | null;
  clinicName?: string;
  patientName: string;
  sessionNumber: number;
  totalSessionsInCase?: number;
  imageUrl: string;
  fileName?: string | null;
}): string {
  const clinicName =
    params.clinicName ?? getClinicDisplayName(params.clinic ?? null);
  const nameLine = params.fileName ? `\n📎 ${params.fileName}` : "";

  return `عزيزنا/عزيزتنا ${params.patientName}،

🏥 ${clinicName}
📋 الجلسة رقم ${params.sessionNumber} من أصل ${Math.max(1, params.totalSessionsInCase ?? params.sessionNumber)}

تم رفع صورة أشعة لسجلّكم:${nameLine}

🔗 رابط الصورة (صالح لمدة 24 ساعة):
${params.imageUrl}

يرجى فتح الرابط من جوالكم.`;
}

export function doctorPaymentAlertMessage(params: {
  patientName: string;
  paidAmount: number;
  remainingBalance: number;
  procedureLabel: string;
  teethSummary?: string;
  sessionNumber: number;
  totalSessionsInCase?: number;
}): string {
  const teethBlock = params.teethSummary
    ? `\n🦷 الأسنان: ${params.teethSummary}`
    : "";
  const total = Math.max(1, params.totalSessionsInCase ?? params.sessionNumber);

  return `🔔 دفعة جديدة — جلسة ${params.sessionNumber} من أصل ${total}

👤 ${params.patientName}
💰 مدفوع: ${formatCurrency(params.paidAmount)}
📊 متبقي: ${formatCurrency(Math.max(0, params.remainingBalance))}
📝 ${params.procedureLabel}${teethBlock}`;
}

export function doctorPaymentAlertTitle(): string {
  return "دفعة / جلسة مراجع";
}
