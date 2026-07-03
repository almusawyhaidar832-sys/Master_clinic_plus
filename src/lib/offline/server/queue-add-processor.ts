import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import { insertQueueEntry } from "@/lib/queue/server";
import type { QueueAddOfflinePayload } from "@/lib/offline/types";

export interface QueueAddOfflineProcessResult {
  ok: boolean;
  queueEntryId?: string;
  error?: string;
}

export async function processQueueAddOfflinePayload(
  _admin: SupabaseClient,
  clinicId: string,
  payload: QueueAddOfflinePayload
): Promise<QueueAddOfflineProcessResult> {
  if (payload.clinicId !== clinicId) {
    return { ok: false, error: "معرّف العيادة لا يطابق حسابك" };
  }

  if (!payload.doctorId) {
    return { ok: false, error: "اختر الطبيب" };
  }

  const patientName = payload.patientName.trim();
  if (!patientName) {
    return { ok: false, error: "أدخل اسم المراجع" };
  }

  try {
    const queueEntryId = await insertQueueEntry({
      clinic_id: clinicId,
      doctor_id: payload.doctorId,
      patient_name: patientName,
      patient_phone: payload.patientPhone?.trim() || null,
      patient_id: payload.patientId,
      send_to_doctor: payload.sendToDoctor,
      notes: payload.notes,
    });

    return { ok: true, queueEntryId };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : "تعذر إضافة المراجع للطابور",
    };
  }
}
