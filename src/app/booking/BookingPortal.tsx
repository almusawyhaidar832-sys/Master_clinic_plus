"use client";

import { useSearchParams } from "next/navigation";
import { BookingClinicPicker } from "@/components/booking/BookingClinicPicker";
import { BookingForm } from "@/components/booking/BookingForm";

export function BookingPortal() {
  const searchParams = useSearchParams();
  const clinicRef = searchParams.get("clinic")?.trim() ?? "";

  return (
    <div className="min-h-screen bg-gradient-to-b from-teal-50/40 to-surface px-4 py-10">
      {clinicRef ? (
        <BookingForm clinicRef={clinicRef} />
      ) : (
        <BookingClinicPicker />
      )}
    </div>
  );
}
