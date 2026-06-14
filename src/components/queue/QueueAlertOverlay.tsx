"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Bell, Receipt, Stethoscope, UserPlus, Volume2, X } from "lucide-react";
import { cn } from "@/lib/utils";
import {
  replayQueueAlert,
  subscribeQueueAlerts,
  type QueueAlertDetail,
} from "@/lib/queue/audio-alerts";

/**
 * On-screen alert banner for queue events.
 * Audio unlock is handled globally by AudioAlertsProvider (first click, no button).
 */
export function QueueAlertOverlay() {
  const router = useRouter();
  const [alert, setAlert] = useState<QueueAlertDetail | null>(null);

  useEffect(() => {
    return subscribeQueueAlerts((detail) => {
      setAlert(detail);
    });
  }, []);

  useEffect(() => {
    if (!alert) return;
    const timer = setTimeout(() => setAlert(null), 12000);
    return () => clearTimeout(timer);
  }, [alert]);

  if (!alert) return null;

  const isTestAlert =
    alert.title.includes("تجربة") ||
    alert.title.toLowerCase().includes("test alert");

  const AlertIcon =
    alert.kind === "doctor_exam"
      ? Stethoscope
      : alert.kind === "doctor_new"
        ? UserPlus
        : alert.kind === "accountant_billing"
          ? Receipt
          : Bell;

  return (
    <div
      role="alert"
      onClick={() => {
        if (alert.linkPath) {
          router.push(alert.linkPath);
          setAlert(null);
        }
      }}
      className={cn(
        "fixed inset-x-3 top-[calc(3.75rem+env(safe-area-inset-top,0px))] z-[100] mx-auto max-w-md",
        "rounded-2xl border p-4 shadow-lg backdrop-blur-sm transition-transform",
        alert.linkPath && "cursor-pointer active:scale-[0.99]",
        alert.kind === "doctor_new"
          ? "border-violet-400/60 bg-violet-950/95 text-white"
          : alert.kind === "doctor_exam"
            ? "border-sky-400/60 bg-sky-950/95 text-white"
            : alert.kind === "accountant_billing"
              ? "border-fuchsia-400/60 bg-fuchsia-950/95 text-white"
              : "border-emerald-400/60 bg-emerald-950/95 text-white"
      )}
    >
      <div className="flex items-start gap-3">
        <div
          className={cn(
            "flex h-11 w-11 flex-shrink-0 items-center justify-center rounded-xl",
            alert.kind === "doctor_new"
              ? "bg-violet-500/30 text-violet-100"
              : alert.kind === "doctor_exam"
                ? "bg-sky-500/30 text-sky-100"
                : alert.kind === "accountant_billing"
                  ? "bg-fuchsia-500/30 text-fuchsia-100"
                  : "bg-emerald-500/30 text-emerald-100"
          )}
        >
          <AlertIcon className="h-6 w-6" />
        </div>
        <div className="min-w-0 flex-1">
          <p className="text-base font-bold leading-snug">{alert.title}</p>
          <p className="mt-1 text-sm leading-relaxed text-white/90">{alert.message}</p>
          {alert.linkPath && !isTestAlert && (
            <p className="mt-2 text-xs font-medium text-white/70">
              اضغط للانتقال إلى غرفة الانتظار
            </p>
          )}
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              replayQueueAlert(alert);
            }}
            className="mt-3 inline-flex items-center gap-1.5 rounded-lg bg-white/15 px-3 py-1.5 text-xs font-semibold text-white hover:bg-white/25"
          >
            <Volume2 className="h-3.5 w-3.5" />
            إعادة النداء
          </button>
        </div>
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            setAlert(null);
          }}
          className="rounded-lg p-1 opacity-60 hover:opacity-100"
          aria-label="إغلاق"
        >
          <X className="h-5 w-5" />
        </button>
      </div>
    </div>
  );
}
