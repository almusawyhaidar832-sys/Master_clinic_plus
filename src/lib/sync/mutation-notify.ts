"use client";

import { notifyClinicSync } from "@/lib/sync/clinic-events";

/** بعد إنشاء/تعديل جلسة */
export function notifySessionMutation(input: {
  clinicId: string;
  doctorId?: string;
  patientId?: string;
}): void {
  notifyClinicSync({
    topic: "sessions",
    clinicId: input.clinicId,
    doctorId: input.doctorId,
    patientId: input.patientId,
    source: "mutation",
  });
}

/** بعد تسجيل مرتجع */
export function notifyRefundMutation(input: {
  clinicId: string;
  doctorId?: string;
  patientId?: string;
}): void {
  notifyClinicSync({
    topic: ["refunds", "sessions"],
    clinicId: input.clinicId,
    doctorId: input.doctorId,
    patientId: input.patientId,
    source: "mutation",
  });
}

/** بعد تغيير موعد */
export function notifyAppointmentMutation(input: {
  clinicId: string;
  doctorId?: string;
}): void {
  notifyClinicSync({
    topic: ["appointments", "queue"],
    clinicId: input.clinicId,
    doctorId: input.doctorId,
    source: "mutation",
  });
}
