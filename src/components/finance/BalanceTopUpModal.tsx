"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { X, Building2, Stethoscope, Wallet, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { Alert } from "@/components/ui/Alert";
import { authPortalHeaders } from "@/lib/auth/api-portal";
import type { AuthPortalId } from "@/lib/auth/portal-access";
import { createClient } from "@/lib/supabase/client";
import { useActiveClinicId } from "@/hooks/useActiveClinicId";
import { notifyBalanceTopUpRefresh } from "@/lib/services/clinic-profit";
import { registerPendingClinicTopUp } from "@/lib/services/clinic-profit-pending";
import { fetchClinicProfitStatsForPeriodViaApi } from "@/lib/services/clinic-stats-api";
import { defaultClinicProfitPeriod } from "@/lib/services/clinic-profit-loader";
import {
  buildExpectedProfitAfterTopUp,
  publishClinicProfitBroadcast,
} from "@/lib/services/clinic-profit-broadcast";
import type { ClinicProfitStats } from "@/lib/services/clinic-stats";
import {
  registerPendingDoctorTopUpDelta,
  registerPendingDoctorWallet,
} from "@/lib/services/doctor-wallet-pending";
import { useLanguage } from "@/contexts/LanguageContext";
import { cn, formatCurrency, todayISO } from "@/lib/utils";
import type { BalanceTopUpTarget, BalanceTopUpSuccessDetail } from "@/lib/services/balance-topup";

type DoctorOption = { id: string; name: string };

interface BalanceTopUpModalProps {
  open: boolean;
  onClose: () => void;
  onSuccess?: (detail: BalanceTopUpSuccessDetail) => void;
  portal?: AuthPortalId;
}

