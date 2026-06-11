import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import {
  enqueueAppointmentToQueue,
  notifyDoctorForApprovedAppointment,
} from "@/lib/services/appointment-queue-sync";
import {
  sendQueueEntryToDoctor,
  updateQueueStatus,
} from "@/lib/queue/server";

const BLOCKED = new Set([
  "cancelled",
  "completed",
  "ready_for_billing",
  "ready_for_payment",
]);

/**
 * دخول المراجع — إدراج/تفعيل غرفة الانتظار + إشعار الطبيب.
 * لا يفتح دفع ولا يبدأ الكشف مباشرة.
 */
export async function checkInAppointmentToQueue(
  admin: SupabaseClient,
  clinicId: string,
  appointmentId: string
): Promise<{ queueEntryId: string; status: "waiting" }> {
  const { data: appt, error } = await admin
    .from("appointments")
    .select(
      "id, clinic_id, doctor_id, patient_id, patient_name_ar, patient_phone, status"
    )
    .eq("id", appointmentId)
    .eq("clinic_id", clinicId)
    .maybeSingle();

  if (error || !appt) {
    throw new Error("الموعد غير موجود");
  }

  const status = String(appt.status ?? "");
  if (BLOCKED.has(status)) {
    throw new Error("لا يمكن تسجيل دخول لموعد ملغى أو مكتمل أو جاهز للدفع");
  }

  const queueEntryId = await enqueueAppointmentToQueue(admin, {
    id: appt.id as string,
    clinic_id: appt.clinic_id as string,
    doctor_id: appt.doctor_id as string,
    patient_name_ar: appt.patient_name_ar as string | null,
    patient_phone: appt.patient_phone as string | null,
    patient_id: appt.patient_id as string | null,
    source: status === "pending" ? "online" : "appointment",
  });

  await updateQueueStatus(queueEntryId, "waiting", { clinicId });
  await sendQueueEntryToDoctor(queueEntryId, true);

  const { error: apptErr } = await admin
    .from("appointments")
    .update({ status: "waiting" })
    .eq("id", appointmentId)
    .eq("clinic_id", clinicId);

  if (apptErr) {
    if (
      apptErr.message.includes("waiting") ||
      apptErr.message.includes("invalid input value")
    ) {
      throw new Error(
        "حالة waiting غير موجودة — شغّل supabase/scripts/12-appointment-queue-cycle.sql"
      );
    }
    throw new Error(apptErr.message);
  }

  await notifyDoctorForApprovedAppointment(queueEntryId);

  return { queueEntryId, status: "waiting" };
}
