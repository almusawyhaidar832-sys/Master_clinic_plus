import type { SupabaseClient } from "@supabase/supabase-js";
import {
  fetchCasePrimaryDoctor,
  type PatientPrimaryDoctor,
} from "@/lib/services/patient-primary-doctor";
import { treatmentCaseDisplayLabel } from "@/lib/services/patient-treatment-cases";
import type { PatientTreatmentCase } from "@/lib/services/patient-treatment-cases";

export interface DoctorTransferRecord {
  id: string;
  treatment_case_id: string | null;
  from_doctor_id: string | null;
  to_doctor_id: string;
  created_at: string;
  fromDoctorName?: string;
  toDoctorName?: string;
  caseName?: string;
}

export interface CaseWithDoctor {
  caseId: string;
  caseLabel: string;
  doctor: PatientPrimaryDoctor | null;
  remaining: number;
}

export async function fetchCasesWithDoctors(
  supabase: SupabaseClient,
  patientId: string,
  cases: PatientTreatmentCase[]
): Promise<CaseWithDoctor[]> {
  const persisted = cases.filter((c) => c.id && !c.id.startsWith("inferred-"));
  const rows = await Promise.all(
    persisted.map(async (c) => {
      const doctor =
        c.primary_doctor_id && c.primary_doctor_name
          ? { id: c.primary_doctor_id, full_name_ar: c.primary_doctor_name }
          : await fetchCasePrimaryDoctor(supabase, c.id);
      return {
        caseId: c.id,
        caseLabel: treatmentCaseDisplayLabel(c, cases),
        doctor,
        remaining: Math.max(0, (c.final_price || 0) - (c.total_paid || 0)),
      };
    })
  );
  return rows;
}

export async function transferTreatmentCaseDoctor(
  supabase: SupabaseClient,
  input: {
    clinicId: string;
    patientId: string;
    treatmentCaseId: string;
    newDoctorId: string;
    transferredBy: string;
    notes?: string;
  }
): Promise<{ primaryDoctor: PatientPrimaryDoctor; error?: string }> {
  const { patientId, treatmentCaseId, newDoctorId, clinicId, transferredBy } =
    input;

  if (!treatmentCaseId || !newDoctorId) {
    return {
      primaryDoctor: null as unknown as PatientPrimaryDoctor,
      error: "اختر الحالة والطبيب الجديد",
    };
  }

  const { data: caseRow, error: caseErr } = await supabase
    .from("patient_treatment_cases")
    .select("id, patient_id, clinic_id, treatment_name_ar, primary_doctor_id")
    .eq("id", treatmentCaseId)
    .maybeSingle();

  if (caseErr || !caseRow) {
    return {
      primaryDoctor: null as unknown as PatientPrimaryDoctor,
      error: "حالة العلاج غير موجودة",
    };
  }
  if (caseRow.patient_id !== patientId) {
    return {
      primaryDoctor: null as unknown as PatientPrimaryDoctor,
      error: "هذه الحالة لا تخص هذا المريض",
    };
  }
  if (String(caseRow.clinic_id) !== String(clinicId)) {
    return {
      primaryDoctor: null as unknown as PatientPrimaryDoctor,
      error: "غير مصرح — الحالة من عيادة أخرى",
    };
  }

  const { data: newDoctor, error: doctorErr } = await supabase
    .from("doctors")
    .select("id, clinic_id, full_name_ar, is_active")
    .eq("id", newDoctorId)
    .maybeSingle();

  if (doctorErr || !newDoctor) {
    return {
      primaryDoctor: null as unknown as PatientPrimaryDoctor,
      error: "الطبيب غير موجود",
    };
  }
  if (newDoctor.clinic_id !== clinicId || !newDoctor.is_active) {
    return {
      primaryDoctor: null as unknown as PatientPrimaryDoctor,
      error: "الطبيب غير متاح في هذه العيادة",
    };
  }

  const fromDoctorId = caseRow.primary_doctor_id as string | null;
  if (!fromDoctorId) {
    const current = await fetchCasePrimaryDoctor(supabase, treatmentCaseId);
    if (current?.id === newDoctorId) {
      return {
        primaryDoctor: current,
        error: "هذه الحالة مسجّلة لهذا الطبيب بالفعل",
      };
    }
  } else if (fromDoctorId === newDoctorId) {
    return {
      primaryDoctor: {
        id: newDoctorId,
        full_name_ar: String(newDoctor.full_name_ar ?? "الطبيب"),
      },
      error: "هذه الحالة مسجّلة لهذا الطبيب بالفعل",
    };
  }

  const resolvedFrom =
    fromDoctorId ??
    (await fetchCasePrimaryDoctor(supabase, treatmentCaseId))?.id ??
    null;

  const { error: updateErr } = await supabase
    .from("patient_treatment_cases")
    .update({ primary_doctor_id: newDoctorId, updated_at: new Date().toISOString() })
    .eq("id", treatmentCaseId);

  if (updateErr) {
    return {
      primaryDoctor: null as unknown as PatientPrimaryDoctor,
      error: updateErr.message,
    };
  }

  const transferRow = {
    clinic_id: clinicId,
    patient_id: patientId,
    treatment_case_id: treatmentCaseId,
    from_doctor_id: resolvedFrom,
    to_doctor_id: newDoctorId,
    transferred_by: transferredBy,
    notes:
      input.notes?.trim() ||
      `تحويل حالة: ${String(caseRow.treatment_name_ar ?? "علاج")}`,
  };

  let { error: insertErr } = await supabase
    .from("patient_doctor_transfers")
    .insert(transferRow);

  if (
    insertErr &&
    (insertErr.message.includes("treatment_case_id") ||
      insertErr.message.includes("patient_doctor_transfers") ||
      insertErr.message.includes("schema cache"))
  ) {
    const { treatment_case_id: _tc, ...legacyRow } = transferRow;
    void _tc;
    const retry = await supabase
      .from("patient_doctor_transfers")
      .insert(legacyRow);
    insertErr = retry.error;
  }

  if (insertErr) {
    return {
      primaryDoctor: {
        id: newDoctorId,
        full_name_ar: String(newDoctor.full_name_ar ?? "الطبيب"),
      },
      error: `تم التحويل لكن لم يُسجَّل في السجل: ${insertErr.message}`,
    };
  }

  return {
    primaryDoctor: {
      id: newDoctorId,
      full_name_ar: String(newDoctor.full_name_ar ?? "الطبيب"),
    },
  };
}

