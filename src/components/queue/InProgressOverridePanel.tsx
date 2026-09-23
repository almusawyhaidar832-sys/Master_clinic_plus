"use client";

import { Stethoscope, RefreshCw, LogOut } from "lucide-react";
import { cn } from "@/lib/utils";

export interface InProgressQueueEntry {
  id: string;
  ticket_number: number;
  status: string;
  patient_name: string | null;
  patient_id: string | null;
  doctor_id: string;
  doctor: { full_name_ar: string } | null;
  patient: { full_name_ar: string } | null;
}

interface InProgressOverridePanelProps {
  entries: InProgressQueueEntry[];
  updatingId: string | null;
  onOverride: (entry: InProgressQueueEntry) => void;
}

export function InProgressOverridePanel({
  entries,
  updatingId,
  onOverride,
}: InProgressOverridePanelProps) {
  if (entries.length === 0) return null;

  return (
    <aside className="mc-panel">
      <div className="mc-panel-head">
        <div className="flex min-w-0 items-center gap-3">
          <span className="mc-icon-tile h-9 w-9 rounded-xl" aria-hidden>
            <Stethoscope className="h-4 w-4" />
          </span>
          <div className="min-w-0">
            <h2 className="flex items-center gap-2 text-sm font-bold text-slate-text">
              داخل غرفة الطبيب
              <span className="rounded-full border border-success-border bg-success px-1.5 py-0.5 text-[10px] font-bold tabular-nums text-success-text">
                {entries.length}
              </span>
            </h2>
            <p className="text-[11px] leading-snug text-slate-muted">
              إن نسي الطبيب إنهاء الجلسة — أنهِها من هنا
            </p>
          </div>
        </div>
      </div>

      <ul className="space-y-2.5 p-3">
        {entries.map((entry) => {
          const name =
            entry.patient?.full_name_ar ??
            entry.patient_name ??
            `رقم ${entry.ticket_number}`;
          const busy = updatingId === entry.id;

          return (
            <li
              key={entry.id}
              className="relative overflow-hidden rounded-xl border border-slate-border bg-surface-card p-3 ps-4 shadow-card"
            >
              <span aria-hidden className="absolute inset-y-2.5 start-0 w-1 rounded-full bg-emerald-500" />
              <div className="flex items-start gap-2.5">
                <span className="mc-icon-tile h-9 w-9 rounded-lg text-sm font-black tabular-nums">
                  {entry.ticket_number}
                </span>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-bold text-slate-text">{name}</p>
                  <p className="mt-0.5 flex items-center gap-1 truncate text-[11px] text-slate-muted">
                    <Stethoscope className="h-3 w-3 shrink-0 text-premium-500" />
                    {entry.doctor?.full_name_ar ?? "—"} · #{entry.ticket_number}
                  </p>
                </div>
                <span className="inline-flex shrink-0 items-center gap-1 rounded-full border border-success-border bg-success px-2 py-0.5 text-[10px] font-bold text-success-text">
                  <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-emerald-500" />
                  داخل الكشف
                </span>
              </div>
              <button
                type="button"
                onClick={() => onOverride(entry)}
                disabled={busy}
                className={cn(
                  "mc-btn-soft mt-3 w-full py-2 text-xs text-royal-700 hover:border-royal-200 hover:bg-royal-50"
                )}
              >
                {busy ? (
                  <RefreshCw className="h-3.5 w-3.5 animate-spin" />
                ) : (
                  <LogOut className="h-3.5 w-3.5" />
                )}
                إنهاء الجلسة وتحويل للمحاسبة
              </button>
            </li>
          );
        })}
      </ul>
    </aside>
  );
}