export function BalanceTopUpModal({
  open,
  onClose,
  onSuccess,
  portal = "accountant",
}: BalanceTopUpModalProps) {
  const { t } = useLanguage();
  const { clinicId } = useActiveClinicId();
  const [step, setStep] = useState<"choose" | "form">("choose");
  const [target, setTarget] = useState<BalanceTopUpTarget | null>(null);
  const [doctors, setDoctors] = useState<DoctorOption[]>([]);
  const [doctorId, setDoctorId] = useState("");
  const [amount, setAmount] = useState("");
  const [notes, setNotes] = useState("");
  const [transactionDate, setTransactionDate] = useState(todayISO());
  const [loadingDoctors, setLoadingDoctors] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const submitLockRef = useRef(false);

  const reset = useCallback(() => {
    setStep("choose");
    setTarget(null);
    setDoctorId("");
    setAmount("");
    setNotes("");
    setTransactionDate(todayISO());
    setError("");
  }, []);

  useEffect(() => {
    if (!open) {
      reset();
      return;
    }
  }, [open, reset]);

  useEffect(() => {
    if (!open || !clinicId) return;

    async function loadDoctors() {
      setLoadingDoctors(true);
      const supabase = createClient();
      const { data } = await supabase
        .from("doctors")
        .select("id, full_name_ar")
        .eq("clinic_id", clinicId)
        .eq("is_active", true)
        .order("full_name_ar");

      setDoctors(
        (data ?? []).map((d) => ({
          id: d.id as string,
          name: (d.full_name_ar as string) || t("doctor"),
        }))
      );
      setLoadingDoctors(false);
    }

    void loadDoctors();
  }, [open, clinicId, t]);

  function handleChoose(next: BalanceTopUpTarget) {
    setTarget(next);
    setStep("form");
    setError("");
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!target || submitLockRef.current) return;

    const parsed = Number(amount.replace(/,/g, ""));
    if (!Number.isFinite(parsed) || parsed <= 0) {
      setError(t("balanceTopUpInvalidAmount"));
      return;
    }

    if (target === "doctor" && !doctorId) {
      setError(t("balanceTopUpSelectDoctor"));
      return;
    }

    setSaving(true);
    setError("");
    submitLockRef.current = true;

    let preTopUpBaseline: ClinicProfitStats | null = null;
    if (target === "clinic" && clinicId) {
      const period = defaultClinicProfitPeriod();
      preTopUpBaseline = await fetchClinicProfitStatsForPeriodViaApi(
        period.from,
        period.to,
        portal,
        clinicId
      ).catch(() => null);
    }

    try {
      const res = await fetch("/api/balance-topup", {
        method: "POST",
        credentials: "include",
        headers: {
          "Content-Type": "application/json",
          ...authPortalHeaders(portal),
        },
        body: JSON.stringify({
          target,
          doctor_id: target === "doctor" ? doctorId : undefined,
          amount: parsed,
          notes: notes.trim() || undefined,
          transaction_date: transactionDate,
        }),
      });

      const json = (await res.json().catch(() => ({}))) as {
        error?: string;
        success?: boolean;
        amount?: number;
        target?: BalanceTopUpTarget;
        doctor_id?: string | null;
        doctor_wallet?: {
          availableBalance: number;
          withdrawableLimit: number;
        } | null;
      };

      if (!res.ok) {
        setError(json.error ?? t("balanceTopUpFailed"));
        return;
      }

      const toppedDoctorId =
        target === "doctor" ? (json.doctor_id ?? doctorId) : undefined;
      const toppedAmount = Number(json.amount ?? parsed);
      const doctorWallet = json.doctor_wallet ?? undefined;

      if (target === "clinic" && clinicId && toppedAmount > 0) {
        const period = defaultClinicProfitPeriod();
        registerPendingClinicTopUp(
          clinicId,
          toppedAmount,
          transactionDate,
          preTopUpBaseline ?? undefined
        );

        const expected = buildExpectedProfitAfterTopUp(
          preTopUpBaseline,
          toppedAmount
        );
        publishClinicProfitBroadcast({
          clinicId,
          periodFrom: period.from,
          periodTo: period.to,
          netProfit: expected.netProfit,
          balanceTopupsTotal: expected.balanceTopupsTotal,
        });
      }

      notifyBalanceTopUpRefresh({
        clinicId: clinicId ?? undefined,
        doctorId: toppedDoctorId,
        target,
      });
      if (target === "doctor" && toppedDoctorId) {
        if (doctorWallet) {
          registerPendingDoctorWallet(toppedDoctorId, doctorWallet);
        } else {
          registerPendingDoctorTopUpDelta(toppedDoctorId, toppedAmount);
        }
      }

      const successDetail: BalanceTopUpSuccessDetail = {
        target,
        amount: toppedAmount,
        transactionDate,
        doctorId: toppedDoctorId,
        doctorWallet,
      };

      onSuccess?.(successDetail);

      if (toppedAmount > 0) {
        if (target === "clinic") {
          window.alert(
            `تم شحن ${formatCurrency(toppedAmount)} لربح العيادة.\nيظهر في «صافي الربح الحقيقي» والكشف المالي لنفس تاريخ الشحن.`
          );
        } else {
          const doctorName =
            doctors.find((d) => d.id === toppedDoctorId)?.name ?? t("doctor");
          window.alert(
            `تم شحن ${formatCurrency(toppedAmount)} لرصيد ${doctorName}.\nيرتفع الرصيد فوراً في محفظة الطبيب والكشف المالي لنفس تاريخ الشحن.`
          );
        }
      }
      onClose();
    } catch {
      setError(t("errServerConnection"));
    } finally {
      setSaving(false);
      submitLockRef.current = false;
    }
  }

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-black/50 p-0 sm:items-center sm:p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="balance-topup-title"
    >
      <div className="max-h-[90dvh] w-full max-w-md overflow-y-auto rounded-t-2xl bg-surface-card shadow-elevated sm:rounded-2xl">
        <div className="sticky top-0 flex items-center justify-between border-b border-slate-border bg-surface-card px-4 py-3">
          <h2 id="balance-topup-title" className="text-lg font-bold text-slate-text">
            {t("balanceTopUpTitle")}
          </h2>
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg p-1.5 text-slate-muted hover:bg-surface"
            aria-label={t("cancel")}
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="p-4">
          {error && (
            <Alert variant="error" className="mb-4">
              {error}
            </Alert>
          )}

          {step === "choose" ? (
            <div className="grid gap-3">
              <p className="text-sm text-slate-muted">{t("balanceTopUpChooseHint")}</p>
              <button
                type="button"
                onClick={() => handleChoose("clinic")}
                className="flex items-center gap-3 rounded-xl border border-slate-border bg-surface p-4 text-right transition hover:border-primary hover:bg-primary/5"
              >
                <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-emerald-100 text-emerald-700">
                  <Building2 className="h-5 w-5" />
                </div>
                <div className="min-w-0 flex-1">
                  <p className="font-semibold text-slate-text">{t("balanceTopUpClinic")}</p>
                  <p className="text-xs text-slate-muted">{t("balanceTopUpClinicDesc")}</p>
                </div>
              </button>
              <button
                type="button"
                onClick={() => handleChoose("doctor")}
                className="flex items-center gap-3 rounded-xl border border-slate-border bg-surface p-4 text-right transition hover:border-primary hover:bg-primary/5"
              >
                <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-blue-100 text-blue-700">
                  <Stethoscope className="h-5 w-5" />
                </div>
                <div className="min-w-0 flex-1">
                  <p className="font-semibold text-slate-text">{t("balanceTopUpDoctor")}</p>
                  <p className="text-xs text-slate-muted">{t("balanceTopUpDoctorDesc")}</p>
                </div>
              </button>
            </div>
          ) : (
            <form onSubmit={handleSubmit} className="space-y-4">
              <div
                className={cn(
                  "rounded-xl border px-3 py-2 text-sm",
                  target === "clinic"
                    ? "border-emerald-200 bg-emerald-50 text-emerald-900"
                    : "border-blue-200 bg-blue-50 text-blue-900"
                )}
              >
                {target === "clinic" ? t("balanceTopUpClinic") : t("balanceTopUpDoctor")}
                <button
                  type="button"
                  onClick={() => setStep("choose")}
                  className="ms-2 text-xs underline opacity-80"
                >
                  {t("change")}
                </button>
              </div>

              {target === "doctor" && (
                <div>
                  <label className="mb-1 block text-sm font-medium text-slate-text">
                    {t("doctor")}
                  </label>
                  {loadingDoctors ? (
                    <p className="text-sm text-slate-muted">{t("loading")}</p>
                  ) : doctors.length === 0 ? (
                    <p className="text-sm text-slate-muted">{t("noDoctors")}</p>
                  ) : (
                    <select
                      value={doctorId}
                      onChange={(e) => setDoctorId(e.target.value)}
                      className="w-full rounded-xl border border-slate-border bg-surface px-3 py-2.5 text-sm"
                      required
                    >
                      <option value="">{t("balanceTopUpSelectDoctor")}</option>
                      {doctors.map((d) => (
                        <option key={d.id} value={d.id}>
                          {d.name}
                        </option>
                      ))}
                    </select>
                  )}
                </div>
              )}

              <div>
                <label className="mb-1 block text-sm font-medium text-slate-text">
                  {t("amount")}
                </label>
                <Input
                  type="number"
                  min={1}
                  step="any"
                  inputMode="decimal"
                  value={amount}
                  onChange={(e) => setAmount(e.target.value)}
                  placeholder="100000"
                  required
                  dir="ltr"
                  className="tabular-nums"
                />
                {amount && Number(amount) > 0 && (
                  <p className="mt-1 text-xs text-slate-muted">
                    {formatCurrency(Number(amount))}
                  </p>
                )}
              </div>

              <div>
                <label className="mb-1 block text-sm font-medium text-slate-text">
                  {t("date")}
                </label>
                <Input
                  type="date"
                  value={transactionDate}
                  onChange={(e) => setTransactionDate(e.target.value)}
                  required
                />
              </div>

              <div>
                <label className="mb-1 block text-sm font-medium text-slate-text">
                  {t("notesOptional")}
                </label>
                <Input
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  placeholder={t("balanceTopUpNotesPlaceholder")}
                />
              </div>

              <div className="flex gap-2 pt-2">
                <Button
                  type="button"
                  variant="outline"
                  className="flex-1"
                  onClick={onClose}
                  disabled={saving}
                >
                  {t("cancel")}
                </Button>
                <Button type="submit" className="flex-1" disabled={saving}>
                  {saving ? (
                    <>
                      <Loader2 className="h-4 w-4 animate-spin" />
                      {t("saving")}
                    </>
                  ) : (
                    <>
                      <Wallet className="h-4 w-4" />
                      {t("balanceTopUpConfirm")}
                    </>
                  )}
                </Button>
              </div>
            </form>
          )}
        </div>
      </div>
    </div>
  );
}

interface BalanceTopUpButtonProps {
  portal?: AuthPortalId;
  onSuccess?: (detail: BalanceTopUpSuccessDetail) => void;
  className?: string;
  variant?: "primary" | "outline" | "premium";
  size?: "sm" | "md" | "lg";
}

export function BalanceTopUpButton({
  portal = "accountant",
  onSuccess,
  className,
  variant = "outline",
  size = "sm",
}: BalanceTopUpButtonProps) {
  const { t } = useLanguage();
  const [open, setOpen] = useState(false);

  return (
    <>
      <Button
        type="button"
        variant={variant}
        size={size}
        className={className}
        onClick={() => setOpen(true)}
      >
        <Wallet className="h-4 w-4" />
        {t("balanceTopUpTitle")}
      </Button>
      <BalanceTopUpModal
        open={open}
        onClose={() => setOpen(false)}
        onSuccess={onSuccess}
        portal={portal}
      />
    </>
  );
}
