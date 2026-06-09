"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Bell, BellOff, X } from "lucide-react";
import { cn } from "@/lib/utils";
import {
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
        "fixed left-4 right-4 top-20 z-[100] mx-auto max-w-lg rounded-2xl border-2 p-4 shadow-2xl",
        alert.linkPath && "cursor-pointer hover:brightness-[0.98]",
        alert.kind === "doctor_new"
          ? "border-violet-300 bg-violet-50 text-violet-950"
          : alert.kind === "doctor_exam"
          ? "border-blue-300 bg-blue-50 text-blue-950"
          : "border-emerald-300 bg-emerald-50 text-emerald-950"
      )}
    >
      <div className="flex items-start gap-3">
        <div
          className={cn(
            "flex h-11 w-11 flex-shrink-0 items-center justify-center rounded-xl",
            alert.kind === "doctor_new"
              ? "bg-violet-200 text-violet-700"
              : alert.kind === "doctor_exam"
              ? "bg-blue-200 text-blue-700"
              : "bg-emerald-200 text-emerald-700"
          )}
        >
          {alert.kind === "doctor_new" ? (
            <Bell className="h-6 w-6" />
          ) : (
            <BellOff className="h-6 w-6" />
          )}
        </div>
        <div className="min-w-0 flex-1">
          <p className="font-bold">{alert.title}</p>
          <p className="mt-1 text-sm leading-relaxed">{alert.message}</p>
          {alert.linkPath && (
            <p className="mt-1 text-xs font-medium opacity-80">
              اضغط لفتح الصفحة
            </p>
          )}
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
