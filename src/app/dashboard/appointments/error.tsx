"use client";

import { useEffect } from "react";

export default function AppointmentsError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error("[appointments]", error);
  }, [error]);

  return (
    <div className="mx-auto max-w-lg rounded-2xl border border-red-200 bg-red-50 p-6 text-center">
      <h2 className="text-lg font-bold text-red-800">تعذر تحميل الحجوزات</h2>
      <p className="mt-2 text-sm text-red-700">
        حدث خطأ أثناء عرض المواعيد. جرّب التحديث — إذا تكرر، تواصل مع الدعم.
      </p>
      {error.message ? (
        <p className="mt-2 break-all font-mono text-xs text-red-600/80">
          {error.message}
        </p>
      ) : null}
      <button
        type="button"
        onClick={reset}
        className="mt-4 rounded-xl bg-red-600 px-4 py-2 text-sm font-semibold text-white hover:bg-red-700"
      >
        إعادة المحاولة
      </button>
    </div>
  );
}
