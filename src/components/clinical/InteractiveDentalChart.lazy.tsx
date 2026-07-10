"use client";

import dynamic from "next/dynamic";

/**
 * Code-split wrapper: defers loading the odontogram (react-odontogram) bundle
 * until a dental chart is actually rendered. Does not change any behavior/logic.
 */
export const InteractiveDentalChart = dynamic(
  () =>
    import("@/components/clinical/InteractiveDentalChart").then(
      (mod) => mod.InteractiveDentalChart
    ),
  {
    ssr: false,
    loading: () => (
      <div className="grid animate-pulse grid-cols-8 gap-2 rounded-xl border border-slate-border p-4">
        {Array.from({ length: 16 }).map((_, i) => (
          <div key={i} className="h-10 rounded-lg bg-slate-100" />
        ))}
      </div>
    ),
  }
);
