"use client";

import { useEffect, useState } from "react";
import { History } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { useActiveClinicId } from "@/hooks/useActiveClinicId";
import { useClinicSync } from "@/hooks/useClinicSync";
import { InvoiceHistoryPanel } from "@/components/doctor-expenses/InvoiceHistoryPanel";
import { PageHeader } from "@/components/ui/PageHeader";
import { useLanguage } from "@/contexts/LanguageContext";

interface DoctorOption {
  id: string;
  full_name_ar: string;
}

export default function PatientInvoiceHistoryPage() {
  const { clinicId } = useActiveClinicId();
  const { bi } = useLanguage();
  const [doctors, setDoctors] = useState<DoctorOption[]>([]);
  const [refreshKey, setRefreshKey] = useState(0);

  useEffect(() => {
    if (!clinicId) {
      setDoctors([]);
      return;
    }
    const supabase = createClient();
    void supabase
      .from("doctors")
      .select("id, full_name_ar")
      .eq("clinic_id", clinicId)
      .eq("is_active", true)
      .order("full_name_ar")
      .then(({ data }) => setDoctors((data as DoctorOption[]) ?? []));
  }, [clinicId]);

  useClinicSync({
    topics: ["financial", "sessions"],
    clinicId: clinicId ?? undefined,
    onRefresh: () => setRefreshKey((k) => k + 1),
    enabled: !!clinicId,
  });

  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <PageHeader
        title="السجل التاريخي"
        eyebrow={bi("ملفات المرضى", "Patient files")}
        icon={History}
        backHref="/dashboard/patients"
        backLabel="ملفات المرضى"
        subtitle="فواتير الجلسات المعتمدة وصرفيات الأطباء المؤرشفة — مرتبطة بملفات المراجعين"
      />

      <InvoiceHistoryPanel
        clinicId={clinicId}
        doctors={doctors}
        refreshKey={refreshKey}
      />
    </div>
  );
}
