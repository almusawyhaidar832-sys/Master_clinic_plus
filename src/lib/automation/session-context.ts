import type { SupabaseClient } from "@supabase/supabase-js";
import { getAdminClient } from "@/lib/supabase/admin";
import { resolveWhatsAppSessionMeta } from "@/lib/automation/whatsapp-session";
import {
  isPersistedTreatmentCaseId,
  resolveCaseIdForOp,
  type PatientTreatmentCase,
} from "@/lib/services/patient-treatment-cases";
import { FINANCIAL_EPSILON } from "@/lib/services/patient-financial-plan";
import { normalizePhoneForWhatsApp } from "@/lib/phone";
import { opName } from "@/types";
import { getPatientDisplayPhone } from "@/lib/phone";
import type { Patient, PatientOperation } from "@/types";

export type SessionAutomationContext = {
  operationId: string;
  clinicId: string;
  patientId: string;
  doctorId: string;
  treatmentCaseId: string | null;
  sessionNumber: number;
  totalSessionsInCase: number;
  patientName: string;
  patientPhone: string | null;
  doctorName: string;
  doctorPhone: string | null;
  doctorProfileId: string | null;
  procedureLabel: string;
  paidAmount: number;
  caseFinalPrice: number;
  caseTotalPaid: number;
  remainingBalance: number;
  treatmentStatus: string | null;
  sessionKind: string | null;
  teethSummary: string;
  /** للعد: COUNT(*) WHERE treatment_case_id = caseId */
  operationsForCount: Pick<PatientOperation, "id" | "treatment_case_id">[];
  clinic: {
    name: string;
    name_ar: string | null;
    phone: string | null;
    address: string | null;
    logo_url: string | null;
  };
};

function formatTeethSummary(
  rows: { tooth_number: number; procedure_ar: string }[]
): string {
  if (!rows.length) return "";
  return rows
    .sort((a, b) => a.tooth_number - b.tooth_number)
    .map((t) => `سن ${t.tooth_number}: ${t.procedure_ar}`)
    .join("\n");
}

function num(v: unknown): number {
  const n = Number(v ?? 0);
  return Number.isFinite(n) ? n : 0;
}

type OpRow = {
  id: string;
  clinic_id: string;
  patient_id: string;
  doctor_id: string;
  paid_amount?: number | null;
  remaining_debt?: number | null;
  total_amount?: number | null;
  session_kind?: string | null;
  created_at?: string | null;
  operation_name_ar?: string | null;
  operation_type?: string | null;
  treatment_case_id?: string | null;
};

const OP_SELECT_FULL =
  "id, clinic_id, patient_id, doctor_id, paid_amount, remaining_debt, total_amount, session_kind, created_at, operation_date, operation_name_ar, operation_type, treatment_case_id";

async function fetchOperationForAutomation(
  client: SupabaseClient,
  operationId: string
): Promise<OpRow | null> {
  const { data, error } = await client
    .from("patient_operations")
    .select(OP_SELECT_FULL)
    .eq("id", operationId)
    .maybeSingle();

  if (!error && data && typeof data === "object" && "id" in data) {
    return data as unknown as OpRow;
  }

  const wildcard = await client
    .from("patient_operations")
    .select("*")
    .eq("id", operationId)
    .maybeSingle();

  if (!wildcard.error && wildcard.data) {
    return wildcard.data as unknown as OpRow;
  }

  console.error(
    "[session-context] fetch op failed",
    operationId,
    wildcard.error?.message
  );
  return null;
}

export type LoadSessionContextOptions = {
  /** يُمرَّر من الواجهة بعد الحفظ — أدق من استنتاج السياق من الجلسة وحدها */
  treatmentCaseId?: string | null;
};

/** أرقام الحالة كما تظهر في الواجهة — تتجاوز أي استنتاج خاطئ من DB */
export type WhatsAppMessageSnapshot = {
  remainingBalance: number;
  sessionNumber: number;
  totalSessionsInCase: number;
  procedureLabel: string;
  paidThisSession: number;
  caseFinalPrice: number;
  caseTotalPaid: number;
};

