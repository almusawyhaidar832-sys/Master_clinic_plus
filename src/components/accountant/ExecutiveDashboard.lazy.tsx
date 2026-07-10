"use client";

import dynamic from "next/dynamic";

/**
 * Code-split wrapper: moves the executive dashboard's JS + data fetching
 * out of the main dashboard-home bundle so the page shell paints first.
 * Does not change any of the financial calculations inside it.
 */
export const ExecutiveDashboard = dynamic(
  () =>
    import("@/components/accountant/ExecutiveDashboard").then(
      (mod) => mod.ExecutiveDashboard
    ),
  {
    ssr: false,
    loading: () => (
      <div className="space-y-3 animate-pulse">
        <div className="h-6 w-56 rounded bg-slate-100" />
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="h-24 rounded-xl bg-slate-100" />
          ))}
        </div>
        <div className="h-64 rounded-xl bg-slate-100" />
      </div>
    ),
  }
);
