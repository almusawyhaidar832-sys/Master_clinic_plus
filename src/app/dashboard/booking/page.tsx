"use client";

import Link from "next/link";
import { CalendarClock, ExternalLink } from "lucide-react";
import { ClinicBookingQr } from "@/components/booking/ClinicBookingQr";
import { Alert } from "@/components/ui/Alert";
import { useActiveClinicId } from "@/hooks/useActiveClinicId";
import { PageHeader } from "@/components/ui/PageHeader";
import { useLanguage } from "@/contexts/LanguageContext";

export default function DashboardBookingPage() {
  const { clinicId, loading, missingClinic } = useActiveClinicId();
  const { bi } = useLanguage();

  if (loading) {
    return (
      <div className="mx-auto max-w-3xl space-y-4">
        <div className="mc-skeleton h-24 rounded-3xl" />
        <div className="mc-skeleton h-80 rounded-2xl" />
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
    <div className="mx-auto max-w-3xl space-y-6">
      <PageHeader
        eyebrow={bi("المواعيد", "Scheduling")}
        title="بوابة الحجوزات"
        subtitle="باركود فريد لعيادتك — يوجّه المرضى مباشرة لصفحة الحجز الخاصة بك."
        icon={CalendarClock}
        className="mb-0"
        actions={
          <Link href="/booking" target="_blank" className="mc-btn-soft">
            معاينة بوابة المريض
            <ExternalLink className="h-3.5 w-3.5" />
          </Link>
        }
      />

      <ClinicBookingQr />
    </div>
  );
}
