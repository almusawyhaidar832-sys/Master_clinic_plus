import { Suspense } from "react";
import { BookingPortal } from "./BookingPortal";

function BookingFallback() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-surface">
      <div className="h-10 w-10 animate-spin rounded-full border-2 border-teal-600 border-t-transparent" />
    </div>
  );
}

export default function PatientBookingPage() {
  return (
    <Suspense fallback={<BookingFallback />}>
      <BookingPortal />
    </Suspense>
  );
}
