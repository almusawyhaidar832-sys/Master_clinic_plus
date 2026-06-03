"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { CurrencyInput } from "@/components/ui/CurrencyInput";
import { Select } from "@/components/ui/Select";
import { Card, CardHeader, CardTitle } from "@/components/ui/Card";
import { Alert } from "@/components/ui/Alert";
import {
  calculateSalaryNet,
  formatCurrency,
  currentMonthYear,
  todayISO,
  parseFormattedNumber,
  monthDateRange,
  listRecentMonthYears,
  formatMonthYearAr,
} from "@/lib/utils";
import { createClient } from "@/lib/supabase/client";
import { useActiveClinicId } from "@/hooks/useActiveClinicId";
import {
  fetchActivePayrollMonth,
  isMonthClosed,
  resetPayrollBoard,
} from "@/lib/services/salary-payroll";
import type { StaffMember, SalaryEntry, SalarySlip } from "@/types";

function parsePositiveAmount(raw: string): number | null {
  const n = parseFloat(parseFormattedNumber(raw));
  if (!Number.isFinite(n) || n <= 0) return null;
  return n;
}

function StaffRow({
  staff: s,
  onToggle,
  onSalaryChange,
}: {
  staff: StaffMember;
  onToggle: () => void;
  onSalaryChange: (v: number) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [val, setVal] = useState(String(s.base_salary));

  return (
    <li className="flex flex-wrap items-center gap-3 py-3 px-1">
      <div className="flex-1 min-w-0">
        <p className={`font-medium text-sm ${s.is_active ? "text-slate-text" : "text-slate-400 line-through"}`}>
          {s.full_name_ar}
        </p>
        <p className="text-xs text-slate-muted">{s.job_title_ar}</p>
      </div>

      {editing ? (
        <div className="flex flex-wrap items-end gap-2">
          <CurrencyInput value={val} onChange={setVal} className="w-36" />
          <button
            type="button"
            onClick={() => {
              const amount = parsePositiveAmount(val);
              if (amount == null) return;
              onSalaryChange(amount);
              setEditing(false);
            }}
            className="rounded-lg bg-primary px-2 py-1 text-xs font-bold text-white hover:bg-primary/90"
          >
            حفظ
          </button>
          <button
            type="button"
            onClick={() => {
              setVal(String(s.base_salary));
              setEditing(false);
            }}
            className="rounded-lg border border-slate-border px-2 py-1 text-xs text-slate-muted hover:bg-surface"
          >
            إلغاء
          </button>
        </div>
      ) : (
        <button
          type="button"
          onClick={() => setEditing(true)}
          className="rounded-lg border border-slate-border px-3 py-1 text-sm font-semibold text-slate-700 hover:border-primary hover:text-primary"
          title="الراتب الأساسي ثابت — يُستخدم كل شهر"
        >
          {formatCurrency(s.base_salary)}
        </button>
      )}

      <Button
        size="sm"
        variant="outline"
        onClick={onToggle}
        className={s.is_active
          ? "text-slate-muted hover:text-debt-text"
          : "border-emerald-300 text-emerald-700"}
      >
        {s.is_active ? "إيقاف" : "تفعيل"}
      </Button>
    </li>
  );
}

const entryTypes = [
  { value: "advance", label: "سلفة" },
  { value: "deduction", label: "خصم" },
  { value: "absence", label: "خصم غياب" },
];

export default function SalaryPage() {
  const { clinicId, source: clinicSource } = useActiveClinicId();
  const calendarMonth = currentMonthYear();
  const [workMonth, setWorkMonth] = useState(calendarMonth);
  const [activePayrollMonth, setActivePayrollMonth] = useState(calendarMonth);
  const [monthClosed, setMonthClosed] = useState(false);
  const [resetting, setResetting] = useState(false);

  const [staff, setStaff] = useState<StaffMember[]>([]);
  const [staffId, setStaffId] = useState("");
  const [entryType, setEntryType] = useState("advance");
  const [amount, setAmount] = useState("");
  const [entryDate, setEntryDate] = useState(todayISO());
  const [notes, setNotes] = useState("");
  const [message, setMessage] = useState<string | null>(null);
  const [messageOk, setMessageOk] = useState(true);
  const [entries, setEntries] = useState<SalaryEntry[]>([]);
  const [slips, setSlips] = useState<SalarySlip[]>([]);
  const [saving, setSaving] = useState(false);

  const [newStaffName, setNewStaffName] = useState("");
  const [newStaffJob, setNewStaffJob] = useState("");
  const [newStaffSalary, setNewStaffSalary] = useState("");

  const isCurrentMonth = workMonth === calendarMonth;
  const isActivePayrollMonth = workMonth === activePayrollMonth;
  const boardLocked = monthClosed || !isActivePayrollMonth;
  const { from: monthFrom, to: monthTo } = monthDateRange(workMonth);
  const monthOptions = useMemo(
    () =>
      listRecentMonthYears(18).map((m) => ({
        value: m,
        label: m === calendarMonth ? `${formatMonthYearAr(m)} (الحالي)` : formatMonthYearAr(m),
      })),
    [calendarMonth]
  );

  const selectedStaff = staff.find((s) => s.id === staffId);
  const staffSlipThisMonth = slips.find((s) => s.staff_id === staffId);
  const slipPaid = staffSlipThisMonth?.status === "paid";

  function showMessage(text: string, ok: boolean) {
    setMessage(text);
    setMessageOk(ok);
  }

  useEffect(() => {
    if (isCurrentMonth && isActivePayrollMonth) {
      setEntryDate(todayISO());
    } else {
      setEntryDate(monthTo);
    }
  }, [workMonth, isCurrentMonth, isActivePayrollMonth, monthTo]);

  useEffect(() => {
    if (!clinicId) return;
    const supabase = createClient();
    fetchActivePayrollMonth(supabase, clinicId).then((m) => {
      setActivePayrollMonth(m);
      setWorkMonth((prev) =>
        prev === calendarMonth || prev < m ? m : prev
      );
    });
  }, [clinicId, calendarMonth]);

  useEffect(() => {
    if (!clinicId) return;
    const supabase = createClient();
    isMonthClosed(supabase, clinicId, workMonth).then(setMonthClosed);
  }, [clinicId, workMonth]);

  const loadStaff = useCallback(async () => {
    const supabase = createClient();
    const { data } = await supabase
      .from("staff_members")
      .select("*")
      .order("slot_number");
    const list = (data as StaffMember[]) || [];
    setStaff(list);
    const activeList = list.filter((s) => s.is_active);
    if (activeList.length) {
      setStaffId((prev) => prev || activeList[0].id);
    }
  }, []);

  const loadEntries = useCallback(async () => {
    if (!staffId) return;
    const supabase = createClient();
    const { data } = await supabase
      .from("salary_entries")
      .select("*")
      .eq("staff_id", staffId)
      .gte("entry_date", monthFrom)
      .lte("entry_date", monthTo)
      .order("entry_date", { ascending: false });
    setEntries((data as SalaryEntry[]) || []);
  }, [staffId, monthFrom, monthTo]);

  const loadSlips = useCallback(async () => {
    const supabase = createClient();
    const { data } = await supabase
      .from("salary_slips")
      .select("*, staff:staff_members!staff_id(full_name_ar)")
      .eq("month_year", workMonth)
      .order("created_at", { ascending: false });
    setSlips((data as SalarySlip[]) || []);
  }, [workMonth]);

  useEffect(() => {
    loadStaff();
  }, [loadStaff]);

  useEffect(() => {
    loadSlips();
  }, [loadSlips]);

  useEffect(() => {
    loadEntries();
  }, [loadEntries]);

  const advances = entries
    .filter((e) => e.entry_type === "advance")
    .reduce((s, e) => s + e.amount, 0);
  const deductions = entries
    .filter((e) => e.entry_type !== "advance")
    .reduce((s, e) => s + e.amount, 0);
  const netPreview = selectedStaff
    ? calculateSalaryNet(selectedStaff.base_salary, advances, deductions)
    : 0;

  const totalPaidThisMonth = slips
    .filter((s) => s.status === "paid")
    .reduce((sum, s) => sum + Number(s.net_payout ?? 0), 0);

  async function handleEntry(e: React.FormEvent) {
    e.preventDefault();
    if (!clinicId) {
      showMessage("لا توجد عيادة نشطة — ربط الحساب بالعيادة مطلوب", false);
      return;
    }
    if (clinicSource === "fallback") {
      showMessage(
        "حسابك غير مربوط بعيادة في Supabase — نفّذ link_profile_to_first_clinic() ثم أعد تسجيل الدخول",
        false
      );
      return;
    }
    if (boardLocked) {
      showMessage("هذا الشهر مُغلق أو أرشيف — لا يمكن إضافة حركات", false);
      return;
    }
    if (slipPaid) {
      showMessage("قسيمة هذا الموظف مُسلَّمة — لا يمكن إضافة سلف/خصم لنفس الشهر", false);
      return;
    }
    const parsed = parsePositiveAmount(amount);
    if (parsed == null) {
      showMessage("أدخل مبلغاً أكبر من صفر", false);
      return;
    }
    if (!staffId) {
      showMessage("اختر الموظف", false);
      return;
    }
    if (entryDate < monthFrom || entryDate > monthTo) {
      showMessage(
        `تاريخ الحركة يجب أن يكون داخل ${formatMonthYearAr(workMonth)} (${monthFrom} — ${monthTo})`,
        false
      );
      return;
    }

    setSaving(true);
    const supabase = createClient();
    const { error } = await supabase.from("salary_entries").insert({
      clinic_id: clinicId,
      staff_id: staffId,
      entry_type: entryType,
      amount: parsed,
      entry_date: entryDate,
      notes_ar: notes || null,
    });
    setSaving(false);
    if (error) {
      showMessage(`تعذر الحفظ: ${error.message}`, false);
      return;
    }
    showMessage("تم تسجيل الحركة", true);
    setAmount("");
    setNotes("");
    loadEntries();
  }

  async function addStaff(e: React.FormEvent) {
    e.preventDefault();
    if (!clinicId) {
      showMessage("لا توجد عيادة نشطة", false);
      return;
    }
    const salary = parsePositiveAmount(newStaffSalary);
    if (salary == null) {
      showMessage("أدخل راتباً أساسياً صحيحاً", false);
      return;
    }

    const supabase = createClient();
    const nextSlot =
      staff.reduce((max, s) => Math.max(max, s.slot_number ?? 0), 0) + 1;
    const { error } = await supabase.from("staff_members").insert({
      clinic_id: clinicId,
      full_name_ar: newStaffName.trim(),
      job_title_ar: newStaffJob.trim(),
      base_salary: salary,
      slot_number: nextSlot,
      is_active: true,
    });
    if (error) {
      showMessage(`تعذر إضافة الموظف: ${error.message}`, false);
    } else {
      setNewStaffName("");
      setNewStaffJob("");
      setNewStaffSalary("");
      await loadStaff();
      showMessage("تم إضافة الموظف", true);
    }
  }

  async function generateSlip() {
    if (!selectedStaff || !clinicId) {
      showMessage("اختر موظفاً أولاً", false);
      return;
    }
    if (clinicSource === "fallback") {
      showMessage(
        "حسابك غير مربوط بعيادة — لا يمكن إنشاء القسيمة حتى ربط الملف الشخصي بالعيادة",
        false
      );
      return;
    }
    if (boardLocked) {
      showMessage("الشهر مُغلق — لا يمكن تعديل القسائم من الأرشيف", false);
      return;
    }
    if (slipPaid) {
      showMessage("قسيمة هذا الشهر مُسلَّمة مسبقاً", false);
      return;
    }

    setSaving(true);
    const supabase = createClient();
    const payload = {
      clinic_id: clinicId,
      staff_id: staffId,
      month_year: workMonth,
      base_salary: selectedStaff.base_salary,
      total_advances: advances,
      total_deductions: deductions,
      net_payout: netPreview,
      status: "draft" as const,
    };

    const { data: existing, error: fetchErr } = await supabase
      .from("salary_slips")
      .select("id, status")
      .eq("clinic_id", clinicId)
      .eq("staff_id", staffId)
      .eq("month_year", workMonth)
      .maybeSingle();

    if (fetchErr) {
      setSaving(false);
      showMessage(`تعذر إنشاء القسيمة: ${fetchErr.message}`, false);
      return;
    }

    if (existing?.status === "paid") {
      setSaving(false);
      showMessage("القسيمة مدفوعة — لا يمكن تعديلها", false);
      return;
    }

    const { error } = existing
      ? await supabase
          .from("salary_slips")
          .update({
            base_salary: payload.base_salary,
            total_advances: payload.total_advances,
            total_deductions: payload.total_deductions,
            net_payout: payload.net_payout,
            status: "draft",
          })
          .eq("id", existing.id)
      : await supabase.from("salary_slips").insert(payload);

    setSaving(false);
    if (error) {
      showMessage(`تعذر إنشاء القسيمة: ${error.message}`, false);
      return;
    }
    showMessage("تم إنشاء قسيمة الراتب", true);
    loadSlips();
  }

  async function markSlipPaid(slipId: string) {
    const supabase = createClient();
    const paidAt = new Date().toISOString();
    const { error } = await supabase
      .from("salary_slips")
      .update({ status: "paid", paid_at: paidAt })
      .eq("id", slipId);
    if (error) {
      showMessage(`تعذر تأكيد الصرف: ${error.message}`, false);
      return;
    }
    showMessage("تم تأكيد الصرف — يُخصم من ربح العيادة في لوحة التحكم", true);
    loadSlips();
  }

  async function toggleStaffActive(staffMember: StaffMember) {
    const supabase = createClient();
    await supabase
      .from("staff_members")
      .update({ is_active: !staffMember.is_active })
      .eq("id", staffMember.id);
    loadStaff();
  }

  async function handleResetBoard() {
    if (!clinicId) return;

    const unpaid = slips.filter((s) => s.status !== "paid");
    const msg =
      `تصفير لوحة رواتب ${formatMonthYearAr(workMonth)} والانتقال لشهر جديد؟\n\n` +
      `• القسائم المدفوعة تبقى محفوظة\n` +
      `• خصم الربح في لوحة التحكم لا يتغيّر (لا يرجع الربح)\n` +
      (unpaid.length
        ? `• سيتم حذف ${unpaid.length} مسودة قسيمة غير مُسلَّمة\n`
        : "") +
      `\nاضغط موافق للمتابعة.`;

    if (!window.confirm(msg)) return;

    setResetting(true);
    const supabase = createClient();
    const result = await resetPayrollBoard(supabase, clinicId, workMonth);
    setResetting(false);

    if (!result.ok) {
      showMessage(result.error ?? "تعذر التصفير", false);
      return;
    }

    if (result.nextMonth) {
      setActivePayrollMonth(result.nextMonth);
      setWorkMonth(result.nextMonth);
      setMonthClosed(false);
    }
    setAmount("");
    setNotes("");
    await loadSlips();
    await loadEntries();
    showMessage(
      `تم التصفير — أُغلق ${formatMonthYearAr(result.closedMonth ?? workMonth)}. ابدأ ${formatMonthYearAr(result.nextMonth ?? "")}`,
      true
    );
  }

  async function updateSalary(staffMember: StaffMember, newSalary: number) {
    if (newSalary <= 0) return;
    const supabase = createClient();
    const { error } = await supabase
      .from("staff_members")
      .update({ base_salary: newSalary })
      .eq("id", staffMember.id);
    if (error) {
      showMessage(`تعذر تعديل الراتب: ${error.message}`, false);
    } else {
      showMessage(`تم تعديل راتب ${staffMember.full_name_ar}`, true);
      loadStaff();
    }
  }

  const staffOptions = staff
    .filter((s) => s.is_active)
    .map((s) => ({ value: s.id, label: `${s.full_name_ar} — ${s.job_title_ar}` }));

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h2 className="text-2xl font-bold text-slate-text">رواتب الموظفين</h2>
          <p className="text-slate-muted">
            عدد موظفين غير محدود — حساب منفصل لكل شهر
          </p>
        </div>
        <div className="flex w-full flex-col gap-2 sm:w-auto sm:min-w-[200px]">
          <Select
            label="شهر العمل"
            value={workMonth}
            onChange={(e) => setWorkMonth(e.target.value)}
            options={monthOptions}
          />
          {isActivePayrollMonth && !monthClosed && (
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={resetting || !clinicId}
              onClick={handleResetBoard}
              className="border-amber-300 text-amber-800 hover:bg-amber-50"
            >
              {resetting ? "جاري التصفير..." : "تصفير اللوحة — شهر جديد"}
            </Button>
          )}
        </div>
      </div>

      <Alert variant="info">
        <p className="font-medium">كيف يعمل النظام شهرياً؟</p>
        <ul className="mt-2 list-inside list-disc space-y-1 text-sm">
          <li>
            <strong>الراتب الأساسي</strong> يبقى على ملف الموظف (لا يُصفَّر).
          </li>
          <li>
            أنهِ الشهر: سلّم الرواتب («تأكيد الصرف») ثم اضغط{" "}
            <strong>تصفير اللوحة</strong> لبدء شهر جديد فارغ.
          </li>
          <li>
            <strong>تصفير اللوحة</strong> لا يلغي خصم الرواتب من ربح العيادة في لوحة التحكم — المدفوع يبقى محسوباً.
          </li>
          <li>
            شهر مُغلق؟ اختره من القائمة للمراجعة فقط (أرشيف).
          </li>
        </ul>
      </Alert>

      {monthClosed && (
        <Alert variant="warning">
          {formatMonthYearAr(workMonth)} مُصفَّر ومُغلق — عرض أرشيف فقط. شهر العمل الحالي:{" "}
          <strong>{formatMonthYearAr(activePayrollMonth)}</strong>
        </Alert>
      )}

      {!monthClosed && !isActivePayrollMonth && (
        <Alert variant="warning">
          أنت تعرض أرشيف {formatMonthYearAr(workMonth)}. للتعديل انتقل إلى شهر العمل:{" "}
          {formatMonthYearAr(activePayrollMonth)}
        </Alert>
      )}

      {isCurrentMonth && slips.some((s) => s.status === "paid") && (
        <Alert variant="success">
          مُسلَّم هذا الشهر: {formatCurrency(totalPaidThisMonth)} — يظهر في لوحة التحكم التنفيذية.
        </Alert>
      )}

      {message && (
        <Alert variant={messageOk ? "success" : "error"}>{message}</Alert>
      )}

      {clinicSource === "fallback" && (
        <Alert variant="warning">
          حسابك غير مربوط بعيادة في قاعدة البيانات. نفّذ في Supabase SQL:{" "}
          <code dir="ltr" className="text-xs">
            SELECT public.link_profile_to_first_clinic();
          </code>
        </Alert>
      )}

      {staff.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>الموظفون ({staff.filter(s => s.is_active).length} نشط)</CardTitle>
          </CardHeader>
          <ul className="divide-y divide-slate-border/40">
            {staff.map((s) => (
              <StaffRow
                key={s.id}
                staff={s}
                onToggle={() => toggleStaffActive(s)}
                onSalaryChange={(val) => updateSalary(s, val)}
              />
            ))}
          </ul>
        </Card>
      )}

      {isActivePayrollMonth && !monthClosed && (
        <Card>
          <CardHeader>
            <CardTitle>
              إضافة موظف ({staff.filter((s) => s.is_active).length} نشط)
            </CardTitle>
          </CardHeader>
          <form onSubmit={addStaff} className="grid gap-3 sm:grid-cols-3">
            <Input
              label="الاسم"
              value={newStaffName}
              onChange={(e) => setNewStaffName(e.target.value)}
              required
            />
            <Input
              label="الوظيفة"
              value={newStaffJob}
              onChange={(e) => setNewStaffJob(e.target.value)}
              required
            />
            <CurrencyInput
              label="الراتب الأساسي"
              value={newStaffSalary}
              onChange={setNewStaffSalary}
              placeholder="600,000"
              required
            />
            <div className="sm:col-span-3">
              <Button type="submit" size="sm">
                إضافة
              </Button>
            </div>
          </form>
        </Card>
      )}

      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>
              تسجيل سلفة أو خصم — {formatMonthYearAr(workMonth)}
            </CardTitle>
          </CardHeader>
          <form onSubmit={handleEntry} className="space-y-4">
            <Select
              label="الموظف"
              value={staffId}
              onChange={(e) => setStaffId(e.target.value)}
              options={staffOptions}
              placeholder="اختر الموظف"
              required
            />

            <Select
              label="نوع الحركة"
              value={entryType}
              onChange={(e) => setEntryType(e.target.value)}
              options={entryTypes}
            />

            <CurrencyInput
              label="المبلغ"
              value={amount}
              onChange={setAmount}
              placeholder="500,000"
              required
            />

            <Input
              label="التاريخ (ضمن الشهر المختار)"
              type="date"
              value={entryDate}
              min={monthFrom}
              max={monthTo}
              onChange={(e) => setEntryDate(e.target.value)}
              dir="ltr"
              className="text-left"
            />

            <Input
              label="ملاحظات"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
            />

            <Button type="submit" disabled={saving || slipPaid || boardLocked}>
              {boardLocked
                ? "الشهر مُغلق"
                : slipPaid
                  ? "القسيمة مُسلَّمة"
                  : saving
                    ? "جاري الحفظ..."
                    : "حفظ الحركة"}
            </Button>
          </form>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>قسيمة راتب — {formatMonthYearAr(workMonth)}</CardTitle>
          </CardHeader>
          {staffSlipThisMonth?.status === "paid" && (
            <p className="mb-3 rounded-lg bg-emerald-50 px-3 py-2 text-sm text-emerald-800">
              ✓ قسيمة {selectedStaff?.full_name_ar} لهذا الشهر <strong>مدفوعة</strong> — لا حاجة لإعادة الصرف.
            </p>
          )}
          <div className="space-y-3 rounded-lg bg-surface p-4 text-sm">
            <div className="flex justify-between">
              <span>الراتب الأساسي</span>
              <span>{formatCurrency(selectedStaff?.base_salary ?? 0)}</span>
            </div>
            <div className="flex justify-between text-debt-text">
              <span>− سلف {formatMonthYearAr(workMonth)}</span>
              <span>{formatCurrency(advances)}</span>
            </div>
            <div className="flex justify-between text-debt-text">
              <span>− خصومات {formatMonthYearAr(workMonth)}</span>
              <span>{formatCurrency(deductions)}</span>
            </div>
            <hr className="border-slate-border" />
            <div className="flex justify-between text-lg font-bold text-primary">
              <span>صافي الصرف</span>
              <span>{formatCurrency(netPreview)}</span>
            </div>
          </div>
          <div className="mt-4 flex gap-2">
            <Button
              onClick={generateSlip}
              disabled={!staffId || saving || slipPaid || boardLocked}
            >
              {boardLocked
                ? "شهر مُغلق"
                : slipPaid
                  ? "مُسلَّمة"
                  : saving
                    ? "جاري الإنشاء..."
                    : "إنشاء / تحديث قسيمة"}
            </Button>
          </div>
        </Card>
      </div>

      {entries.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>حركات {formatMonthYearAr(workMonth)}</CardTitle>
          </CardHeader>
          <ul className="space-y-2 text-sm">
            {entries.map((e) => (
              <li
                key={e.id}
                className="flex justify-between border-b border-slate-border/40 py-2"
              >
                <span>
                  {entryTypes.find((t) => t.value === e.entry_type)?.label} —{" "}
                  {e.entry_date}
                </span>
                <span className="font-medium">{formatCurrency(e.amount)}</span>
              </li>
            ))}
          </ul>
        </Card>
      )}

      {entries.length === 0 && !slipPaid && (
        <p className="text-center text-sm text-slate-muted">
          لا حركات لـ {formatMonthYearAr(workMonth)} — ابدأ بتسجيل السلف أو أنشئ قسيمة بالراتب الأساسي فقط.
        </p>
      )}

      {slips.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>قسائم {formatMonthYearAr(workMonth)}</CardTitle>
          </CardHeader>
          <ul className="space-y-3">
            {slips.map((slip) => (
              <li
                key={slip.id}
                className="flex flex-wrap items-center justify-between gap-2 rounded-lg bg-surface p-3"
              >
                <div>
                  <p className="font-medium">
                    {(slip.staff as { full_name_ar: string })?.full_name_ar}
                  </p>
                  <p className="text-sm text-primary">
                    {formatCurrency(slip.net_payout)}
                  </p>
                  <p className="text-xs text-slate-muted">
                    {slip.status === "paid" ? "مدفوع ✓" : "مسودة — لم يُخصم من الربح بعد"}
                  </p>
                </div>
                {slip.status === "draft" && !boardLocked && (
                  <Button size="sm" onClick={() => markSlipPaid(slip.id)}>
                    تأكيد الصرف
                  </Button>
                )}
              </li>
            ))}
          </ul>
        </Card>
      )}
    </div>
  );
}
