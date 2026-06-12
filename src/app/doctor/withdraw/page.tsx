"use client";

import { useCallback, useEffect, useState } from "react";
import { Button } from "@/components/ui/Button";
import { Alert } from "@/components/ui/Alert";
import { createClient } from "@/lib/supabase/client";
import { getDoctorForCurrentUser } from "@/lib/clinic-context";
import { fetchDoctorWalletStats } from "@/lib/services/doctor-wallet";
import { useClinicSync } from "@/hooks/useClinicSync";
import { notifyFinancialMutation } from "@/lib/sync/mutation-notify";
import { useLanguage } from "@/contexts/LanguageContext";
import { CurrencyInput } from "@/components/ui/CurrencyInput";
import type { Doctor } from "@/types";

export default function DoctorWithdrawPage() {
  const { t, formatMoney, bi } = useLanguage();
  const [amount, setAmount] = useState("");
  const [sent, setSent] = useState(false);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [doctor, setDoctor] = useState<Doctor | null>(null);
  const [available, setAvailable] = useState(0);
  const [withdrawLimit, setWithdrawLimit] = useState(0);
  const [pending, setPending] = useState(0);
  const [isDebtor, setIsDebtor] = useState(false);

  const load = useCallback(async () => {
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
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  useClinicSync({
    topics: ["financial"],
    clinicId: doctor?.clinic_id,
    doctorId: doctor?.id,
    onRefresh: load,
    enabled: !!doctor?.id,
  });

  async function handleRequest() {
    setError("");
    const value = parseFloat(amount);
    if (!value || value <= 0) {
      setError(t("docEnterValidAmount"));
      return;
    }
    if (value > withdrawLimit) {
      setError(
        bi(
          `المبلغ يتجاوز الحد المتاح (${formatMoney(withdrawLimit)})`,
          `Amount exceeds available limit (${formatMoney(withdrawLimit)})`
        )
      );
      return;
    }
    if (!doctor) {
      setError(t("docDoctorAccountNotLinked"));
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
      setError(json.error || t("docWithdrawRequestFailed"));
      return;
    }

    notifyFinancialMutation({
      clinicId: doctor.clinic_id,
      doctorId: doctor.id,
    });
    setSent(true);
    void load();
  }

  return (
    <div className="space-y-4">
      <h2 className="text-lg font-bold text-slate-text">{t("docWithdrawCashTitle")}</h2>
      <p
        className={`text-sm font-semibold tabular-nums ${
          isDebtor ? "text-red-600" : "text-slate-muted"
        }`}
      >
        {isDebtor ? t("docYourBalanceDebt") : t("docWithdrawableLabel")}{" "}
        {formatMoney(Math.abs(available))}
      </p>
      {pending > 0 && (
        <p className="text-xs text-amber-700">
          {bi(
            `لديك طلبات معلّقة بقيمة ${formatMoney(pending)} — تُخصم عند الموافقة`,
            `You have pending requests totaling ${formatMoney(pending)} — deducted upon approval`
          )}
        </p>
      )}

      {sent ? (
        <Alert variant="success">{t("docWithdrawSentSuccess")}</Alert>
      ) : (
        <>
          {error && <Alert variant="error">{error}</Alert>}
          <CurrencyInput
            label={t("docRequestedAmountLabel")}
            value={amount}
            onChange={setAmount}
          />
          <Button
            className="w-full"
            onClick={() => void handleRequest()}
            disabled={loading || withdrawLimit <= 0}
          >
            {loading ? t("saving") : t("docSendRequest")}
          </Button>
        </>
      )}
    </div>
  );
}
