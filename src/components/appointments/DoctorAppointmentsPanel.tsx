"use client";

import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { getDoctorForCurrentUser } from "@/lib/clinic-context";
import { AppointmentTable } from "@/components/appointments/AppointmentTable";
import type { Doctor } from "@/types";

/** لوحة الطبيب — مواعيده فقط */
export function DoctorAppointmentsPanel({ compact }: { compact?: boolean }) {
  const [doctor, setDoctor] = useState<Doctor | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const supabase = createClient();
    getDoctorForCurrentUser(supabase).then((doc) => {
      setDoctor(doc);
      setLoading(false);
    });
  }, []);

  if (loading) return null;

  if (!doctor) {
    return (
      <p className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
        لم يُربط حسابك بسجل طبيب
      </p>
    );
  }

  return (
    <AppointmentTable
      role="doctor"
      clinicId={doctor.clinic_id}
      doctorId={doctor.id}
      compact={compact}
    />
  );
}