export async function fetchPatientTransferHistory(
  supabase: SupabaseClient,
  patientId: string,
  limit = 10
): Promise<DoctorTransferRecord[]> {
  const { data, error } = await supabase
    .from("patient_doctor_transfers")
    .select(
      "id, treatment_case_id, from_doctor_id, to_doctor_id, created_at, from_doctor:doctors!from_doctor_id(full_name_ar), to_doctor:doctors!to_doctor_id(full_name_ar), treatment_case:patient_treatment_cases!treatment_case_id(treatment_name_ar, case_price)"
    )
    .eq("patient_id", patientId)
    .order("created_at", { ascending: false })
    .limit(limit);

  if (error) {
    if (
      error.message.includes("patient_doctor_transfers") ||
      error.message.includes("schema cache")
    ) {
      return [];
    }
    console.warn("[fetchPatientTransferHistory]", error.message);
    return [];
  }

  return (data ?? []).map((row) => {
    const fromDoc = row.from_doctor as
      | { full_name_ar: string }
      | { full_name_ar: string }[]
      | null;
    const toDoc = row.to_doctor as
      | { full_name_ar: string }
      | { full_name_ar: string }[]
      | null;
    const caseRel = row.treatment_case as
      | { treatment_name_ar: string; case_price?: number }
      | { treatment_name_ar: string; case_price?: number }[]
      | null;
    const caseRow = Array.isArray(caseRel) ? caseRel[0] : caseRel;

    return {
      id: row.id as string,
      treatment_case_id: row.treatment_case_id as string | null,
      from_doctor_id: row.from_doctor_id as string | null,
      to_doctor_id: row.to_doctor_id as string,
      created_at: String(row.created_at ?? ""),
      fromDoctorName: (Array.isArray(fromDoc) ? fromDoc[0] : fromDoc)?.full_name_ar?.trim(),
      toDoctorName: (Array.isArray(toDoc) ? toDoc[0] : toDoc)?.full_name_ar?.trim(),
      caseName: caseRow?.treatment_name_ar?.trim(),
    };
  });
}
