"use client";

import { useCallback, useEffect, useState } from "react";
import { Card } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { Select } from "@/components/ui/Select";
import { Alert } from "@/components/ui/Alert";
import { createClient } from "@/lib/supabase/client";
import { getAuthProfile } from "@/lib/clinic-context";
import { fetchDoctorWalletStats } from "@/lib/services/doctor-wallet";
import { formatCurrency } from "@/lib/utils";
import type { Doctor, DoctorWithdrawal } from "@/types";

export default function WithdrawalsPage() {
  const [items, setItems] = useState<DoctorWithdrawal[]>([]);
  const [doctors, setDoctors] = useState<Doctor[]>([]);
  const [filter, setFilter] = useState<"pending" | "all">("pending");
  const [showCashForm, setShowCashForm] = useState(false);
  const [cashDoctorId, setCashDoctorId] = useState("");
  const [cashAmount, setCashAmount] = useState("");
  const [cashNotes, setCashNotes] = useState("");
  const [walletPreview, setWalletPreview] = useState<number | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const load = useCallback(async () => {
    const supabase = createClient();
    let query = supabase
      .from("doctor_withdrawals")
      .select("*, doctor:doctors!doctor_id(full_name_ar)")
      .order("requested_at", { ascending: false });

    if (filter === "pending") {
      query = query.eq("status", "pending");
    }

    const [{ data }, docRes] = await Promise.all([
      query,
      supabase.from("doctors").select("*").eq("is_active", true),
    ]);

    setItems((data as DoctorWithdrawal[]) || []);
    if (docRes.data) setDoctors(docRes.data as Doctor[]);
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

  useEffect(() => {
    async function preview() {
      if (!cashDoctorId) {
        setWalletPreview(null);
        return;
      }
      const supabase = createClient();
      const stats = await fetchDoctorWalletStats(supabase, cashDoctorId);
      setWalletPreview(stats.availableBalance);
    }
    preview();
  }, [cashDoctorId]);

  async function updateStatus(
    id: string,
    status: "approved" | "paid" | "rejected"
  ) {
    const supabase = createClient();
    const profile = await getAuthProfile(supabase);
    const { error } = await supabase
      .from("doctor_withdrawals")
      .update({
        status,
        processed_at: new Date().toISOString(),
        processed_by: profile?.id,
      })
      .eq("id", id);

    if (error) setMessage("تعذر تحديث الطلب");
    else load();
  }

  async function recordCashWithdrawal(e: React.FormEvent) {
    e.preventDefault();
    setMessage(null);
    const amount = parseFloat(cashAmount);
    if (!cashDoctorId || amount <= 0) {
      setMessage("اختر الطبيب والمبلغ");
      return;
    }

    setLoading(true);
    const supabase = createClient();
    const profile = await getAuthProfile(supabase);
    const doctor = doctors.find((d) => d.id === cashDoctorId);

    const { error } = await supabase.from("doctor_withdrawals").insert({
      clinic_id: doctor?.clinic_id,
      doctor_id: cashDoctorId,
      amount,
      status: "paid",
      source: "accountant_cash",
      processed_at: new Date().toISOString(),
      processed_by: profile?.id,
      notes: cashNotes || "دفع نقدي — محاسب",
    });

    setLoading(false);

    if (error) {
      const msg = error.message.includes("withdrawal_exceeds_balance")
        ? "المبلغ أكبر من رصيد الطبيب المتاح"
        : "تعذر تسجيل السحب";
      setMessage(msg);
      return;
    }

    setCashAmount("");
    setCashNotes("");
    setShowCashForm(false);
    setMessage("تم تسجيل الدفع النقدي وخصمه من محفظة الطبيب");
    load();
  }

  const statusLabel: Record<string, string> = {
    pending: "معلّق",
    approved: "موافق عليه",
    paid: "مدفوع",
    rejected: "مرفوض",
  };

  const sourceLabel: Record<string, string> = {
    doctor_request: "طلب طبيب",
    accountant_cash: "دفع نقدي — محاسب",
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h2 className="text-2xl font-bold text-slate-text">سحوبات الأطباء</h2>
          <p className="text-slate-muted">
            موافقة على طلبات الطبيب أو تسجيل دفع نقدي مباشر
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
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
          <Button size="sm" variant="outline" onClick={() => setShowCashForm((v) => !v)}>
            دفع نقدي للطبيب
          </Button>
        </div>
      </div>

      {message && <Alert variant="info">{message}</Alert>}

      {showCashForm && (
        <Card>
          <form onSubmit={recordCashWithdrawal} className="grid gap-4 sm:grid-cols-2">
            <Select
              label="الطبيب"
              value={cashDoctorId}
              onChange={(e) => setCashDoctorId(e.target.value)}
              options={doctors.map((d) => ({
                value: d.id,
                label: d.full_name_ar,
              }))}
              placeholder="اختر الطبيب"
              required
            />
            <Input
              label="المبلغ"
              type="number"
              min="0"
              step="0.01"
              value={cashAmount}
              onChange={(e) => setCashAmount(e.target.value)}
              required
              dir="ltr"
              className="text-left"
            />
            {walletPreview !== null && cashDoctorId && (
              <div className="sm:col-span-2 rounded-lg bg-primary/5 p-3 text-sm">
                <span className="text-slate-muted">الرصيد المتاح: </span>
                <span className="font-bold text-primary">
                  {formatCurrency(walletPreview)}
                </span>
              </div>
            )}
            <Input
              label="ملاحظات"
              value={cashNotes}
              onChange={(e) => setCashNotes(e.target.value)}
              className="sm:col-span-2"
            />
            <div className="sm:col-span-2">
              <Button type="submit" disabled={loading}>
                {loading ? "جاري التسجيل..." : "تسجيل دفع نقدي (يخصم فوراً)"}
              </Button>
            </div>
          </form>
        </Card>
      )}

      {items.length === 0 ? (
        <Alert variant="info">
          لا توجد طلبات سحب {filter === "pending" ? "معلّقة" : ""}
        </Alert>
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
                  {w.source && ` · ${sourceLabel[w.source] ?? w.source}`}
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
              {w.status === "approved" && (
                <Button size="sm" onClick={() => updateStatus(w.id, "paid")}>
                  تأكيد الدفع
                </Button>
              )}
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
