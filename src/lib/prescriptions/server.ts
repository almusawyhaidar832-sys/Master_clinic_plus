import type { SupabaseClient } from "@supabase/supabase-js";
import type {
  PatientPrescription,
  PrescriptionMedication,
  PrescriptionPrintData,
} from "@/lib/prescriptions/types";

export function normalizeMedications(raw: unknown): PrescriptionMedication[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .map((row) => {
      const r = row as Record<string, unknown>;
      const name = String(r.drug_name_ar ?? "").trim();
      if (!name) return null;
      return {
        drug_name_ar: name,
        dosage: r.dosage ? String(r.dosage) : undefined,
        frequency: r.frequency ? String(r.frequency) : undefined,
        duration: r.duration ? String(r.duration) : undefined,
        instructions: r.instructions ? String(r.instructions) : undefined,
      } satisfies PrescriptionMedication;
    })
    .filter(Boolean) as PrescriptionMedication[];
}

export function mapPrescriptionRow(row: Record<string, unknown>): PatientPrescription {
  return {
    id: String(row.id),
    clinic_id: String(row.clinic_id),
    patient_id: String(row.patient_id),
    doctor_id: String(row.doctor_id),
    operation_id: row.operation_id ? String(row.operation_id) : null,
    queue_entry_id: row.queue_entry_id ? String(row.queue_entry_id) : null,
    prescription_date: String(row.prescription_date ?? ""),
    diagnosis_ar: (row.diagnosis_ar as string | null) ?? null,
    notes_ar: (row.notes_ar as string | null) ?? null,
    medications: normalizeMedications(row.medications),
    status: (row.status as PatientPrescription["status"]) ?? "finalized",
    created_by: row.created_by ? String(row.created_by) : null,
    printed_at: (row.printed_at as string | null) ?? null,
    printed_by: row.printed_by ? String(row.printed_by) : null,
    created_at: String(row.created_at ?? ""),
    updated_at: String(row.updated_at ?? ""),
  };
}

export async function fetchPrescriptionByOperation(
  admin: SupabaseClient,
  clinicId: string,
  operationId: string
): Promise<PatientPrescription | null> {
  const { data, error } = await admin
    .from("patient_prescriptions")
    .select("*")
    .eq("clinic_id", clinicId)
    .eq("operation_id", operationId)
    .maybeSingle();

  if (error) {
    if (
      error.message.includes("patient_prescriptions") ||
      error.message.includes("schema cache")
    ) {
      return null;
    }
    throw new Error(error.message);
  }

  return data ? mapPrescriptionRow(data as Record<string, unknown>) : null;
}

export async function fetchPrescriptionByQueueEntry(
  admin: SupabaseClient,
  clinicId: string,
  queueEntryId: string
): Promise<PatientPrescription | null> {
  const { data, error } = await admin
    .from("patient_prescriptions")
    .select("*")
    .eq("clinic_id", clinicId)
    .eq("queue_entry_id", queueEntryId)
    .order("updated_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) {
    if (
      error.message.includes("patient_prescriptions") ||
      error.message.includes("schema cache")
    ) {
      return null;
    }
    throw new Error(error.message);
  }

  return data ? mapPrescriptionRow(data as Record<string, unknown>) : null;
}

export async function fetchPrescriptionForSession(
  admin: SupabaseClient,
  clinicId: string,
  input: { operationId?: string | null; queueEntryId?: string | null }
): Promise<PatientPrescription | null> {
  const operationId = String(input.operationId ?? "").trim();
  if (operationId) {
    const byOperation = await fetchPrescriptionByOperation(
      admin,
      clinicId,
      operationId
    );
    if (byOperation) return byOperation;
  }

  const queueEntryId = String(input.queueEntryId ?? "").trim();
  if (queueEntryId) {
    return fetchPrescriptionByQueueEntry(admin, clinicId, queueEntryId);
  }

  return null;
}

