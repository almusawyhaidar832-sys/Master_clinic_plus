"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import { Button } from "@/components/ui/Button";
import { createClient } from "@/lib/supabase/client";
import { fetchDoctorLedgerDetail } from "@/lib/services/clinic-reports";
import { DoctorPayoutStatement } from "@/components/branding/DoctorPayoutStatement";
import { ReportActions } from "@/components/reports/ReportActions";
import { useClinicProfile } from "@/contexts/ClinicProfileContext";
import { formatDoctorDisplayName } from "@/lib/services/clinic-profile";
import { currentMonthYear } from "@/lib/utils";
import { ArrowRight } from "lucide-react";
import type { Doctor } from "@/types";

export default function AdminDoctorLedgerDetailPage() {
  const params = useParams();
  const id = params.id as string;
  const { profile, displayName } = useClinicProfile();
  const [data, setData] = useState<Awaited<
    ReturnType<typeof fetchDoctorLedgerDetail>
  > | null>(null);

  useEffect(() => {
    async function load() {
      const supabase = createClient();
      const result = await fetchDoctorLedgerDetail(supabase, id, currentMonthYear());
      setData(result);
    }
    if (id) load();
  }, [id]);

  if (!data?.doctor || !data.summary) {
    return <p className="text-sm text-slate-muted">جاري التحميل...</p>;
  }

  const doctor = data.doctor as Doctor;

  return (
    <div className="space-y-4">
      <Link href="/admin/doctors">
        <Button variant="ghost" size="sm">
          <ArrowRight className="h-4 w-4" />
          كل الأطباء
        </Button>
      </Link>

      <div className="no-print">
        <h2 className="text-lg font-bold text-slate-text">
          {formatDoctorDisplayName(doctor.full_name_ar)}
        </h2>
        <p className="text-sm text-slate-muted">{displayName}</p>
      </div>

      <div className="no-print">
        <ReportActions
          shareTitle={`كشف طبيب ${doctor.full_name_ar} — ${displayName}`}
          printTargetId="doctor-payout-statement-print"
        />
      </div>

      <DoctorPayoutStatement
        clinic={profile}
        doctor={doctor}
        summary={data.summary}
        operations={data.operations}
        withdrawals={data.withdrawals}
      />
    </div>
  );
}
