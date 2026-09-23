"use client";

import { useCallback, useEffect, useState } from "react";
import { Input } from "@/components/ui/Input";
import { Select } from "@/components/ui/Select";
import { HandCoins } from "lucide-react";
import { Alert } from "@/components/ui/Alert";
import { createClient } from "@/lib/supabase/client";
import { authPortalHeaders } from "@/lib/auth/api-portal";
import { notifyFinancialMutation } from "@/lib/sync/mutation-notify";
import { notifyClinicProfitRefresh } from "@/lib/services/clinic-profit";
import { doctorPaymentLabel } from "@/lib/services/doctor-payment";
import { formatCurrency, todayISO } from "@/lib/utils";
import type { Doctor } from "@/types";

interface DoctorSalaryPayoutPanelProps {
  clinicId: string | null;
  onPayoutRecorded?: () => void;
}

export function DoctorSalaryPayoutPanel({
  clinicId,
  onPayoutRecorded,
}: DoctorSalaryPayoutPanelProps) {
  const [salaryDoctors, setSalaryDoctors] = useState<Doctor[]>([]);
  const [doctorId, setDoctorId] = useState("");
  const [amount, setAmount] = useState("");
  const [payoutDate, setPayoutDate] = useState(todayISO());
  const [notes, setNotes] = useState("");
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState<{
    type: "success" | "error";
    text: string;
  } | null>(null);

  const loadSalaryDoctors = useCallback(async () => {
    if (!clinicId) {
      setSalaryDoctors([]);
      return;
    }
    const supabase = createClient();
    const { data } = await supabase
      .from("doctors")
      .select("id, full_name_ar, payment_type, salary_amount, percentage")
      .eq("clinic_id", clinicId)
      .eq("is_active", true)
      .eq("payment_type", "salary")
      .order("full_name_ar");

    const doctors = (data as Doctor[]) ?? [];
    setSalaryDoctors(doctors);
    if (doctors.length === 1) {
      setDoctorId(doctors[0].id);
    }
  }, [clinicId]);

  useEffect(() => {
    loadSalaryDoctors();
  }, [loadSalaryDoctors]);

  const selectedDoctor = salaryDoctors.find((d) => d.id === doctorId) ?? null;

  useEffect(() => {
    if (!selectedDoctor?.salary_amount) return;
    if (!amount) {
      setAmount(String(selectedDoctor.salary_amount));
    }
  }, [selectedDoctor, amount]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!clinicId) {
      setMessage({ type: "error", text: "لا توجد عيادة نشطة." });
      return;
    }
    setLoading(true);
    setMessage(null);

    const res = await fetch("/api/doctor-salary/payout", {
      method: "POST",
      credentials: "include",
      headers: {
        "Content-Type": "application/json",
        ...authPortalHeaders("accountant"),
      },
      body: JSON.stringify({
        doctor_id: doctorId,
        amount: parseFloat(amount),
        payout_date: payoutDate,
        notes: notes.trim() || null,
      }),
    });
    const json = await res.json().catch(() => ({}));

    setLoading(false);
    if (!res.ok) {
      setMessage({
        type: "error",
        text: (json as { error?: string }).error ?? "تعذر صرف الراتب",
      });
      return;
    }

    notifyClinicProfitRefresh(clinicId);
    notifyFinancialMutation({ clinicId, doctorId });
    setMessage({
      type: "success",
      text: "تم صرف الراتب — يُخصم من خزينة العيادة ويُسجَّل في «المسحوب» بكشف الطبيب",
    });
    setNotes("");
    onPayoutRecorded?.();
  }

  return (
    <div className="mc-panel">
      <div className="mc-panel-head">
        <div>
          <h3 className="mc-panel-title">
            <HandCoins />
            صرف راتب يدوي (اختياري)
          </h3>
          <p className="mt-1 text-sm text-slate-muted">
            للخصم والمكافأة استخدم البطاقة <strong className="text-slate-text">أعلاه</strong> ثم «تأكيد صرف
            الراتب». هذا النموذج لصرف مبلغ يدوي خارج القسيمة الشهرية فقط.
          </p>
        </div>
      </div>

      <div className="mc-panel-body">
      {salaryDoctors.length === 0 ? (
        <Alert variant="info">
          لا يوجد أطباء على نظام الراتب الثابت. عيّن الاتفاق المالي للطبيب إلى «راتب»
          من صفحة الطبيب.
        </Alert>
      ) : (
        <form onSubmit={handleSubmit} className="space-y-4">
          {message && (
            <Alert variant={message.type === "success" ? "success" : "error"}>
              {message.text}
            </Alert>
          )}

          <Select
            label="الطبيب (راتب ثابت)"
            name="doctor_id"
            value={doctorId}
            onChange={(e) => setDoctorId(e.target.value)}
            options={[
              { value: "", label: "— اختر الطبيب —" },
              ...salaryDoctors.map((d) => ({
                value: d.id,
                label: `${d.full_name_ar} (${doctorPaymentLabel(d)})`,
              })),
            ]}
            required
          />

          {selectedDoctor && (
            <p className="rounded-xl border border-slate-border bg-surface px-3.5 py-2.5 text-sm text-slate-text">
              الاتفاق المالي: {doctorPaymentLabel(selectedDoctor)}
            </p>
          )}

          <div className="grid grid-cols-2 gap-4">
            <Input
              label="مبلغ الراتب (د.ع)"
              type="number"
              min="0"
              step="1000"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              required
              dir="ltr"
              className="text-left"
            />
            <Input
              label="تاريخ الصرف"
              type="date"
              value={payoutDate}
              onChange={(e) => setPayoutDate(e.target.value)}
              required
              dir="ltr"
              className="text-left"
            />
          </div>

          <Input
            label="ملاحظات (اختياري)"
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            placeholder="مثال: راتب شهر حزيران"
          />

          {selectedDoctor && amount && (
            <p className="rounded-xl border border-debt-border bg-debt px-3.5 py-2.5 text-sm text-slate-text">
              سيُخصم{" "}
              <span className="font-bold tabular-nums text-debt-text">
                {formatCurrency(parseFloat(amount) || 0)}
              </span>{" "}
              من رصيد العيادة ويُسجَّل في كشف الطبيب (خصم واحد في اللوحة التنفيذية).
            </p>
          )}

          <div className="flex justify-end border-t border-slate-border pt-4">
            <button
              type="submit"
              className="mc-btn-navy px-6 py-2.5"
              disabled={loading || !clinicId || !doctorId}
            >
              {loading ? "جارٍ الصرف..." : "صرف الراتب"}
            </button>
          </div>
        </form>
      )}
      </div>
    </div>
  );
}
