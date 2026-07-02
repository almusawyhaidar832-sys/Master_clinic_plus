"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Card } from "@/components/ui/Card";
import { createClient } from "@/lib/supabase/client";
import {
  fetchDoctorLedgers,
  type DoctorLedgerSummary,
} from "@/lib/services/clinic-reports";
import { formatCurrency, currentMonthYear } from "@/lib/utils";
import { ChevronLeft, Stethoscope } from "lucide-react";

export default function AdminDoctorsLedgerPage() {
  const [doctors, setDoctors] = useState<DoctorLedgerSummary[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function load() {
      const supabase = createClient();
      const data = await fetchDoctorLedgers(supabase, currentMonthYear());
      setDoctors(data);
      setLoading(false);
    }
    load();
  }, []);

  if (loading) {
    return <p className="text-sm text-slate-muted">جاري التحميل...</p>;
  }

  return (
    <div className="space-y-4">
      <div>
        <h2 className="flex items-center gap-2 text-xl font-bold tracking-tight text-slate-text">
          <span className="mc-icon-badge-primary">
            <Stethoscope className="h-4.5 w-4.5" />
          </span>
          حسابات الأطباء
        </h2>
        <p className="mt-1 text-sm text-slate-muted">
          دفتر مالي لكل طبيب — مستحقات ومسحوبات الشهر الحالي، والرصيد القابل للسحب الآن
        </p>
      </div>

      {doctors.length === 0 ? (
        <p className="text-sm text-slate-muted">لا يوجد أطباء مسجّلون</p>
      ) : (
        doctors.map((d) => (
          <Link key={d.id} href={`/admin/doctors/${d.id}`}>
            <Card hoverable className="group flex items-center justify-between p-4 active:scale-[0.98]">
              <div className="min-w-0 flex-1">
                <p className="font-semibold text-slate-text">{d.full_name_ar}</p>
                {d.specialty_ar && (
                  <p className="text-xs text-slate-muted">{d.specialty_ar}</p>
                )}
                <p className="text-[11px] text-primary font-medium">{d.paymentLabel}</p>
                <div className="mt-2 grid grid-cols-2 gap-x-3 gap-y-1 text-[11px]">
                  <span className="text-slate-muted">
                    مستحق (الشهر):{" "}
                    <strong className="text-slate-text">
                      {formatCurrency(d.totalEarned)}
                    </strong>
                  </span>
                  <span className="text-slate-muted">
                    مسحوب (الشهر):{" "}
                    <strong>{formatCurrency(d.totalWithdrawn)}</strong>
                  </span>
                  <span className="text-primary">
                    قابل للسحب (الآن): {formatCurrency(d.withdrawableBalance)}
                  </span>
                  {d.pendingWithdrawalAmount > 0 && (
                    <span className="text-warning-text">
                      معلّق: {formatCurrency(d.pendingWithdrawalAmount)}
                    </span>
                  )}
                </div>
              </div>
              <ChevronLeft className="h-5 w-5 flex-shrink-0 text-slate-muted transition-transform group-hover:-translate-x-0.5" />
            </Card>
          </Link>
        ))
      )}
    </div>
  );
}
