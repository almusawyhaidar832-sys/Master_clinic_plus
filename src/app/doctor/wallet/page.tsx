"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { formatCurrency } from "@/lib/utils";
import { cacheDoctorBalance, getCachedDoctorBalance } from "@/lib/offline-cache";
import { createClient } from "@/lib/supabase/client";
import { getDoctorForCurrentUser } from "@/lib/clinic-context";
import { fetchDoctorWalletStats } from "@/lib/services/doctor-wallet";
import { Button } from "@/components/ui/Button";
import { ArrowDownToLine } from "lucide-react";

export default function DoctorWalletPage() {
  const [stats, setStats] = useState<{
    availableBalance: number;
    totalEarnings: number;
    totalWithdrawn: number;
    pendingAmount: number;
    approvedAmount: number;
  } | null>(null);
  const [offline, setOffline] = useState(false);
  const [doctorId, setDoctorId] = useState<string | null>(null);

  useEffect(() => {
    async function load() {
      const supabase = createClient();
      const doctor = await getDoctorForCurrentUser(supabase);

      if (!doctor) {
        setStats({
          availableBalance: 0,
          totalEarnings: 0,
          totalWithdrawn: 0,
          pendingAmount: 0,
          approvedAmount: 0,
        });
        return;
      }

      setDoctorId(doctor.id);

      if (!navigator.onLine) {
        setOffline(true);
        const cached = getCachedDoctorBalance(doctor.id) ?? 0;
        setStats({
          availableBalance: cached,
          totalEarnings: 0,
          totalWithdrawn: 0,
          pendingAmount: 0,
          approvedAmount: 0,
        });
        return;
      }

      const live = await fetchDoctorWalletStats(supabase, doctor.id);
      setStats(live);
      cacheDoctorBalance(live.availableBalance, doctor.id);
    }
    load();
  }, []);

  const rows = [
    { label: "إجمالي الأرباح", value: stats?.totalEarnings, highlight: false },
    { label: "المسحوب (مدفوع)", value: stats?.totalWithdrawn, highlight: false },
    { label: "طلبات معلّقة", value: stats?.pendingAmount, highlight: true },
    { label: "موافق عليها (لم تُدفع)", value: stats?.approvedAmount, highlight: true },
  ];

  return (
    <div className="space-y-4">
      {offline && (
        <p className="rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-800">
          وضع عدم الاتصال — عرض آخر رصيد محفوظ
        </p>
      )}
      {!doctorId && stats?.availableBalance === 0 && (
        <p className="rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-800">
          لم يُربط حسابك بسجل طبيب. تواصل مع الإدارة.
        </p>
      )}
      <div className="rounded-2xl bg-gradient-to-br from-primary to-primary-700 p-8 text-white shadow-premium">
        <p className="text-sm opacity-90">الرصيد القابل للسحب</p>
        <p className="mt-2 text-4xl font-bold">
          {stats !== null ? formatCurrency(stats.availableBalance) : "…"}
        </p>
      </div>

      <div className="space-y-2 rounded-xl border border-slate-border bg-surface-card p-4">
        {rows.map(({ label, value, highlight }) => (
          <div key={label} className="flex justify-between text-sm">
            <span className="text-slate-muted">{label}</span>
            <span
              className={
                highlight && (value ?? 0) > 0
                  ? "font-semibold text-amber-600"
                  : "font-medium text-slate-text"
              }
            >
              {stats !== null ? formatCurrency(value ?? 0) : "…"}
            </span>
          </div>
        ))}
      </div>

      <Link href="/doctor/withdraw">
        <Button className="w-full">
          <ArrowDownToLine className="h-4 w-4" />
          طلب سحب جديد
        </Button>
      </Link>

      <p className="text-xs text-slate-muted text-center leading-relaxed">
        طلب السحب لا يخصم من رصيدك — يُخصم عند موافقة المحاسب أو الدفع.
        المحاسب يمكنه أيضاً تسجيل دفع نقدي مباشر.
      </p>
    </div>
  );
}
