"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { Input } from "@/components/ui/Input";
import { Select } from "@/components/ui/Select";
import { CurrencyInput } from "@/components/ui/CurrencyInput";
import { Scale } from "lucide-react";
import { Alert } from "@/components/ui/Alert";
import { createClient } from "@/lib/supabase/client";
import { authPortalHeaders } from "@/lib/auth/api-portal";
import { translateDbError } from "@/lib/db-errors";
import { confirmPayrollViaApi, unconfirmPayrollViaApi } from "@/lib/services/assistant-payroll-records";
import { doctorPaymentLabel } from "@/lib/services/doctor-payment";
import { computeStaffNetPay } from "@/lib/services/salary-entry-math";
import {
  isSalaryReasonRequired,
  salaryReasonFieldLabel,
  salaryReasonPlaceholder,
  validateSalaryEntryReason,
} from "@/lib/services/salary-entry-reason";
import { notifyClinicProfitRefresh, notifyPayrollConfirmRefresh } from "@/lib/services/clinic-profit";
import {
  currentMonthYear,
  formatCurrency,
  formatMonthYearAr,
  listRecentMonthYears,
  monthDateRange,
  parseFormattedNumber,
  todayISO,
} from "@/lib/utils";
import type { Doctor, SalaryEntry, SalarySlip } from "@/types";

const ENTRY_TYPES = [
  { value: "advance", label: "سلفة", short: "سلفة" },
  { value: "deduction", label: "خصم", short: "خصم" },
  { value: "absence", label: "خصم غياب", short: "غياب" },
  { value: "bonus", label: "مكافأة", short: "مكافأة" },
] as const;

function parsePositiveAmount(raw: string): number | null {
  const n = parseFloat(parseFormattedNumber(raw));
  if (!Number.isFinite(n) || n <= 0) return null;
  return n;
}

interface DoctorSalaryAdjustmentsPanelProps {
  clinicId: string | null;
  onUpdated?: () => void;
}

