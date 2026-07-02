"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { Card } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { Alert } from "@/components/ui/Alert";
import { createClient } from "@/lib/supabase/client";
import { getAuthProfile } from "@/lib/clinic-context";
import { fetchWithdrawalsWithDoctors } from "@/lib/withdrawals/client";
import {
  resolveCanManageWithdrawals,
  updateWithdrawalStatusClient,
} from "@/lib/withdrawals/update-status-client";
import { cn, formatCurrency } from "@/lib/utils";
import type { DoctorWithdrawal } from "@/types";
import { Wallet } from "lucide-react";

export default function AdminWithdrawalsPage() {
  const [items, setItems] = useState<DoctorWithdrawal[]>([]);
  const [filter, setFilter] = useState<"pending" | "all">("pending");
  const [message, setMessage] = useState<string | null>(null);
  const [canManage, setCanManage] = useState(false);

  const load = useCallback(async () => {
    const supabase = createClient();
    const profile = await getAuthProfile(supabase);
    setCanManage(await resolveCanManageWithdrawals(supabase));
    const { items: rows } = await fetchWithdrawalsWithDoctors(supabase, {
      status: filter,
      clinicId: profile?.clinic_id,
    });
    setItems(rows);
  }, [filter]);

  useEffect(() => {
    load();
  }, [load]);

  async function updateStatus(
    id: string,
    status: "approved" | "paid" | "rejected"
  ) {
    setMessage(null);
    const supabase = createClient();
    const profile = await getAuthProfile(supabase);

    if (!(await resolveCanManageWithdrawals(supabase))) {
      setMessage("غير مصرح — للمحاسب أو المالك فقط");
      return;
    }

    if (!profile) {
      setMessage("يجب تسجيل الدخول");
      return;
    }

    const result = await updateWithdrawalStatusClient(
      supabase,
      id,
      status,
      profile.id
    );

    if (!result.ok) {
      setMessage(result.error);
      return;
    }

    setMessage("تم تحديث الطلب بنجاح");
    load();
  }

  const statusLabel: Record<string, string> = {
    pending: "معلّق",
    approved: "موافق",
    paid: "مدفوع",
    rejected: "مرفوض",
  };

  const statusStyle: Record<string, string> = {
    pending: "bg-warning text-warning-text border-warning-border",
    approved: "bg-primary-50 text-primary-700 border-primary-200",
    paid: "bg-success text-success-text border-success-border",
    rejected: "bg-debt text-debt-text border-debt-border",
  };

  return (
    <div className="space-y-4">
      <div>
        <h2 className="flex items-center gap-2 text-xl font-bold tracking-tight text-slate-text">
          <span className="mc-icon-badge-primary">
            <Wallet className="h-4.5 w-4.5" />
          </span>
          طلبات السحب النقدي
        </h2>
        <p className="mt-1 text-sm text-slate-muted">موافقة المالك من الجوال</p>
      </div>

      <div className="flex gap-2">
        <Button
          size="sm"
          variant={filter === "pending" ? "primary" : "outline"}
          className="flex-1"
          onClick={() => setFilter("pending")}
        >
          المعلّقة
        </Button>
        <Button
          size="sm"
          variant={filter === "all" ? "primary" : "outline"}
          className="flex-1"
          onClick={() => setFilter("all")}
        >
          الكل
        </Button>
      </div>

      {message && <Alert variant="info">{message}</Alert>}

      {items.length === 0 ? (
        <Alert variant="info">لا توجد طلبات {filter === "pending" ? "معلّقة" : ""}</Alert>
      ) : (
        <div className="space-y-3">
          {items.map((w) => (
            <Card key={w.id} hoverable className="p-4">
              <div className="flex items-start justify-between gap-2">
                <Link
                  href={`/admin/doctors/${w.doctor_id}`}
                  className="text-sm font-semibold text-primary hover:underline"
                >
                  {w.doctor?.full_name_ar ?? "طبيب"}
                </Link>
                <span
                  className={cn(
                    "rounded-full border px-2 py-0.5 text-[11px] font-bold",
                    statusStyle[w.status]
                  )}
                >
                  {statusLabel[w.status]}
                </span>
              </div>
              <p className="text-2xl font-bold tabular-nums text-slate-text">
                {formatCurrency(w.amount)}
              </p>
              <p className="text-xs text-slate-muted">
                {new Date(w.requested_at).toLocaleString("ar-EG")}
              </p>
              {canManage && w.status === "pending" && (
                <div className="mt-3 flex flex-wrap gap-2">
                  <Button size="sm" onClick={() => updateStatus(w.id, "approved")}>
                    موافقة
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => updateStatus(w.id, "paid")}
                  >
                    تم الدفع
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => updateStatus(w.id, "rejected")}
                  >
                    رفض
                  </Button>
                </div>
              )}
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