export async function fetchPrescriptionPrintData(
  admin: SupabaseClient,
  clinicId: string,
  prescriptionId: string
): Promise<PrescriptionPrintData | null> {
  const { data, error } = await admin
    .from("patient_prescriptions")
    .select(
      `*,
       patient:patients ( full_name_ar, phone ),
       doctor:doctors ( full_name_ar ),
       clinic:clinics ( id, name, name_ar, phone, address, logo_url, whatsapp_linked )`
    )
    .eq("id", prescriptionId)
    .eq("clinic_id", clinicId)
    .maybeSingle();

  if (error || !data) return null;

  const patient = data.patient as { full_name_ar?: string; phone?: string } | null;
  const doctor = data.doctor as { full_name_ar?: string } | null;
  const clinicRow = data.clinic as {
    id?: string;
    name?: string;
    name_ar?: string | null;
    phone?: string | null;
    address?: string | null;
    logo_url?: string | null;
    whatsapp_linked?: boolean;
  } | null;

  const clinic = clinicRow
    ? {
        id: String(clinicRow.id ?? clinicId),
        name: String(clinicRow.name ?? ""),
        name_ar: clinicRow.name_ar ?? null,
        phone: clinicRow.phone ?? null,
        address: clinicRow.address ?? null,
        logo_url: clinicRow.logo_url ?? null,
        whatsapp_linked: Boolean(clinicRow.whatsapp_linked),
      }
    : null;

  return {
    prescription: mapPrescriptionRow(data as Record<string, unknown>),
    patientName: String(patient?.full_name_ar ?? "مراجع"),
    patientPhone: patient?.phone ?? null,
    doctorName: String(doctor?.full_name_ar ?? "طبيب"),
    clinic,
  };
}

export async function upsertPrescription(
  admin: SupabaseClient,
  input: {
    clinicId: string;
    patientId: string;
    doctorId: string;
    operationId: string;
    queueEntryId?: string | null;
    diagnosisAr?: string | null;
    notesAr?: string | null;
    medications: PrescriptionMedication[];
    createdBy: string;
  }
): Promise<PatientPrescription> {
  const meds = input.medications.filter((m) => m.drug_name_ar.trim());
  if (meds.length === 0) {
    throw new Error("أضف دواء واحد على الأقل");
  }

  const payload = {
    clinic_id: input.clinicId,
    patient_id: input.patientId,
    doctor_id: input.doctorId,
    operation_id: input.operationId,
    queue_entry_id: input.queueEntryId ?? null,
    diagnosis_ar: input.diagnosisAr?.trim() || null,
    notes_ar: input.notesAr?.trim() || null,
    medications: meds,
    status: "finalized" as const,
    created_by: input.createdBy,
    updated_at: new Date().toISOString(),
  };

  const existing = await fetchPrescriptionForSession(admin, input.clinicId, {
    operationId: input.operationId,
    queueEntryId: input.queueEntryId,
  });

  if (existing) {
    const { data, error } = await admin
      .from("patient_prescriptions")
      .update({
        ...payload,
        operation_id: input.operationId,
        queue_entry_id: input.queueEntryId ?? existing.queue_entry_id,
        printed_at: existing.status === "printed" ? existing.printed_at : null,
        printed_by: existing.status === "printed" ? existing.printed_by : null,
        status: existing.status === "printed" ? "printed" : "finalized",
      })
      .eq("id", existing.id)
      .select("*")
      .single();

    if (error) throw new Error(error.message);
    return mapPrescriptionRow(data as Record<string, unknown>);
  }

  let { data, error } = await admin
    .from("patient_prescriptions")
    .insert(payload)
    .select("*")
    .single();

  if (
    error &&
    (error.message.includes("uq_patient_prescriptions_operation") ||
      (error.message.includes("duplicate key") &&
        error.message.includes("operation_id")))
  ) {
    const again = await fetchPrescriptionByOperation(
      admin,
      input.clinicId,
      input.operationId
    );
    if (again) {
      const retry = await admin
        .from("patient_prescriptions")
        .update({
          ...payload,
          printed_at: again.status === "printed" ? again.printed_at : null,
          printed_by: again.status === "printed" ? again.printed_by : null,
          status: again.status === "printed" ? "printed" : "finalized",
        })
        .eq("id", again.id)
        .select("*")
        .single();
      if (retry.error) throw new Error(retry.error.message);
      return mapPrescriptionRow(retry.data as Record<string, unknown>);
    }
  }

  if (error) throw new Error(error.message);
  return mapPrescriptionRow(data as Record<string, unknown>);
}

export async function markPrescriptionPrinted(
  admin: SupabaseClient,
  clinicId: string,
  prescriptionId: string,
  printedBy: string
): Promise<PatientPrescription> {
  const { data, error } = await admin
    .from("patient_prescriptions")
    .update({
      status: "printed",
      printed_at: new Date().toISOString(),
      printed_by: printedBy,
      updated_at: new Date().toISOString(),
    })
    .eq("id", prescriptionId)
    .eq("clinic_id", clinicId)
    .select("*")
    .single();

  if (error || !data) throw new Error(error?.message ?? "تعذر تحديث الوصفة");
  return mapPrescriptionRow(data as Record<string, unknown>);
}
