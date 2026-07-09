"use client";

import { useState } from "react";
import { Trash2, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { authPortalHeaders } from "@/lib/auth/api-portal";
import type { AuthPortalId } from "@/lib/auth/portal-access";
import { useActiveClinicId } from "@/hooks/useActiveClinicId";
import { notifyClinicSync } from "@/lib/sync/clinic-events";
import {
  clearAllPendingClinicTopUps,
  clearPendingClinicTopUp,
} from "@/lib/services/clinic-profit-pending";

interface ClearClinicTopUpsButtonProps {
  portal?: AuthPortalId;
  scope?: "month" | "all";
  size?: "sm" | "md";
  variant?: "outline" | "danger" | "ghost";
  onCleared?: () => void;
}

export function ClearClinicTopUpsButton({
  portal = "admin",
  scope = "month",
  size = "sm",
  variant = "outline",
  onCleared,
}: ClearClinicTopUpsButtonProps) {
  const { clinicId } = useActiveClinicId();
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  async function handleClear() {
    if (!clinicId) return;

    const ok = window.confirm(
      scope === "all"
        ? "حذف كل شحنات رصيد العيادة (كل الفترات) وإرجاع الربح للأساس؟\nلا يمكن التراجع."
        : "حذف كل شحنات رصيد العيادة لهذا الشهر وإرجاع الربح إلى 1,080,000؟\nسيتم حذفها من موجز العمليات أيضاً."
    );
    if (!ok) return;

    setLoading(true);
    setMessage(null);

    try {
      const res = await fetch("/api/admin/clear-clinic-topups", {
        method: "POST",
        credentials: "include",
        headers: {
          "Content-Type": "application/json",
          ...authPortalHeaders(portal),
          "X-Clinic-Id": clinicId,
        },
        body: JSON.stringify({ clinic_id: clinicId, scope }),
      });

      const json = (await res.json().catch(() => ({}))) as {
        error?: string;
        message?: string;
        deletedTransactions?: number;
      };

      if (!res.ok) {
        setMessage(json.error ?? "تعذر الحذف");
        return;
      }

      clearPendingClinicTopUp(clinicId);
      clearAllPendingClinicTopUps();

      notifyClinicSync({
        topic: ["profit", "financial", "audit"],
        clinicId,
        source: "mutation",
        force: true,
      });

      setMessage(json.message ?? "تم الحذف");
      onCleared?.();
    } catch {
      setMessage("تعذر الاتصال بالسيرفر");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="space-y-2">
      <Button
        type="button"
        size={size}
        variant={variant === "ghost" ? "ghost" : variant === "danger" ? "danger" : "outline"}
        disabled={!clinicId || loading}
        onClick={() => void handleClear()}
      >
        {loading ? (
          <Loader2 className="h-4 w-4 animate-spin" />
        ) : (
          <Trash2 className="h-4 w-4" />
        )}
        حذف شحنات الرصيد
      </Button>
      {message && (
        <p
          className={
            message.includes("تعذر")
              ? "text-xs text-red-600"
              : "text-xs text-emerald-700"
          }
        >
          {message}
        </p>
      )}
    </div>
  );
}
