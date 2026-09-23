"use client";

import { useCallback, useEffect, useState } from "react";
import { Input } from "@/components/ui/Input";
import { Select } from "@/components/ui/Select";
import { Alert } from "@/components/ui/Alert";
import { PageHeader } from "@/components/ui/PageHeader";
import { useLanguage } from "@/contexts/LanguageContext";
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
import { authPortalHeaders } from "@/lib/auth/api-portal";
import { cn, formatCurrency } from "@/lib/utils";
import { CurrencyInput } from "@/components/ui/CurrencyInput";
import type { Doctor, DoctorWithdrawal } from "@/types";
import {
  ArrowDownToLine,
  Banknote,
  Clock,
  ListFilter,
  Stethoscope,
  Wallet,
} from "lucide-react";
export default function WithdrawalsPage() {
  const { bi } = useLanguage();
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
      headers: {
        "Content-Type": "application/json",
        ...authPortalHeaders("accountant"),
      },
      credentials: "include",
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


  const statusBadge: Record<string, string> = {
    pending: "border-warning-border bg-warning text-warning-text",
    approved: "border-primary-200 bg-primary-50 text-primary-700",
    paid: "border-success-border bg-success text-success-text",
    rejected: "border-debt-border bg-debt text-debt-text",
  };

  return (
    <div className="space-y-6">
      <PageHeader
        title="سحوبات الأطباء"
        eyebrow={bi("المالية", "Finance")}
        icon={ArrowDownToLine}
        subtitle="موافقة على طلبات الطبيب أو تسجيل دفع نقدي مباشر"
        className="mb-0"
        actions={
          <button
            type="button"
            className="mc-btn-navy py-2.5"
            onClick={() => setShowCashForm((v) => !v)}
            disabled={!canManage}
          >
            <Banknote className="h-4 w-4 text-premium-300" />
            دفع نقدي للطبيب
          </button>
        }
      />

      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            className={cn("mc-chip", filter === "pending" && "mc-chip--active")}
            onClick={() => setFilter("pending")}
          >
            <Clock className="h-3.5 w-3.5" />
            المعلّقة
          </button>
          <button
            type="button"
            className={cn("mc-chip", filter === "all" && "mc-chip--active")}
            onClick={() => setFilter("all")}
          >
            <ListFilter className="h-3.5 w-3.5" />
            الكل
          </button>
        </div>
      </div>

      {message && <Alert variant="info">{message}</Alert>}

      {showCashForm && (
        <div className="mc-panel">
          <div className="mc-panel-head">
            <h3 className="mc-panel-title">
              <Banknote />
              دفع نقدي للطبيب
            </h3>
          </div>
          <form onSubmit={recordCashWithdrawal} className="mc-panel-body grid gap-4 sm:grid-cols-2">
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
                className={cn(
                  "flex items-center gap-3 rounded-2xl border px-4 py-3 text-sm sm:col-span-2",
                  walletIsDebtor
                    ? "border-debt-border bg-debt"
                    : "border-slate-border bg-surface"
                )}
              >
                <span
                  className={cn(
                    "mc-kpi__icon h-10 w-10",
                    walletIsDebtor ? "mc-tone-danger" : "mc-tone-navy"
                  )}
                >
                  <Wallet className="h-5 w-5" />
                </span>
                <div>
                  <span className="text-slate-muted">الرصيد المتاح: </span>
                  <span
                    className={cn(
                      "text-lg font-black tabular-nums",
                      walletIsDebtor ? "text-debt-text" : "text-slate-text"
                    )}
                  >
                    {walletIsDebtor ? "−" : ""}
                    {formatCurrency(Math.abs(walletPreview))}
                    {walletIsDebtor && (
                      <span className="ms-1 text-xs font-bold">(مدين)</span>
                    )}
                  </span>
                  {walletIsDebtor && (
                    <p className="mt-0.5 text-xs text-debt-text">
                      لا يمكن سحب مبلغ — الطبيب مدين للعيادة
                    </p>
                  )}
                </div>
              </div>
            )}
            <Input
              label="ملاحظات"
              value={cashNotes}
              onChange={(e) => setCashNotes(e.target.value)}
              className="sm:col-span-2"
            />
            <div className="flex justify-end border-t border-slate-border pt-4 sm:col-span-2">
              <button
                type="submit"
                className="mc-btn-navy px-6 py-2.5"
                disabled={loading || walletIsDebtor || (walletPreview ?? 0) <= 0}
              >
                {loading
                  ? "جاري التسجيل..."
                  : walletIsDebtor
                    ? "لا يمكن السحب — الطبيب مدين"
                    : "تسجيل دفع نقدي (يخصم فوراً)"}
              </button>
            </div>
          </form>
        </div>
      )}

      {items.length === 0 ? (
        <div className="mc-panel flex flex-col items-center gap-3 px-6 py-12 text-center">
          <span className="mc-icon-tile h-12 w-12">
            <ArrowDownToLine className="h-5 w-5" />
          </span>
          <p className="text-sm text-slate-muted">
            لا توجد طلبات سحب {filter === "pending" ? "معلّقة" : ""}
          </p>
        </div>
      ) : (
        <div className="space-y-3">
          {items.map((w) => (
            <div key={w.id} className="mc-list-row flex-wrap justify-between">
              <div className="flex min-w-0 items-center gap-4">
                <span className="mc-icon-tile h-12 w-12 rounded-xl">
                  <Stethoscope className="h-5 w-5" strokeWidth={1.8} />
                </span>
                <div className="min-w-0">
                  <p className="font-bold text-slate-text">
                    {w.doctor?.full_name_ar || "طبيب"}
                  </p>
                  <p className="text-2xl font-black tracking-tight tabular-nums text-slate-text">
                    {formatCurrency(w.amount)}
                  </p>
                  <p className="mt-1 flex flex-wrap items-center gap-1.5 text-xs text-slate-muted">
                    <span className="tabular-nums">
                      {new Date(w.requested_at).toLocaleString("ar-EG")}
                    </span>
                    <span
                      className={cn(
                        "inline-flex rounded-full border px-2 py-0.5 text-[11px] font-semibold",
                        statusBadge[w.status] ?? "border-slate-border bg-surface text-slate-muted"
                      )}
                    >
                      {statusLabel[w.status]}
                    </span>
                    {w.source && (
                      <span className="inline-flex rounded-full border border-slate-border bg-surface px-2 py-0.5 text-[11px] font-medium">
                        {sourceLabel[w.source] ?? w.source}
                      </span>
                    )}
                  </p>
                </div>
              </div>
              {canManage && w.status === "pending" && (
                <div className="flex flex-wrap gap-2">
                  <button
                    type="button"
                    className="mc-btn-navy px-3.5 py-1.5"
                    onClick={() => updateStatus(w.id, "approved")}
                  >
                    موافقة
                  </button>
                  <button
                    type="button"
                    className="mc-btn-soft px-3.5 py-1.5"
                    onClick={() => updateStatus(w.id, "paid")}
                  >
                    تم الدفع
                  </button>
                  <button
                    type="button"
                    className="inline-flex items-center justify-center rounded-xl px-3.5 py-1.5 text-sm font-semibold text-debt-text transition-colors hover:bg-debt"
                    onClick={() => updateStatus(w.id, "rejected")}
                  >
                    رفض
                  </button>
                </div>
              )}
              {canManage && w.status === "approved" && (
                <button
                  type="button"
                  className="mc-btn-navy px-3.5 py-1.5"
                  onClick={() => updateStatus(w.id, "paid")}
                >
                  تأكيد الدفع
                </button>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