export function DoctorSalaryAdjustmentsPanel({
  clinicId,
  onUpdated,
}: DoctorSalaryAdjustmentsPanelProps) {
  const workMonthDefault = currentMonthYear();
  const [salaryDoctors, setSalaryDoctors] = useState<Doctor[]>([]);
  const [doctorId, setDoctorId] = useState("");
  const [workMonth, setWorkMonth] = useState(workMonthDefault);
  const [entryType, setEntryType] = useState<string>("deduction");
  const [amount, setAmount] = useState("");
  const [entryDate, setEntryDate] = useState(todayISO());
  const [notes, setNotes] = useState("");
  const [entries, setEntries] = useState<SalaryEntry[]>([]);
  const [slip, setSlip] = useState<SalarySlip | null>(null);
  const [saving, setSaving] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [feedback, setFeedback] = useState<{
    ok: boolean;
    text: string;
  } | null>(null);

  const { from: monthFrom, to: monthTo } = monthDateRange(workMonth);
  const monthOptions = useMemo(
    () =>
      listRecentMonthYears(12).map((m) => ({
        value: m,
        label: formatMonthYearAr(m),
      })),
    []
  );

  const selectedDoctor =
    salaryDoctors.find((d) => d.id === doctorId) ?? null;
  const baseSalary = Number(selectedDoctor?.salary_amount ?? 0);
  const { advances, deductions, bonuses, netPayout } = computeStaffNetPay(
    baseSalary,
    entries
  );
  const pendingAmount = parsePositiveAmount(amount) ?? 0;
  const netAfterPending =
    selectedDoctor && pendingAmount > 0
      ? computeStaffNetPay(baseSalary, [
          ...entries,
          {
            entry_type: entryType as SalaryEntry["entry_type"],
            amount: pendingAmount,
          },
        ]).netPayout
      : null;

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
    setDoctorId((prev) =>
      prev && doctors.some((d) => d.id === prev) ? prev : (doctors[0]?.id ?? "")
    );
  }, [clinicId]);

  const loadMonthData = useCallback(async () => {
    if (!clinicId || !doctorId) {
      setEntries([]);
      setSlip(null);
      return;
    }

    try {
      const params = new URLSearchParams({
        month_year: workMonth,
        doctor_id: doctorId,
      });
      const res = await fetch(`/api/payroll/salary-entries?${params}`, {
        credentials: "include",
        headers: authPortalHeaders("accountant"),
      });
      const json = (await res.json()) as { entries?: SalaryEntry[] };
      if (res.ok) {
        setEntries(json.entries ?? []);
      }
    } catch {
      setEntries([]);
    }

    const supabase = createClient();
    const { data: slipRow } = await supabase
      .from("salary_slips")
      .select("*")
      .eq("clinic_id", clinicId)
      .eq("doctor_id", doctorId)
      .eq("month_year", workMonth)
      .maybeSingle();
    setSlip((slipRow as SalarySlip) ?? null);
  }, [clinicId, doctorId, workMonth]);

  useEffect(() => {
    loadSalaryDoctors();
  }, [loadSalaryDoctors]);

  useEffect(() => {
    loadMonthData();
  }, [loadMonthData]);

  useEffect(() => {
    let next = workMonth === currentMonthYear() ? todayISO() : monthTo;
    if (next < monthFrom) next = monthFrom;
    if (next > monthTo) next = monthTo;
    setEntryDate(next);
  }, [workMonth, monthFrom, monthTo]);

  async function handleSaveEntry() {
    setFeedback(null);
    if (!clinicId || !doctorId || !selectedDoctor) {
      setFeedback({ ok: false, text: "اختر الطبيب أولاً" });
      return;
    }
    if (slip?.status === "paid") {
      setFeedback({
        ok: false,
        text: "راتب هذا الشهر مُصرف — لا يمكن إضافة حركات",
      });
      return;
    }
    const parsed = parsePositiveAmount(amount);
    if (parsed == null) {
      setFeedback({ ok: false, text: "أدخل مبلغاً أكبر من صفر" });
      return;
    }
    if (entryDate < monthFrom || entryDate > monthTo) {
      setFeedback({
        ok: false,
        text: `التاريخ يجب أن يكون داخل ${formatMonthYearAr(workMonth)}`,
      });
      return;
    }
    const reasonError = validateSalaryEntryReason(entryType, notes);
    if (reasonError) {
      setFeedback({ ok: false, text: reasonError });
      return;
    }

    setSaving(true);
    try {
      const res = await fetch("/api/payroll/salary-entries", {
        method: "POST",
        credentials: "include",
        headers: {
          ...authPortalHeaders("accountant"),
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          doctor_id: doctorId,
          month_year: workMonth,
          entry_type: entryType,
          amount: parsed,
          entry_date: entryDate,
          base_salary: baseSalary,
          notes_ar: notes.trim() || null,
        }),
      });
      const json = (await res.json()) as {
        error?: string;
        warning?: string;
        entries?: SalaryEntry[];
        slip?: SalarySlip;
        net_payout?: number;
      };
      if (!res.ok) {
        setFeedback({
          ok: false,
          text: translateDbError(json.error ?? "تعذر الحفظ"),
        });
        return;
      }

      if (json.entries) setEntries(json.entries);
      if (json.slip) setSlip(json.slip);
      else await loadMonthData();

      const label =
        ENTRY_TYPES.find((t) => t.value === entryType)?.label ?? "الحركة";
      setFeedback({
        ok: !json.warning,
        text: json.warning
          ? `تم تسجيل ${label} — ${json.warning}`
          : `تم تسجيل ${label}${
              json.net_payout != null
                ? ` — الصافي ${formatCurrency(json.net_payout)}`
                : ""
            }`,
      });
      setAmount("");
      setNotes("");
      onUpdated?.();
    } catch {
      setFeedback({ ok: false, text: "تعذر الاتصال بالسيرفر" });
    } finally {
      setSaving(false);
    }
  }

  async function handleConfirmPayout() {
    if (!slip || slip.status === "paid") return;
    setConfirming(true);
    setFeedback(null);
    const result = await confirmPayrollViaApi("slip", slip.id);
    setConfirming(false);
    if (!result.ok) {
      setFeedback({
        ok: false,
        text: translateDbError(result.error ?? "تعذر تأكيد الصرف"),
      });
      return;
    }
    notifyPayrollConfirmRefresh({
      clinicId: clinicId ?? undefined,
      doctorId: slip.doctor_id,
    });
    setFeedback({
      ok: true,
      text: "تم تأكيد صرف الراتب — خُصم من خزينة العيادة",
    });
    await loadMonthData();
    onUpdated?.();
  }

  async function handleUnconfirmPayout() {
    if (!slip || slip.status !== "paid") return;
    if (
      !window.confirm(
        "إلغاء تأكيد صرف الراتب؟\n\nسُتعاد القسيمة إلى مسودة ويُعاد احتساب الربح."
      )
    ) {
      return;
    }
    setConfirming(true);
    setFeedback(null);
    const result = await unconfirmPayrollViaApi("slip", slip.id);
    setConfirming(false);
    if (!result.ok) {
      setFeedback({
        ok: false,
        text: translateDbError(result.error ?? "تعذر إلغاء الصرف"),
      });
      return;
    }
    notifyClinicProfitRefresh(clinicId ?? undefined);
    setFeedback({
      ok: true,
      text: "تم إلغاء الصرف — يمكنك التعديل وتأكيد الصرف مجدداً",
    });
    await loadMonthData();
    onUpdated?.();
  }


  if (salaryDoctors.length === 0) {
    return (
      <div className="mc-panel">
        <div className="mc-panel-head">
          <h3 className="mc-panel-title">
            <Scale />
            خصم · مكافأة · سلفة — طبيب راتب ثابت
          </h3>
        </div>
        <div className="mc-panel-body">
          <Alert variant="info">
            لا يوجد أطباء على نظام الراتب الثابت. من صفحة الطبيب عيّن الاتفاق
            المالي إلى «راتب ثابت شهري».
          </Alert>
        </div>
      </div>
    );
  }

  return (
    <div className="mc-panel">
      <div className="mc-panel-head">
        <div>
          <h3 className="mc-panel-title">
            <Scale />
            خصم · مكافأة · سلفة — طبيب راتب ثابت
          </h3>
          <p className="mt-1 text-sm text-slate-muted">
            سجّل الحركات هنا ثم أكّد الصرف — أو من{" "}
            <Link
              href="/dashboard/salary"
              className="font-semibold text-primary-700 underline decoration-premium-400 underline-offset-4"
            >
              لوحة الرواتب
            </Link>
          </p>
        </div>
      </div>

      <div className="mc-panel-body space-y-5">
        {feedback && (
          <Alert variant={feedback.ok ? "success" : "error"}>{feedback.text}</Alert>
        )}

        <div className="grid gap-4 sm:grid-cols-2">
          <Select
            label="الطبيب"
            value={doctorId}
            onChange={(e) => setDoctorId(e.target.value)}
            options={salaryDoctors.map((d) => ({
              value: d.id,
              label: `${d.full_name_ar} (${doctorPaymentLabel(d)})`,
            }))}
          />
          <Select
            label="شهر الراتب"
            value={workMonth}
            onChange={(e) => setWorkMonth(e.target.value)}
            options={monthOptions}
          />
        </div>

        {selectedDoctor && (
          <p className="flex flex-wrap items-center gap-2 rounded-xl border border-slate-border bg-surface px-4 py-2.5 text-sm text-slate-muted">
            الراتب الأساسي: <strong className="tabular-nums text-slate-text">{formatCurrency(baseSalary)}</strong>
            {slip?.status === "paid" && (
              <span className="ms-auto rounded-full border border-success-border bg-success px-2.5 py-0.5 text-xs font-semibold text-success-text"> — مُصرف ✓</span>
            )}
          </p>
        )}

        <div className="grid gap-6 lg:grid-cols-5">
          <div className="space-y-4 lg:col-span-3">
            <div>
              <p className="mc-label mb-2">نوع الحركة</p>
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                {ENTRY_TYPES.map((t) => (
                  <button
                    key={t.value}
                    type="button"
                    disabled={slip?.status === "paid"}
                    onClick={() => setEntryType(t.value)}
                    className={`rounded-xl border px-3 py-2.5 text-sm font-semibold transition-all disabled:opacity-60 ${
                      entryType === t.value
                        ? "border-transparent bg-mc-navy text-white shadow-soft"
                        : "border-slate-border bg-surface-card text-slate-text shadow-card hover:border-premium-300"
                    }`}
                  >
                    {t.short}
                  </button>
                ))}
              </div>
            </div>

            <CurrencyInput
              label="المبلغ"
              value={amount}
              onChange={setAmount}
              placeholder="50,000"
              disabled={slip?.status === "paid"}
            />

            <div className="grid gap-4 sm:grid-cols-2">
              <Input
                label="تاريخ الحركة"
                type="date"
                value={entryDate}
                min={monthFrom}
                max={monthTo}
                onChange={(e) => setEntryDate(e.target.value)}
                disabled={slip?.status === "paid"}
                dir="ltr"
                className="text-left"
              />
              <Input
                label={salaryReasonFieldLabel(entryType)}
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                placeholder={salaryReasonPlaceholder(entryType)}
                required={isSalaryReasonRequired(entryType)}
                disabled={slip?.status === "paid"}
              />
            </div>

            {netAfterPending != null && (
              <p className="rounded-xl border border-warning-border bg-warning px-4 py-2.5 text-sm text-warning-text">
                صافي الراتب بعد هذه الحركة:{" "}
                <strong className="tabular-nums">{formatCurrency(netAfterPending)}</strong>
              </p>
            )}

            <button
              type="button"
              className="mc-btn-navy w-full py-3"
              disabled={saving || slip?.status === "paid" || !doctorId}
              onClick={() => void handleSaveEntry()}
            >
              {saving ? "جاري الحفظ..." : "حفظ الحركة"}
            </button>
          </div>

          <div className="space-y-4 lg:col-span-2">
            <div className="mc-hero rounded-2xl p-5 text-sm">
              <p className="relative mb-3 text-xs font-bold uppercase tracking-[0.12em] text-premium-300">
                ملخص {formatMonthYearAr(workMonth)}
              </p>
              <div className="relative space-y-1.5 text-white/80">
                <div className="flex justify-between">
                  <span>الراتب الأساسي</span>
                  <span className="tabular-nums text-white">{formatCurrency(baseSalary)}</span>
                </div>
                {advances > 0 && (
                  <div className="flex justify-between">
                    <span>− سلف</span>
                    <span className="tabular-nums text-red-300">{formatCurrency(advances)}</span>
                  </div>
                )}
                {deductions > 0 && (
                  <div className="flex justify-between">
                    <span>− خصومات/غياب</span>
                    <span className="tabular-nums text-red-300">{formatCurrency(deductions)}</span>
                  </div>
                )}
                {bonuses > 0 && (
                  <div className="flex justify-between">
                    <span>+ مكافآت</span>
                    <span className="tabular-nums text-emerald-300">{formatCurrency(bonuses)}</span>
                  </div>
                )}
                <hr className="my-3 border-white/15" />
                <div className="flex items-end justify-between gap-3">
                  <span className="font-semibold text-white">صافي الصرف</span>
                  <span className="mc-text-champagne text-2xl font-black tabular-nums">
                    {formatCurrency(slip?.net_payout ?? netPayout)}
                  </span>
                </div>
              </div>

              {slip?.status !== "paid" && slip && (
                <button
                  type="button"
                  className="mc-btn-pearl relative mt-5 w-full py-2.5"
                  disabled={confirming}
                  onClick={() => void handleConfirmPayout()}
                >
                  {confirming
                    ? "جاري التأكيد..."
                    : `تأكيد صرف الراتب (${formatCurrency(slip.net_payout)})`}
                </button>
              )}
              {slip?.status === "paid" && slip && (
                <button
                  type="button"
                  className="relative mt-5 inline-flex w-full items-center justify-center rounded-xl border border-white/20 bg-white/5 px-4 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-white/10 disabled:opacity-60"
                  disabled={confirming}
                  onClick={() => void handleUnconfirmPayout()}
                >
                  {confirming ? "جاري الإلغاء..." : "إلغاء تأكيد الصرف"}
                </button>
              )}
            </div>

            {entries.length > 0 && (
              <ul className="divide-y divide-slate-border overflow-hidden rounded-2xl border border-slate-border bg-surface-card text-sm shadow-card">
                {entries.map((e) => (
                  <li
                    key={e.id}
                    className="flex justify-between gap-3 px-4 py-2.5"
                  >
                    <span className="text-slate-text">
                      {ENTRY_TYPES.find((t) => t.value === e.entry_type)?.label ??
                        e.entry_type}{" "}
                      — <span className="tabular-nums text-slate-muted">{e.entry_date}</span>
                      {e.notes_ar ? (
                        <span className="block text-xs text-slate-muted">
                          {isSalaryReasonRequired(e.entry_type)
                            ? `السبب: ${e.notes_ar}`
                            : e.notes_ar}
                        </span>
                      ) : null}
                    </span>
                    <span
                      className={
                        e.entry_type === "bonus"
                          ? "font-bold tabular-nums text-success-text"
                          : "font-bold tabular-nums text-debt-text"
                      }
                    >
                      {e.entry_type === "bonus" ? "+" : "−"}
                      {formatCurrency(e.amount)}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
