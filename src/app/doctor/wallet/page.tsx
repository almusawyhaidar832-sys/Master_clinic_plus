"use client";

import { useEffect, useState } from "react";
import { formatCurrency } from "@/lib/utils";
import {
  cacheDoctorBalance,
  getCachedDoctorBalance,
} from "@/lib/offline-cache";
import { createClient } from "@/lib/supabase/client";
import { getDoctorForCurrentUser } from "@/lib/clinic-context";
import { fetchDoctorWithdrawableBalance } from "@/lib/services/clinic-stats";

export default function DoctorWalletPage() {
  const [balance, setBalance] = useState<number | null>(null);
  const [offline, setOffline] = useState(false);
  const [doctorId, setDoctorId] = useState<string | null>(null);

  useEffect(() => {
    async function load() {
      const supabase = createClient();
      const doctor = await getDoctorForCurrentUser(supabase);

      if (!doctor) {
        setBalance(0);
        return;
      }

      setDoctorId(doctor.id);

      if (!navigator.onLine) {
        setOffline(true);
        setBalance(getCachedDoctorBalance(doctor.id) ?? 0);
        return;
      }

      const cached = getCachedDoctorBalance(doctor.id);
      if (cached !== null) setBalance(cached);

      const live = await fetchDoctorWithdrawableBalance(supabase, doctor.id);
      setBalance(live);
      cacheDoctorBalance(live, doctor.id);
    }
    load();
  }, []);

  return (
    <div className="space-y-4">
      {offline && (
        <p className="rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-800">
          وضع عدم الاتصال — عرض آخر رصيد محفوظ
        </p>
      )}
      {!doctorId && balance === 0 && (
        <p className="rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-800">
          لم يُربط حسابك بسجل طبيب. تواصل مع الإدارة.
        </p>
      )}
      <div className="rounded-2xl bg-gradient-to-br from-primary to-primary-700 p-8 text-white shadow-premium">
        <p className="text-sm opacity-90">الرصيد الصافي القابل للسحب</p>
        <p className="mt-2 text-4xl font-bold">
          {balance !== null ? formatCurrency(balance) : "…"}
        </p>
      </div>
      <p className="text-xs text-slate-muted text-center">
        يخصم تلقائياً منه طلبات السحب المعلّقة والموافق عليها
      </p>
    </div>
  );
}
