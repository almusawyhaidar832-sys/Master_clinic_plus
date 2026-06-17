import { validatePatientPhone } from "@/lib/phone";
import type { AddPatientOfflinePayload } from "@/lib/offline/types";

export interface AddPatientOfflineInput {
  clinicId: string | null;
  name: string;
  phone: string;
  notes: string;
}

export function validateAddPatientOffline(
  input: AddPatientOfflineInput
): { ok: true; payload: Omit<AddPatientOfflinePayload, "clientId" | "enqueuedAt"> } | { ok: false; message: string } {
  if (!input.clinicId) {
    return {
      ok: false,
      message:
        "لا يمكن الحفظ بدون نت — افتح النظام مرة واحدة مع اتصال لتحميل بيانات العيادة",
    };
  }

  const name = input.name.trim();
  if (!name) {
    return { ok: false, message: "أدخل اسم المراجع" };
  }

  const phoneCheck = validatePatientPhone(input.phone);
  if (!phoneCheck.ok) {
    return { ok: false, message: phoneCheck.message };
  }

  return {
    ok: true,
    payload: {
      version: 1,
      clinicId: input.clinicId,
      name,
      phone: phoneCheck.normalized,
      notes: input.notes.trim(),
    },
  };
}
