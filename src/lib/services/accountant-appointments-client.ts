import { authPortalHeaders } from "@/lib/auth/api-portal";
import type { Appointment } from "@/types";

async function parseJson<T>(res: Response): Promise<T & { error?: string }> {
  return res.json().catch(() => ({})) as Promise<T & { error?: string }>;
}

export async function updateAccountantAppointmentViaApi(
  id: string,
  input: {
    patient_name_ar: string;
    patient_phone: string;
    appointment_date: string;
    start_time: string;
    end_time: string;
    notes?: string;
    reason_for_change: string;
  }
): Promise<{ ok: boolean; appointment?: Appointment; error?: string }> {
  const res = await fetch(`/api/accountant/appointments/${id}`, {
    method: "PATCH",
    credentials: "include",
    headers: {
      "Content-Type": "application/json",
      ...authPortalHeaders("accountant"),
    },
    body: JSON.stringify(input),
  });
  const json = await parseJson<{ appointment?: Appointment }>(res);
  if (!res.ok) return { ok: false, error: json.error ?? "تعذر تعديل الموعد" };
  return { ok: true, appointment: json.appointment };
}

export async function setAccountantAppointmentStatusViaApi(
  id: string,
  action: "accept" | "reject",
  reason_for_change?: string
): Promise<{ ok: boolean; appointment?: Appointment; error?: string }> {
  const res = await fetch(`/api/accountant/appointments/${id}/status`, {
    method: "POST",
    credentials: "include",
    headers: {
      "Content-Type": "application/json",
      ...authPortalHeaders("accountant"),
    },
    body: JSON.stringify({ action, reason_for_change }),
  });
  const json = await parseJson<{ appointment?: Appointment }>(res);
  if (!res.ok) return { ok: false, error: json.error ?? "تعذر تحديث الحالة" };
  return { ok: true, appointment: json.appointment };
}
