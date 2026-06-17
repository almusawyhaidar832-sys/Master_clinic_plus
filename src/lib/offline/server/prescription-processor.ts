import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import { upsertPrescription } from "@/lib/prescriptions/server";
import type { PrescriptionOfflinePayload } from "@/lib/offline/types";

export async function processPrescriptionOfflinePayload(
  admin: SupabaseClient,
  clinicId: string,
  profileId: string,
  payload: PrescriptionOfflinePayload
): Promise<{ ok: boolean; prescriptionId?: string; error?: string }> {
  if (payload.clinicId !== clinicId) {
    return { ok: false, error: "معرّف العيادة لا يطابق حسابك" };
  }

  const { data: operation } = await admin
    .from("patient_operations")
    .select("id, patient_id, clinic_id, doctor_id")
    .eq("id", payload.operationId)
    .eq("clinic_id", clinicId)
    .maybeSingle();

  if (!operation) {
    return { ok: false, error: "الجلسة غير موجودة" };
  }

  try {
    const saved = await upsertPrescription(admin, {
      clinicId,
      patientId: payload.patientId || (operation.patient_id as string),
      doctorId: payload.doctorId || (operation.doctor_id as string),
      operationId: payload.operationId,
      queueEntryId: payload.queueEntryId,
      diagnosisAr: payload.diagnosisAr,
      notesAr: payload.notesAr,
      medications: payload.medications,
      createdBy: profileId,
    });
    return { ok: true, prescriptionId: saved.id };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : "تعذر حفظ الوصفة",
    };
  }
}
