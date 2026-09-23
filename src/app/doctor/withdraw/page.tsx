"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Alert } from "@/components/ui/Alert";
import { PageHeader } from "@/components/ui/PageHeader";
import {
  ArrowDownToLine,
  Banknote,
  CheckCircle2,
  Hourglass,
  Loader2,
  Send,
  Wallet,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { createClient } from "@/lib/supabase/client";
import { getDoctorForCurrentUser } from "@/lib/clinic-context";
import {
  fetchDoctorWalletStats,
  type DoctorWalletStats,
} from "@/lib/services/doctor-wallet";
import { authPortalHeaders } from "@/lib/auth/api-portal";
import { reconcilePendingDoctorWallet } from "@/lib/services/doctor-wallet-pending";
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
  const loadGenerationRef = useRef(0);

  const load = useCallback(async () => {
    const loadGeneration = ++loadGenerationRef.current;
    const supabase = createClient();
    const doc = await getDoctorForCurrentUser(supabase);
    setDoctor(doc);
    if (!doc) return;

    let stats: DoctorWalletStats | null = null;
    try {
      const res = await fetch(`/api/doctor/wallet-stats?_t=${Date.now()}`, {
        credentials: "include",
        headers: authPortalHeaders("doctor"),
        cache: "no-store",
      });
      if (res.ok) {
        stats = (await res.json()) as DoctorWalletStats;
      }
    } catch {
      /* fallback */
    }
    if (!stats) {
      stats = await fetchDoctorWalletStats(supabase, doc.id);
    }
    stats = reconcilePendingDoctorWallet(doc.id, stats);

    if (loadGeneration !== loadGenerationRef.current) return;

    setAvailable(stats.availableBalance);
    setWithdrawLimit(stats.withdrawableLimit);
    setPending(stats.pendingAmount);
    setIsDebtor(stats.isDebtor);
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
    <div className="space-y-5 animate-fade-in">
      <PageHeader
        title={t("docWithdrawCashTitle")}
        eyebrow={bi("بوابة الطبيب", "Doctor portal")}
        icon={ArrowDownToLine}
        backHref="/doctor/wallet"
        backLabel={t("wallet")}
        className="!mb-0"
      />

      <section
        className={cn(
          "mc-hero rounded-[28px] p-5",
          isDebtor && "ring-2 ring-inset ring-red-400/40"
        )}
      >
        <div className="pointer-events-none absolute -end-14 -top-16 h-44 w-44 rounded-full border border-white/[0.07]" />
        {isDebtor && (
          <div className="pointer-events-none absolute inset-0 bg-gradient-to-br from-red-500/25 via-transparent to-transparent" />
        )}
        <div className="relative flex items-center gap-3">
          <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl border border-white/15 bg-white/[0.08] text-[#dcc29a] backdrop-blur">
            <Wallet className="h-5 w-5" />
          </span>
          <div className="min-w-0">
            <p className="text-xs font-medium text-white/65">
              {isDebtor ? t("docYourBalanceDebt") : t("docWithdrawableLabel")}
            </p>
            <p
              className={cn(
                "mt-1 text-[28px] font-black leading-none tracking-tight tabular-nums",
                isDebtor ? "text-red-200" : "mc-text-champagne"
              )}
            >
              {formatMoney(Math.abs(available))}
            </p>
          </div>
        </div>
      </section>

      {pending > 0 && (
        <p className="flex items-start gap-2.5 rounded-2xl border border-warning-border bg-warning px-4 py-3 text-xs leading-relaxed text-warning-text">
          <Hourglass className="mt-0.5 h-4 w-4 shrink-0" />
          {bi(
            `لديك طلبات معلّقة بقيمة ${formatMoney(pending)} — تُخصم عند الموافقة`,
            `You have pending requests totaling ${formatMoney(pending)} — deducted upon approval`
          )}
        </p>
      )}

      {sent ? (
        <div className="mc-panel">
          <div className="flex flex-col items-center gap-3 px-5 py-8 text-center">
            <span className="mc-kpi__icon mc-tone-success h-14 w-14 rounded-2xl">
              <CheckCircle2 className="h-7 w-7" />
            </span>
            <Alert variant="success" className="w-full text-start">
              {t("docWithdrawSentSuccess")}
            </Alert>
          </div>
        </div>
      ) : (
        <section className="mc-panel">
          <div className="mc-panel-head !px-4">
            <h2 className="mc-panel-title no-accent">
              <Banknote />
              {t("docRequestedAmountLabel")}
            </h2>
          </div>
          <div className="space-y-4 p-4 sm:p-5">
            {error && <Alert variant="error">{error}</Alert>}
            <CurrencyInput
              value={amount}
              onChange={setAmount}
              size="large"
              placeholder="0"
              className="h-14 rounded-2xl border border-slate-border bg-surface-card text-center text-2xl font-black tracking-tight shadow-card focus:border-primary-500 focus:ring-4 focus:ring-primary-500/10"
            />
            <button
              type="button"
              className="mc-btn-navy min-h-[52px] w-full rounded-2xl text-base"
              onClick={() => void handleRequest()}
              disabled={loading || withdrawLimit <= 0}
            >
              {loading ? (
                <Loader2 className="h-5 w-5 animate-spin" />
              ) : (
                <Send className="h-4 w-4 text-premium-300" />
              )}
              {loading ? t("saving") : t("docSendRequest")}
            </button>
          </div>
        </section>
      )}
    </div>
  );
}
