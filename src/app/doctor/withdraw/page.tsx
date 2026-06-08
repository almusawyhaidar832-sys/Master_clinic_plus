"use client";

import { useEffect, useState } from "react";
import { Button } from "@/components/ui/Button";
import { Alert } from "@/components/ui/Alert";
import { createClient } from "@/lib/supabase/client";
import { getDoctorForCurrentUser } from "@/lib/clinic-context";
import { fetchDoctorWalletStats } from "@/lib/services/doctor-wallet";
import { formatCurrency } from "@/lib/utils";
import { CurrencyInput } from "@/components/ui/CurrencyInput";
import type { Doctor } from "@/types";

export default function DoctorWithdrawPage() {
  const [amount, setAmount] = useState("");
  const [sent, setSent] = useState(false);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [doctor, setDoctor] = useState<Doctor | null>(null);
  const [available, setAvailable] = useState(0);
  const [withdrawLimit, setWithdrawLimit] = useState(0);
  const [pending, setPending] = useState(0);
  const [isDebtor, setIsDebtor] = useState(false);

  useEffect(() => {
    async function load() {
      const supabase = createClient();
      const doc = await getDoctorForCurrentUser(supabase);
      setDoctor(doc);
      if (doc) {
        const stats = await fetchDoctorWalletStats(supabase, doc.id);
        setAvailable(stats.availableBalance);
        setWithdrawLimit(stats.withdrawableLimit);
        setPending(stats.pendingAmount);
        setIsDebtor(stats.isDebtor);
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
    if (value > withdrawLimit) {
      setError(`المبلغ يتجاوز الحد المتاح (${formatCurrency(withdrawLimit)})`);
      return;
    }
    if (!doctor) {
      setError("حساب الطبيب غير مربوط");
      return;
    }

    setLoading(true);

    const res = await fetch("/api/withdrawals/request", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ amount: value }),
    });
    const json = await res.json();

    setLoading(false);

    if (!res.ok) {
      setError(json.error || "تعذر إرسال الطلب");
      return;
    }

    setSent(true);
  }

  return (
    <div className="space-y-4">
      <h2 className="text-lg font-bold text-slate-text">طلب سحب نقدي</h2>
      <p
        className={`text-sm font-semibold tabular-nums ${
          isDebtor ? "text-red-600" : "text-slate-muted"
        }`}
      >
        رصيدك: {isDebtor ? "−" : ""}
        {formatCurrency(Math.abs(available))}
        {isDebtor && <span className="mr-1 text-xs">(مدين)</span>}
      </p>
      {isDebtor && (
        <p className="text-xs text-red-600">
          لا يمكن طلب سحب — رصيدك سالب بسبب صرفيات أو التزامات على العيادة
        </p>
      )}
      {pending > 0 && (
        <p className="text-xs text-amber-600">
          لديك {formatCurrency(pending)} طلبات معلّقة — تُخصم من الرصيد عند الموافقة فقط
        </p>
      )}

      {sent ? (
        <Alert variant="success">
          تم إرسال الطلب — سيصل إشعار فوري لمحاسب العيادة
        </Alert>
      ) : (
        <>
          {error && <Alert variant="error">{error}</Alert>}
          <CurrencyInput
            label="المبلغ المطلوب"
            value={amount}
            onChange={setAmount}
            placeholder="500,000"
          />
          <Button
            className="w-full"
            onClick={handleRequest}
            disabled={loading || !doctor || isDebtor || withdrawLimit <= 0}
          >
            {loading ? "جاري الإرسال..." : "إرسال الطلب"}
          </Button>
        </>
      )}
    </div>
  );
}
