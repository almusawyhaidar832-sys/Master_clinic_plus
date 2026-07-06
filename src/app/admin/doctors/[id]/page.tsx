"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import { Button } from "@/components/ui/Button";
import { authPortalHeaders } from "@/lib/auth/api-portal";
import { useActiveClinicId } from "@/hooks/useActiveClinicId";
import { fetchDoctorLedgerDetail } from "@/lib/services/clinic-reports";
import { DoctorPayoutStatement } from "@/components/branding/DoctorPayoutStatement";
import { ReportActions } from "@/components/reports/ReportActions";
import { useClinicProfile } from "@/contexts/ClinicProfileContext";
import { formatDoctorDisplayName } from "@/lib/services/clinic-profile";
import { currentMonthYear } from "@/lib/utils";
import { ArrowRight } from "lucide-react";
import type { Doctor } from "@/types";

type DoctorLedgerDetail = Awaited<ReturnType<typeof fetchDoctorLedgerDetail>>;

export default function AdminDoctorLedgerDetailPage() {
  const params = useParams();
  const id = params.id as string;
  const { profile, displayName } = useClinicProfile();
  const { clinicId } = useActiveClinicId();
  const [data, setData] = useState<DoctorLedgerDetail | null>(null);

  useEffect(() => {
    async function load() {
      if (!id || !clinicId) return;

      const repairKey = `mc:doctor-shares-auto-repair:v8:${clinicId}:${id}`;
      const needSync =
        typeof window !== "undefined" && !sessionStorage.getItem(repairKey);

      const params = new URLSearchParams({
        doctor_id: id,
        month_year: currentMonthYear(),
      });
      if (needSync) params.set("sync_shares", "1");

      const res = await fetch(`/api/admin/doctor-ledger?${params}`, {
        credentials: "include",
        headers: authPortalHeaders("admin"),
      });
      const json = (await res.json()) as {
        data?: DoctorLedgerDetail;
        error?: string;
      };

      if (res.ok && json.data) {
        if (needSync && typeof window !== "undefined") {
          sessionStorage.setItem(repairKey, "1");
        }
        setData(json.data);
      } else {
        setData(null);
      }
    }
    void load();
  }, [id, clinicId]);

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
        salaryPayouts={data.salaryPayouts}
        settlement={data.settlement}
      />
    </div>
  );
}
