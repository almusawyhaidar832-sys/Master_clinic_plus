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
      <div className="rounded-2xl border border-amber-200 bg-amber-50 p-6 text-center text-sm text-amber-800">
        {missingClinic
          ? "حسابك غير مربوط بعيادة — تواصل مع الإدارة"
          : "تعذر تحميل بيانات العيادة"}
      </div>
    );
  }

  return (
    <>
      {!fullPage && (
        <div className="mb-2 flex justify-end gap-3">
          <Link
            href="/dashboard/appointments/schedule"
            className="text-sm font-semibold text-slate-muted hover:text-primary hover:underline"
          >
            جدول المواعيد
          </Link>
          <Link
            href="/dashboard/appointments"
            className="text-sm font-semibold text-primary hover:underline"
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
