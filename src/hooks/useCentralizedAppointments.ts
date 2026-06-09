"use client";

import { useCallback, useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { useAppointmentsRealtime } from "@/hooks/useAppointmentsRealtime";
import { useClinicSync } from "@/hooks/useClinicSync";
import { todayISO } from "@/lib/utils";
import type { Appointment } from "@/types";

export interface AppointmentWithDoctor extends Appointment {
  doctor?: { full_name_ar: string } | null;
}

export type AppointmentTableRole = "accountant" | "doctor" | "assistant";

interface UseCentralizedAppointmentsOptions {
  clinicId: string | null | undefined;
  /** null = كل الأطباء في العيادة */
  doctorId?: string | null;
  enabled?: boolean;
}

/**
 * مصدر موحّد لجدول appointments — مع فلترة حسب الطبيب وRealtime
 */
export function useCentralizedAppointments({
  clinicId,
  doctorId = null,
  enabled = true,
}: UseCentralizedAppointmentsOptions) {
  const [appointments, setAppointments] = useState<AppointmentWithDoctor[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    if (!enabled || !clinicId) {
      setAppointments([]);
      setLoading(false);
      return;
    }

    setLoading(true);
    const supabase = createClient();
    const today = todayISO();

    let query = supabase
      .from("appointments")
      .select("*, doctor:doctors(full_name_ar)")
      .eq("clinic_id", clinicId)
      .gte("appointment_date", today)
      .order("appointment_date")
      .order("start_time");

    if (doctorId) {
      query = query.eq("doctor_id", doctorId);
    }

    const { data, error } = await query;

    if (error) {
      setAppointments([]);
    } else {
      setAppointments((data as AppointmentWithDoctor[]) ?? []);
    }
    setLoading(false);
  }, [clinicId, doctorId, enabled]);

  useEffect(() => {
    void load();
  }, [load]);

  useAppointmentsRealtime(clinicId, load);
  useClinicSync({
    topics: ["appointments", "all"],
    clinicId,
    onRefresh: load,
    enabled: enabled && !!clinicId,
  });

  const pendingCount = appointments.filter((a) => a.status === "pending").length;

  return {
    appointments,
    loading,
    refresh: load,
    pendingCount,
  };
}
