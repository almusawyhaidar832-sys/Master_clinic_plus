"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Shield, X } from "lucide-react";
import { DEVELOPER_COOKIE } from "@/lib/auth/developer-token";

export function DeveloperImpersonationBanner() {
  const [state, setState] = useState<{
    clinicName: string;
    clinicId: string;
  } | null>(null);
  const [exiting, setExiting] = useState(false);

  useEffect(() => {
    if (!document.cookie.includes(`${DEVELOPER_COOKIE}=`)) return;

    fetch("/api/developer/session", { credentials: "include", cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        if (data?.actingClinicId) {
          setState({
            clinicId: data.actingClinicId,
            clinicName: data.clinicName || "عيادة",
          });
        }
      })
      .catch(() => {});
  }, []);

  if (!state) return null;

  async function exitImpersonation() {
    setExiting(true);
    await fetch("/api/developer/exit-clinic", { method: "POST" });
    window.location.href = "/developer";
  }

  return (
    <div className="mb-4 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-amber-500/40 bg-amber-950/40 px-4 py-3 text-sm">
      <div className="flex items-center gap-2 text-amber-100">
        <Shield className="h-4 w-4 shrink-0 text-amber-400" />
        <span>
          دخول نيابة — <strong>{state.clinicName}</strong>
          <span className="mr-2 text-xs text-amber-400/80" dir="ltr">
            ({state.clinicId.slice(0, 8)}…)
          </span>
        </span>
      </div>
      <div className="flex items-center gap-2">
        <Link
          href="/developer"
          className="rounded-lg border border-amber-600/50 px-3 py-1.5 text-xs text-amber-200 hover:bg-amber-900/50"
        >
          لوحة المطور
        </Link>
        <button
          type="button"
          disabled={exiting}
          onClick={() => void exitImpersonation()}
          className="inline-flex items-center gap-1 rounded-lg bg-amber-700 px-3 py-1.5 text-xs font-medium text-white hover:bg-amber-600 disabled:opacity-60"
        >
          <X className="h-3.5 w-3.5" />
          {exiting ? "..." : "إنهاء النيابة"}
        </button>
      </div>
    </div>
  );
}
