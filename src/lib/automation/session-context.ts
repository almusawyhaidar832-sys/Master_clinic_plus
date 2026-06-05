import type { SupabaseClient } from "@supabase/supabase-js";
import { getAdminClient } from "@/lib/supabase/admin";
import { opName } from "@/types";
import { getPatientDisplayPhone } from "@/lib/phone";
import type { Patient } from "@/types";

export type SessionAutomationContext = {
  operationId: string;
  clinicId: string;
  patientId: string;
  doctorId: string;
  sessionNumber: number;
  patientName: string;
  patientPhone: string | null;
  doctorName: string;
  doctorPhone: string | null;
  doctorProfileId: string | null;
  procedureLabel: string;
  paidAmount: number;
  remainingBalance: number;
  treatmentStatus: string | null;
  sessionKind: string | null;
  teethSummary: string;
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
  treatment_case_id?: string | null;
};

async function fetchOperationForAutomation(
  client: SupabaseClient,
  operationId: string
): Promise<OpRow | null> {
  // لا يوجد عمود operation_type في DB — الاسم في operation_name_ar فقط
  const selects = [
    "id, clinic_id, patient_id, doctor_id, paid_amount, remaining_debt, total_amount, session_kind, created_at, operation_name_ar, treatment_case_id",
    "id, clinic_id, patient_id, doctor_id, paid_amount, remaining_debt, total_amount, created_at, operation_name_ar",
    "id, clinic_id, patient_id, doctor_id, paid_amount, total_amount, created_at, operation_name_ar",
    "id, clinic_id, patient_id, doctor_id, paid_amount, total_amount, created_at",
  ];

  for (const sel of selects) {
    const { data, error } = await client
      .from("patient_operations")
      .select(sel)
      .eq("id", operationId)
      .maybeSingle();
    if (!error && data) return data as OpRow;
  }

  const wildcard = await client
    .from("patient_operations")
    .select("*")
    .eq("id", operationId)
    .maybeSingle();

  if (!wildcard.error && wildcard.data) {
    return wildcard.data as OpRow;
  }

  console.error(
    "[session-context] fetch op failed",
    operationId,
    wildcard.error?.message
  );
  return null;
}

export async function loadSessionAutomationContext(
  operationId: string,
  userClient?: SupabaseClient
): Promise<SessionAutomationContext | null> {
  const admin = getAdminClient();
  let op = await fetchOperationForAutomation(admin, operationId);
  if (!op && userClient) {
    op = await fetchOperationForAutomation(userClient, operationId);
  }
  if (!op) return null;

  let patientRes = await admin
    .from("patients")
    .select(
      "full_name_ar, phone, phone_number, treatment_status, agreed_total, total_paid"
    )
    .eq("id", op.patient_id)
    .maybeSingle();

  if (patientRes.error) {
    patientRes = await admin
      .from("patients")
      .select(
        "full_name_ar, phone, treatment_status, agreed_total, total_paid"
      )
      .eq("id", op.patient_id)
      .maybeSingle();
  }

  const [{ data: patient }, { data: doctor }, { data: clinic }, { data: allOps }] =
    await Promise.all([
      Promise.resolve(patientRes),
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
        .select("id, created_at")
        .eq("patient_id", op.patient_id)
        .order("created_at", { ascending: true }),
    ]);

  const sessionNumber =
    (allOps ?? []).findIndex((row) => row.id === op.id) + 1 || 1;

  const { data: teeth } = await admin
    .from("operation_tooth_records")
    .select("tooth_number, procedure_ar")
    .eq("operation_id", operationId);

  const agreed = Number(patient?.agreed_total ?? 0);
  const totalPaid = Number(patient?.total_paid ?? 0);
  const remainingFromPatient =
    agreed > 0 ? Math.max(0, agreed - totalPaid) : undefined;
  const remainingFromOp = Math.max(
    0,
    Number(op.remaining_debt ?? 0) ||
      Number(op.total_amount ?? 0) - Number(op.paid_amount ?? 0)
  );

  let remainingBalance =
    remainingFromPatient ?? remainingFromOp;

  const caseId = op.treatment_case_id;
  if (caseId) {
    const caseRes = await admin
      .from("patient_treatment_cases")
      .select("final_price, total_paid, case_price, discount_total")
      .eq("id", caseId)
      .maybeSingle();
    const caseRow = caseRes.error ? null : caseRes.data;
    if (caseRow) {
      const finalPrice =
        Number(caseRow.final_price ?? 0) ||
        Math.max(
          0,
          Number(caseRow.case_price ?? 0) - Number(caseRow.discount_total ?? 0)
        );
      remainingBalance = Math.max(
        0,
        finalPrice - Number(caseRow.total_paid ?? 0)
      );
    }
  }

  return {
    operationId: op.id,
    clinicId: op.clinic_id,
    patientId: op.patient_id,
    doctorId: op.doctor_id,
    sessionNumber,
    patientName: patient?.full_name_ar ?? "مراجع",
    patientPhone: patient
      ? getPatientDisplayPhone(patient as Patient)
      : null,
    doctorName: doctor?.full_name_ar ?? "طبيب",
    doctorPhone: doctor?.phone?.trim() || null,
    doctorProfileId: doctor?.profile_id ?? null,
    procedureLabel: opName(op),
    paidAmount: Number(op.paid_amount ?? 0),
    remainingBalance,
    treatmentStatus: patient?.treatment_status ?? null,
    sessionKind: op.session_kind ?? null,
    teethSummary: formatTeethSummary(
      (teeth ?? []) as { tooth_number: number; procedure_ar: string }[]
    ),
    clinic: clinic ?? {
      name: "العيادة",
      name_ar: null,
      phone: null,
      address: null,
      logo_url: null,
    },
  };
}
