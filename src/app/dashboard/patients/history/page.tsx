"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { History } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { useActiveClinicId } from "@/hooks/useActiveClinicId";
import { useClinicSync } from "@/hooks/useClinicSync";
import { InvoiceHistoryPanel } from "@/components/doctor-expenses/InvoiceHistoryPanel";

interface DoctorOption {
  id: string;
  full_name_ar: string;
}

export default function PatientInvoiceHistoryPage() {
  const { clinicId } = useActiveClinicId();
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
      <div>
        <p className="text-sm text-slate-muted">
          <Link href="/dashboard/patients" className="text-primary hover:underline">
            ملفات المرضى
          </Link>
          <span className="mx-1">/</span>
          <span>السجل التاريخي</span>
        </p>
        <h1 className="mt-1 flex items-center gap-2 text-2xl font-bold tracking-tight text-slate-text">
          <span className="mc-icon-badge-primary">
            <History className="h-5 w-5" />
          </span>
          السجل التاريخي
        </h1>
        <p className="mc-page-subtitle">
          فواتير الجلسات المعتمدة وصرفيات الأطباء المؤرشفة — مرتبطة بملفات
          المراجعين
        </p>
      </div>

      <InvoiceHistoryPanel
        clinicId={clinicId}
        doctors={doctors}
        refreshKey={refreshKey}
      />
    </div>
  );
}
