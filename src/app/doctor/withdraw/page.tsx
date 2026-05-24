"use client";

import { useEffect, useState } from "react";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { Alert } from "@/components/ui/Alert";
import { createClient } from "@/lib/supabase/client";
import { getDoctorForCurrentUser } from "@/lib/clinic-context";
import {
  fetchDoctorWithdrawableBalance,
  notifyAccountantsWithdrawal,
} from "@/lib/services/clinic-stats";
import { formatCurrency } from "@/lib/utils";
import type { Doctor } from "@/types";

export default function DoctorWithdrawPage() {
  const [amount, setAmount] = useState("");
  const [sent, setSent] = useState(false);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [doctor, setDoctor] = useState<Doctor | null>(null);
  const [available, setAvailable] = useState(0);

  useEffect(() => {
    async function load() {
      const supabase = createClient();
      const doc = await getDoctorForCurrentUser(supabase);
      setDoctor(doc);
      if (doc) {
        const bal = await fetchDoctorWithdrawableBalance(supabase, doc.id);
        setAvailable(bal);
      }
    }
    load();
  }, []);

  async function handleRequest() {
    setError("");
    const value = parseFloat(amount);
    if (!value || value <= 0) {
      setError("أدخل مبلغاً صحيحاً");
      return;
    }
    if (value > available) {
      setError(`المبلغ يتجاوز الرصيد المتاح (${formatCurrency(available)})`);
      return;
    }
    if (!doctor) {
      setError("حساب الطبيب غير مربوط");
      return;
    }

    setLoading(true);
    const supabase = createClient();

    const { error: insertError } = await supabase
      .from("doctor_withdrawals")
      .insert({
        doctor_id: doctor.id,
        clinic_id: doctor.clinic_id,
        amount: value,
      });

    if (insertError) {
      setError("تعذر إرسال الطلب");
      setLoading(false);
      return;
    }

    await notifyAccountantsWithdrawal(
      supabase,
      doctor.clinic_id,
      doctor.full_name_ar,
      value
    );

    setLoading(false);
    setSent(true);
  }

  return (
    <div className="space-y-4">
      <h2 className="text-lg font-bold text-slate-text">طلب سحب نقدي</h2>
      <p className="text-sm text-slate-muted">
        المتاح: {formatCurrency(available)}
      </p>

      {sent ? (
        <Alert variant="success">
          تم إرسال الطلب — سيصل إشعار فوري لمحاسب العيادة
        </Alert>
      ) : (
        <>
          {error && <Alert variant="error">{error}</Alert>}
          <Input
            label="المبلغ المطلوب"
            type="number"
            min="0"
            step="0.01"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            dir="ltr"
            className="text-left"
          />
          <Button
            className="w-full"
            onClick={handleRequest}
            disabled={loading || !doctor}
          >
            {loading ? "جاري الإرسال..." : "إرسال الطلب"}
          </Button>
        </>
      )}
    </div>
  );
}
