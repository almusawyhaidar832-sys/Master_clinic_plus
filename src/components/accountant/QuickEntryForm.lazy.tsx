"use client";

import dynamic from "next/dynamic";

/**
 * Code-split wrapper: defers loading QuickEntryForm's JS bundle until it is
 * actually rendered. Does not change any behavior/logic inside the form.
 */
export const QuickEntryForm = dynamic(
  () =>
    import("@/components/accountant/QuickEntryForm").then(
      (mod) => mod.QuickEntryForm
    ),
  {
    ssr: false,
    loading: () => (
      <div className="space-y-3 animate-pulse rounded-xl border border-slate-border p-4">
        <div className="h-5 w-48 rounded bg-slate-100" />
        <div className="h-10 rounded-lg bg-slate-100" />
        <div className="h-10 rounded-lg bg-slate-100" />
        <div className="h-24 rounded-lg bg-slate-100" />
      </div>
    ),
  }
);
