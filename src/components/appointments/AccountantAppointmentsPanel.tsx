"use client";

import Link from "next/link";
import { AppointmentTable } from "@/components/appointments/AppointmentTable";
import { useActiveClinicId } from "@/hooks/useActiveClinicId";

interface AccountantAppointmentsPanelProps {
  /** صفحة كاملة — بدون وضع مضغوط */
  fullPage?: boolean;
}

/** لوحة المحاسب — حجز وإدارة مواعيد كل الأطباء */
export function AccountantAppointmentsPanel({
  fullPage = false,
}: AccountantAppointmentsPanelProps) {
  const { clinicId, loading, missingClinic } = useActiveClinicId();

  if (loading) return null;

  if (!clinicId) {
    return (
      <div className="rounded-2xl border border-warning-border bg-warning p-6 text-center text-sm font-medium text-warning-text shadow-card">
        {missingClinic
          ? "حسابك غير مربوط بعيادة — تواصل مع الإدارة"
          : "تعذر تحميل بيانات العيادة"}
      </div>
    );
  }

  return (
    <>
      {!fullPage && (
        <div className="mb-2 flex justify-end gap-2">
          <Link
            href="/dashboard/appointments/schedule"
            className="mc-chip text-xs"
          >
            جدول المواعيد
          </Link>
          <Link
            href="/dashboard/appointments"
            className="mc-chip mc-chip--active text-xs"
          >
            صفحة الحجز الكاملة ←
          </Link>
        </div>
      )}
    <AppointmentTable
      role="accountant"
      clinicId={clinicId}
      compact={!fullPage}
      title={fullPage ? "حجز مراجع جديد" : undefined}
      subtitle={
        fullPage
          ? "استقبل اتصال المراجع واحجز موعداً فورياً — يظهر مباشرة في جدول الطبيب وغرفة الانتظار عند الموافقة"
          : undefined
      }
    />
    </>
  );
}
