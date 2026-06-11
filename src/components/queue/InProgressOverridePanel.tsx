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
    <aside className="rounded-2xl border border-amber-200 bg-amber-50/60 p-4">
      <div className="mb-3 flex items-center gap-2 text-amber-900">
        <Stethoscope className="h-5 w-5 shrink-0" />
        <div>
          <h2 className="text-sm font-bold">داخل غرفة الطبيب</h2>
          <p className="text-xs text-amber-800/80">
            إن نسي الطبيب إنهاء الجلسة — أنهِها من هنا
          </p>
        </div>
      </div>

      <ul className="space-y-2">
        {entries.map((entry) => {
          const name =
            entry.patient?.full_name_ar ??
            entry.patient_name ??
            `رقم ${entry.ticket_number}`;
          const busy = updatingId === entry.id;

          return (
            <li
              key={entry.id}
              className="rounded-xl border border-amber-100 bg-white p-3 shadow-sm"
            >
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <p className="truncate text-sm font-semibold text-slate-800">{name}</p>
                  <p className="text-xs text-slate-500">
                    {entry.doctor?.full_name_ar ?? "—"} · #{entry.ticket_number}
                  </p>
                </div>
                <span className="shrink-0 rounded-lg bg-emerald-100 px-2 py-0.5 text-[10px] font-bold text-emerald-800">
                  داخل الكشف
                </span>
              </div>
              <button
                type="button"
                onClick={() => onOverride(entry)}
                disabled={busy}
                className={cn(
                  "mt-2 flex w-full items-center justify-center gap-1.5 rounded-lg bg-violet-600 py-2 text-xs font-bold text-white hover:bg-violet-700 disabled:opacity-60"
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
