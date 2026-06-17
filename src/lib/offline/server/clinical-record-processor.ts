import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import { isToothStatus } from "@/lib/clinical/tooth-status";
import type { ClinicalRecordOfflinePayload } from "@/lib/offline/types";

const BUCKET = "clinical-xrays";
const MAX_BYTES = 10 * 1024 * 1024;

export interface ClinicalXrayUploadInput {
  fileName: string;
  mimeType: string;
  buffer: Buffer;
}

export async function uploadClinicalXrayAdmin(
  admin: SupabaseClient,
  input: {
    clinicId: string;
    operationId: string;
    profileId: string;
    file: ClinicalXrayUploadInput;
  }
): Promise<{ ok: boolean; error?: string }> {
  if (input.file.buffer.byteLength > MAX_BYTES) {
    return { ok: false, error: "حجم الملف أكبر من 10 ميجابايت" };
  }

  const { data: op } = await admin
    .from("patient_operations")
    .select("id, clinic_id")
    .eq("id", input.operationId)
    .maybeSingle();

  if (!op || op.clinic_id !== input.clinicId) {
    return { ok: false, error: "الجلسة غير موجودة" };
  }

  const ext = input.file.fileName.split(".").pop()?.toLowerCase() || "jpg";
  const safeName = `${crypto.randomUUID()}.${ext}`;
  const storagePath = `${input.clinicId}/${input.operationId}/${safeName}`;

  const { error: uploadErr } = await admin.storage
    .from(BUCKET)
    .upload(storagePath, input.file.buffer, {
      contentType: input.file.mimeType || "image/jpeg",
      upsert: false,
    });

  if (uploadErr) {
    return {
      ok: false,
      error: uploadErr.message.includes("Bucket not found")
        ? "أنشئ bucket باسم clinical-xrays في Supabase Storage"
        : uploadErr.message,
    };
  }

  const { error: rowErr } = await admin.from("operation_xray_images").insert({
    clinic_id: input.clinicId,
    operation_id: input.operationId,
    storage_path: storagePath,
    file_name: input.file.fileName,
    mime_type: input.file.mimeType || null,
    uploaded_by: input.profileId,
  });

  if (rowErr) {
    await admin.storage.from(BUCKET).remove([storagePath]);
    return { ok: false, error: rowErr.message || "تعذر تسجيل الصورة" };
  }

  return { ok: true };
}

export async function processClinicalRecordOfflinePayload(
  admin: SupabaseClient,
  clinicId: string,
  profileId: string,
  payload: ClinicalRecordOfflinePayload,
  xrayFiles: ClinicalXrayUploadInput[] = []
): Promise<{ ok: boolean; error?: string }> {
  if (payload.clinicId !== clinicId) {
    return { ok: false, error: "معرّف العيادة لا يطابق حسابك" };
  }

  const { data: op } = await admin
    .from("patient_operations")
    .select("id, clinic_id")
    .eq("id", payload.operationId)
    .maybeSingle();

  if (!op || op.clinic_id !== clinicId) {
    return { ok: false, error: "الجلسة غير موجودة" };
  }

  if (payload.teeth.length > 0) {
    const rows = payload.teeth.map((t) => ({
      clinic_id: clinicId,
      operation_id: payload.operationId,
      tooth_number: t.tooth_number,
      procedure_ar: t.procedure_ar.trim(),
      status:
        typeof t.status === "string" && isToothStatus(t.status.trim())
          ? t.status.trim()
          : "healthy",
      note: t.note?.trim() || null,
    }));

    const { error } = await admin.from("operation_tooth_records").upsert(rows, {
      onConflict: "operation_id,tooth_number",
    });

    if (error) {
      const missing =
        error.message.includes("operation_tooth_records") ||
        error.message.includes("schema cache");
      return {
        ok: false,
        error: missing
          ? "جدول السجل الطبي غير مُنشأ — شغّل fix-clinical-session-records.sql"
          : error.message,
      };
    }
  }

  for (const file of xrayFiles) {
    const uploaded = await uploadClinicalXrayAdmin(admin, {
      clinicId,
      operationId: payload.operationId,
      profileId,
      file,
    });
    if (!uploaded.ok) {
      return { ok: false, error: uploaded.error };
    }
  }

  return { ok: true };
}
