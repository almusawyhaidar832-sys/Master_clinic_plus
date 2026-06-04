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

export async function loadSessionAutomationContext(
  operationId: string
): Promise<SessionAutomationContext | null> {
  const admin = getAdminClient();

  const { data: op, error } = await admin
    .from("patient_operations")
    .select(
      "id, clinic_id, patient_id, doctor_id, paid_amount, remaining_debt, total_amount, session_kind, created_at, operation_name_ar, operation_type"
    )
    .eq("id", operationId)
    .maybeSingle();

  if (error || !op) return null;

  const [{ data: patient }, { data: doctor }, { data: clinic }, { data: allOps }] =
    await Promise.all([
      admin
        .from("patients")
        .select(
          "full_name_ar, phone, phone_number, treatment_status, agreed_total, total_paid"
        )
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
  const remainingBalance =
    remainingFromPatient ??
    Math.max(
      0,
      Number(op.remaining_debt ?? 0) ||
        Number(op.total_amount ?? 0) - Number(op.paid_amount ?? 0)
    );

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