export async function loadSessionAutomationContext(
  operationId: string,
  userClient?: SupabaseClient,
  options?: LoadSessionContextOptions
): Promise<SessionAutomationContext | null> {
  const admin = getAdminClient();
  let opRow = await fetchOperationForAutomation(admin, operationId);
  if (!opRow && userClient) {
    opRow = await fetchOperationForAutomation(userClient, operationId);
  }
  if (!opRow) return null;

  const op = opRow as unknown as PatientOperation;

  const [{ data: patient }, { data: doctor }, { data: clinic }, allOpsRes] =
    await Promise.all([
      admin
        .from("patients")
        .select("full_name_ar, phone, phone_number, treatment_status")
        .eq("id", op.patient_id)
        .maybeSingle(),
      admin
        .from("doctors")
        .select("full_name_ar, phone, profile_id")
        .eq("id", op.doctor_id)
        .maybeSingle(),
      admin
        .from("clinics")
        .select("name, name_ar, phone, address, logo_url")
        .eq("id", op.clinic_id)
        .maybeSingle(),
      admin
        .from("patient_operations")
        .select(OP_SELECT_FULL)
        .eq("patient_id", op.patient_id)
        .order("created_at", { ascending: true }),
    ]);

  const allPatientOps = (allOpsRes.data ?? []) as PatientOperation[];

  const overrideCaseId = options?.treatmentCaseId?.trim() || null;
  let caseId: string | null = null;
  let caseHint: Pick<PatientTreatmentCase, "id" | "treatment_name_ar"> | null =
    null;

  if (overrideCaseId && isPersistedTreatmentCaseId(overrideCaseId)) {
    caseId = overrideCaseId;
  } else if (
    op.treatment_case_id?.trim() &&
    isPersistedTreatmentCaseId(op.treatment_case_id)
  ) {
    caseId = op.treatment_case_id.trim();
  } else {
    const resolved = await resolveCaseIdForOp(admin, op);
    caseId = resolved.caseId;
    caseHint = resolved.caseHint;
  }

  if (caseId && !caseHint) {
    const { data: row } = await admin
      .from("patient_treatment_cases")
      .select("id, treatment_name_ar")
      .eq("id", caseId)
      .maybeSingle();
    if (row) {
      caseHint = {
        id: String(row.id),
        treatment_name_ar: String(row.treatment_name_ar ?? "علاج"),
      };
    }
  }

  const sessionMeta = await resolveWhatsAppSessionMeta(admin, {
    operationId,
    patientId: op.patient_id,
    treatmentCaseId: caseId ?? overrideCaseId,
  });
  if (!caseId && sessionMeta.caseId) {
    caseId = sessionMeta.caseId;
  }
  const sessionNumber = sessionMeta.sessionNumber;
  const totalSessionsInCase = sessionMeta.totalSessionsInCase;

  const balance = {
    finalPrice: sessionMeta.caseFinalPrice,
    totalPaid: sessionMeta.caseTotalPaid,
    remainingBalance: sessionMeta.remainingBalance,
  };

  const procedureLabel = sessionMeta.procedureLabel || opName(op);

  const { data: teeth } = await admin
    .from("operation_tooth_records")
    .select("tooth_number, procedure_ar")
    .eq("operation_id", operationId);

  const rawPhone = patient ? getPatientDisplayPhone(patient as Patient) : null;
  const patientPhone = rawPhone
    ? normalizePhoneForWhatsApp(rawPhone) || null
    : null;

  return {
    operationId: op.id,
    clinicId: op.clinic_id,
    patientId: op.patient_id,
    doctorId: op.doctor_id,
    treatmentCaseId: caseId,
    sessionNumber,
    totalSessionsInCase,
    patientName: patient?.full_name_ar ?? "مراجع",
    patientPhone,
    doctorName: doctor?.full_name_ar ?? "طبيب",
    doctorPhone: doctor?.phone?.trim() || null,
    doctorProfileId: doctor?.profile_id ?? null,
    procedureLabel,
    paidAmount: Number(op.paid_amount ?? 0),
    caseFinalPrice: balance.finalPrice,
    caseTotalPaid: balance.totalPaid,
    remainingBalance: balance.remainingBalance,
    treatmentStatus: patient?.treatment_status ?? null,
    sessionKind: op.session_kind ?? null,
    teethSummary: formatTeethSummary(
      (teeth ?? []) as { tooth_number: number; procedure_ar: string }[]
    ),
    operationsForCount: allPatientOps.map((o) => ({
      id: o.id,
      treatment_case_id: o.treatment_case_id,
    })),
    clinic: clinic ?? {
      name: "العيادة",
      name_ar: null,
      phone: null,
      address: null,
      logo_url: null,
    },
  };
}

/** هل اكتملت هذه الحالة فعلاً (ذمة = 0)؟ */
export function isCaseFullyCompletedForMessage(
  ctx: Pick<
    SessionAutomationContext,
    "caseFinalPrice" | "caseTotalPaid" | "remainingBalance"
  >
): boolean {
  if (ctx.caseFinalPrice <= FINANCIAL_EPSILON) return false;
  if (ctx.caseTotalPaid <= FINANCIAL_EPSILON) return false;
  return ctx.remainingBalance <= FINANCIAL_EPSILON;
}
