"use client";

import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { getAssistantForCurrentUser } from "@/lib/clinic-context";
import { AppointmentTable } from "@/components/appointments/AppointmentTable";
import type { Assistant } from "@/types";

/** لوحة المساعد — إدارة كاملة لمواعيد الطبيب */
export function AssistantAppointmentsPanel() {
  const [assistant, setAssistant] = useState<Assistant | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const supabase = createClient();
    getAssistantForCurrentUser(supabase).then((asst) => {
      setAssistant(asst);
      setLoading(false);
    });
  }, []);

  if (loading) return null;

  if (!assistant) {
    return (
      <div className="rounded-2xl border border-amber-200 bg-amber-50 p-6 text-center text-sm text-amber-800">
        لم يتم ربط حسابك بسجل مساعد — تواصل مع المحاسب لإعادة الربط.
      </div>
    );
  }

  return (
    <AppointmentTable
      role="assistant"
      clinicId={assistant.clinic_id}
      doctorId={assistant.doctor_id}
    />
  );
}
