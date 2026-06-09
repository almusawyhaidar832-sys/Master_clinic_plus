"use client";

import { useCallback, useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { useAppointmentsRealtime } from "@/hooks/useAppointmentsRealtime";
import { useClinicSync } from "@/hooks/useClinicSync";
import type { AppointmentWithDoctor } from "@/hooks/useCentralizedAppointments";

export interface UseAppointmentScheduleOptions {
  clinicId: string | null | undefined;
  dateFrom: string;
  dateTo: string;
  doctorId?: string | null;
  enabled?: boolean;
}

/**
 * حجوزات ضمن نطاق تاريخ — نفس جدول appointments + Realtime
 */
export function useAppointmentSchedule({
  clinicId,
  dateFrom,
  dateTo,
  doctorId = null,
  enabled = true,
}: UseAppointmentScheduleOptions) {
  const [appointments, setAppointments] = useState<AppointmentWithDoctor[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    if (!enabled || !clinicId || !dateFrom || !dateTo) {
      setAppointments([]);
      setLoading(false);
      return;
    }

    setLoading(true);
    const supabase = createClient();

    let query = supabase
      .from("appointments")
      .select("*, doctor:doctors(full_name_ar)")
      .eq("clinic_id", clinicId)
      .gte("appointment_date", dateFrom)
      .lte("appointment_date", dateTo)
      .order("appointment_date", { ascending: true })
      .order("start_time", { ascending: true });

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
  }, [clinicId, dateFrom, dateTo, doctorId, enabled]);

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

  return { appointments, loading, refresh: load };
}
