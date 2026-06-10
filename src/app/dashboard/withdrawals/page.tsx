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
import { fetchWithdrawalsWithDoctors } from "@/lib/withdrawals/client";
import {
  resolveCanManageWithdrawals,
  updateWithdrawalStatusClient,
} from "@/lib/withdrawals/update-status-client";
import { useClinicSync } from "@/hooks/useClinicSync";
import { notifyFinancialMutation } from "@/lib/sync/mutation-notify";
import { formatCurrency } from "@/lib/utils";
import { CurrencyInput } from "@/components/ui/CurrencyInput";
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
  const [walletIsDebtor, setWalletIsDebtor] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [canManage, setCanManage] = useState(false);
  const [clinicId, setClinicId] = useState<string | null>(null);

  const load = useCallback(async () => {
    const supabase = createClient();
    const profile = await getAuthProfile(supabase);
    setCanManage(await resolveCanManageWithdrawals(supabase));

    const { items: rows, error } = await fetchWithdrawalsWithDoctors(supabase, {
      status: filter,
      clinicId: profile?.clinic_id,
    });

    if (error) {
      setMessage("تعذر تحميل طلبات السحب");
      setItems([]);
    } else {
      setItems(rows);
    }

    if (profile?.clinic_id) {
      setClinicId(profile.clinic_id);
      const docRes = await supabase
        .from("doctors")
        .select("*")
        .eq("is_active", true)
        .eq("clinic_id", profile.clinic_id);
      if (docRes.data) setDoctors(docRes.data as Doctor[]);
    }
  }, [filter]);

  useEffect(() => {
    load();
  }, [load]);

  useClinicSync({
    topics: ["financial"],
    clinicId,
    onRefresh: () => void load(),
    enabled: !!clinicId,
  });

  useEffect(() => {
    async function preview() {
      if (!cashDoctorId) {
        setWalletPreview(null);
        setWalletIsDebtor(false);
        return;
      }
      const supabase = createClient();
      const stats = await fetchDoctorWalletStats(supabase, cashDoctorId);
      setWalletPreview(stats.availableBalance);
      setWalletIsDebtor(stats.isDebtor);
    }
    preview();
  }, [cashDoctorId]);

  async function updateStatus(
    id: string,
    status: "approved" | "paid" | "rejected"
  ) {
    setMessage(null);
    const supabase = createClient();
    const profile = await getAuthProfile(supabase);

    if (!(await resolveCanManageWithdrawals(supabase))) {
      setMessage("غير مصرح — سجّل دخولك من واجهة المحاسب (محاسب أو مالك)");
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

    const row = items.find((i) => i.id === id);
    if (profile.clinic_id) {
      notifyFinancialMutation({
        clinicId: profile.clinic_id,
        doctorId: row?.doctor_id,
      });
    }

    setMessage("تم تحديث الطلب بنجاح");
    load();
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

    const res = await fetch("/api/withdrawals/record-cash", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "same-origin",
      body: JSON.stringify({
        doctor_id: cashDoctorId,
        amount,
        notes: cashNotes || undefined,
      }),
    });
    const json = await res.json();

    setLoading(false);

    if (!res.ok) {
      setMessage(json.error || "تعذر تسجيل السحب");
      return;
    }

    setCashAmount("");
    setCashNotes("");
    setShowCashForm(false);
    setMessage("تم تسجيل الدفع النقدي وخصمه من محفظة الطبيب");
    if (clinicId) {
      notifyFinancialMutation({ clinicId, doctorId: cashDoctorId });
    }
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
          <Button
            size="sm"
            variant="outline"
            onClick={() => setShowCashForm((v) => !v)}
            disabled={!canManage}
          >
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
            <CurrencyInput
              label="المبلغ"
              value={cashAmount}
              onChange={setCashAmount}
              placeholder="500,000"
              required
            />
            {walletPreview !== null && cashDoctorId && (
              <div
                className={`sm:col-span-2 rounded-lg p-3 text-sm ${
                  walletIsDebtor ? "bg-red-50" : "bg-primary/5"
                }`}
              >
                <span className="text-slate-muted">الرصيد المتاح: </span>
                <span
                  className={`font-bold tabular-nums ${
                    walletIsDebtor ? "text-red-600" : "text-primary"
                  }`}
                >
                  {walletIsDebtor ? "−" : ""}
                  {formatCurrency(Math.abs(walletPreview))}
                  {walletIsDebtor && (
                    <span className="mr-1 text-xs font-bold">(مدين)</span>
                  )}
                </span>
                {walletIsDebtor && (
                  <p className="mt-1 text-xs text-red-600">
                    لا يمكن سحب مبلغ — الطبيب مدين للعيادة
                  </p>
                )}
              </div>
            )}
            <Input
              label="ملاحظات"
              value={cashNotes}
              onChange={(e) => setCashNotes(e.target.value)}
              className="sm:col-span-2"
            />
            <div className="sm:col-span-2">
              <Button
                type="submit"
                disabled={loading || walletIsDebtor || (walletPreview ?? 0) <= 0}
              >
                {loading
                  ? "جاري التسجيل..."
                  : walletIsDebtor
                    ? "لا يمكن السحب — الطبيب مدين"
                    : "تسجيل دفع نقدي (يخصم فوراً)"}
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
              {canManage && w.status === "pending" && (
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
              {canManage && w.status === "approved" && (
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
