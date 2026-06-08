"use client";

import Link from "next/link";
import { CalendarClock, ExternalLink } from "lucide-react";
import { ClinicBookingQr } from "@/components/booking/ClinicBookingQr";
import { Alert } from "@/components/ui/Alert";
import { useActiveClinicId } from "@/hooks/useActiveClinicId";

export default function DashboardBookingPage() {
  const { clinicId, loading, missingClinic } = useActiveClinicId();

  if (loading) {
    return (
      <div className="flex h-48 items-center justify-center">
        <div className="h-8 w-8 animate-spin rounded-full border-2 border-primary border-t-transparent" />
      </div>
    );
  }

  if (missingClinic || !clinicId) {
    return (
      <Alert variant="error">
        لم يتم ربط حسابك بعيادة. تواصل مع مدير النظام.
      </Alert>
    );
  }

  return (
    <div className="mx-auto max-w-xl space-y-6">
      <div>
        <h1 className="flex items-center gap-2 text-2xl font-bold text-slate-text">
          <CalendarClock className="h-7 w-7 text-teal-600" />
          بوابة الحجوزات
        </h1>
        <p className="mt-1 text-slate-muted">
          باركود فريد لعيادتك — يوجّه المرضى مباشرة لصفحة الحجز الخاصة بك.
        </p>
      </div>

      <ClinicBookingQr />

      <p className="text-center text-sm text-slate-muted">
        <Link
          href="/booking"
          target="_blank"
          className="inline-flex items-center gap-1 text-teal-600 hover:underline"
        >
          معاينة بوابة المريض
          <ExternalLink className="h-3.5 w-3.5" />
        </Link>
      </p>
    </div>
  );
}
