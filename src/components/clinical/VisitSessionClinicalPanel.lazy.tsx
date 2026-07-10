"use client";

import dynamic from "next/dynamic";

/**
 * Code-split wrapper: defers loading the clinical session panel's JS bundle
 * until it is actually rendered (e.g. an active queue entry is selected).
 * Does not change any behavior/logic inside VisitSessionClinicalPanel itself.
 */
export const VisitSessionClinicalPanel = dynamic(
  () =>
    import("@/components/clinical/VisitSessionClinicalPanel").then(
      (mod) => mod.VisitSessionClinicalPanel
    ),
  {
    ssr: false,
    loading: () => (
      <div className="space-y-3 animate-pulse p-4">
        <div className="h-5 w-40 rounded bg-slate-100" />
        <div className="h-24 rounded-xl bg-slate-100" />
        <div className="h-24 rounded-xl bg-slate-100" />
      </div>
    ),
  }
);
