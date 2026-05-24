"use client";

import { useCallback, useEffect, useState } from "react";
import { Card } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { Alert } from "@/components/ui/Alert";
import { createClient } from "@/lib/supabase/client";
import { getAuthProfile } from "@/lib/clinic-context";
import { formatCurrency } from "@/lib/utils";
import type { DoctorWithdrawal } from "@/types";

export default function WithdrawalsPage() {
  const [items, setItems] = useState<DoctorWithdrawal[]>([]);
  const [filter, setFilter] = useState<"pending" | "all">("pending");

  const load = useCallback(async () => {
    const supabase = createClient();
    let query = supabase
      .from("doctor_withdrawals")
      .select("*, doctor:doctors(full_name_ar)")
      .order("requested_at", { ascending: false });

    if (filter === "pending") {
      query = query.eq("status", "pending");
    }

    const { data } = await query;
    setItems((data as DoctorWithdrawal[]) || []);
  }, [filter]);

  useEffect(() => {
    load();
    const supabase = createClient();
    getAuthProfile(supabase).then(async (profile) => {
      if (!profile) return;
      await supabase
        .from("notifications")
        .update({ is_read: true })
        .eq("recipient_profile_id", profile.id)
        .eq("link_path", "/dashboard/withdrawals");
    });
  }, [load]);

  async function updateStatus(
    id: string,
    status: "approved" | "paid" | "rejected"
  ) {
    const supabase = createClient();
    const profile = await getAuthProfile(supabase);
    await supabase
      .from("doctor_withdrawals")
      .update({
        status,
        processed_at: new Date().toISOString(),
        processed_by: profile?.id,
      })
      .eq("id", id);
    load();
  }

  const statusLabel: Record<string, string> = {
    pending: "معلّق",
    approved: "موافق عليه",
    paid: "مدفوع",
    rejected: "مرفوض",
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h2 className="text-2xl font-bold text-slate-text">طلبات سحب الأطباء</h2>
          <p className="text-slate-muted">إشعار فوري عند كل طلب جديد</p>
        </div>
        <div className="flex gap-2">
          <Button
            size="sm"
            variant={filter === "pending" ? "primary" : "outline"}
            onClick={() => setFilter("pending")}
          >
            المعلّقة
          </Button>
          <Button
            size="sm"
            variant={filter === "all" ? "primary" : "outline"}
            onClick={() => setFilter("all")}
          >
            الكل
          </Button>
        </div>
      </div>

      {items.length === 0 ? (
        <Alert variant="info">لا توجد طلبات سحب {filter === "pending" ? "معلّقة" : ""}</Alert>
      ) : (
        <div className="space-y-3">
          {items.map((w) => (
            <Card key={w.id} className="flex flex-wrap items-center justify-between gap-4">
              <div>
                <p className="font-semibold text-slate-text">
                  {w.doctor?.full_name_ar || "طبيب"}
                </p>
                <p className="text-2xl font-bold text-primary">
                  {formatCurrency(w.amount)}
                </p>
                <p className="text-xs text-slate-muted">
                  {new Date(w.requested_at).toLocaleString("ar-EG")} —{" "}
                  {statusLabel[w.status]}
                </p>
              </div>
              {w.status === "pending" && (
                <div className="flex flex-wrap gap-2">
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
