import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import { patientPhoneColumns, validatePatientPhone } from "@/lib/phone";
import { suggestSpeechName } from "@/lib/queue/arabic-name-pronunciation";
import type { AddPatientOfflinePayload } from "@/lib/offline/types";

export interface AddPatientOfflineProcessResult {
  ok: boolean;
  patientId?: string;
  error?: string;
}

export async function processAddPatientOfflinePayload(
  admin: SupabaseClient,
  clinicId: string,
  payload: AddPatientOfflinePayload
): Promise<AddPatientOfflineProcessResult> {
  if (payload.clinicId !== clinicId) {
    return { ok: false, error: "معرّف العيادة لا يطابق حسابك" };
  }

  const name = payload.name.trim();
  const phoneCheck = validatePatientPhone(payload.phone);
  if (!phoneCheck.ok) {
    return { ok: false, error: phoneCheck.message };
  }

  const { data: existing } = await admin
    .from("patients")
    .select("id")
    .eq("full_name_ar", name)
    .eq("clinic_id", clinicId)
    .maybeSingle();

  if (existing?.id) {
    return { ok: true, patientId: existing.id as string };
  }

  const baseRow = {
    full_name_ar: name,
    speech_name_ar: suggestSpeechName(name),
    clinic_id: clinicId,
    notes: payload.notes?.trim() || null,
    ...patientPhoneColumns(phoneCheck.normalized),
  };

  const { data, error } = await admin
    .from("patients")
    .insert(baseRow)
    .select("id")
    .single();

  if (!error && data?.id) {
    return { ok: true, patientId: data.id as string };
  }

  const msg = error?.message ?? "";
  if (msg.includes("speech_name_ar")) {
    const retry = await admin
      .from("patients")
      .insert({
        full_name_ar: name,
        clinic_id: clinicId,
        notes: payload.notes?.trim() || null,
        ...patientPhoneColumns(phoneCheck.normalized),
      })
      .select("id")
      .single();
    if (retry.error || !retry.data?.id) {
      return { ok: false, error: retry.error?.message ?? "تعذر حفظ المراجع" };
    }
    return { ok: true, patientId: retry.data.id as string };
  }

  return { ok: false, error: msg || "تعذر حفظ المراجع" };
}
