"use client";

import { AppointmentTable } from "@/components/appointments/AppointmentTable";
import { useActiveClinicId } from "@/hooks/useActiveClinicId";

/** لوحة المحاسب — كل مواعيد العيادة */
export function AccountantAppointmentsPanel() {
  const { clinicId, loading } = useActiveClinicId();

  if (loading) return null;
  if (!clinicId) return null;

  return (
    <AppointmentTable
      role="accountant"
      clinicId={clinicId}
      compact
    />
  );
}
