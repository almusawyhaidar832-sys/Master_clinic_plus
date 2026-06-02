"use client";

import { useCallback, useEffect, useState } from "react";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { Select } from "@/components/ui/Select";
import { Card, CardHeader, CardTitle } from "@/components/ui/Card";
import { Alert } from "@/components/ui/Alert";
import { STAFF_SLOTS } from "@/lib/constants";
import {
  calculateSalaryNet,
  formatCurrency,
  currentMonthYear,
  todayISO,
} from "@/lib/utils";
import { createClient } from "@/lib/supabase/client";
import { useActiveClinicId } from "@/hooks/useActiveClinicId";
import type { StaffMember, SalaryEntry, SalarySlip } from "@/types";

// ── Inline salary editor row ──────────────────────────────────────────────
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
        <div className="flex items-center gap-1">
          <input
            type="number"
            value={val}
            onChange={(e) => setVal(e.target.value)}
            className="w-28 rounded-lg border border-primary px-2 py-1 text-sm text-left focus:outline-none"
            dir="ltr"
            autoFocus
          />
          <button
            onClick={() => { onSalaryChange(parseFloat(val)); setEditing(false); }}
            className="rounded-lg bg-primary px-2 py-1 text-xs font-bold text-white hover:bg-primary/90"
          >
            حفظ
          </button>
          <button
            onClick={() => { setVal(String(s.base_salary)); setEditing(false); }}
            className="rounded-lg border border-slate-border px-2 py-1 text-xs text-slate-muted hover:bg-surface"
          >
            إلغاء
          </button>
        </div>
      ) : (
        <button
          onClick={() => setEditing(true)}
          className="rounded-lg border border-slate-border px-3 py-1 text-sm font-semibold text-slate-700 hover:border-primary hover:text-primary"
          title="اضغط لتعديل الراتب"
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
  const { clinicId } = useActiveClinicId();
  const [staff, setStaff] = useState<StaffMember[]>([]);
  const [staffId, setStaffId] = useState("");
  const [entryType, setEntryType] = useState("advance");
  const [amount, setAmount] = useState("");
  const [entryDate, setEntryDate] = useState(todayISO());
  const [notes, setNotes] = useState("");
  const [message, setMessage] = useState<string | null>(null);
  const [entries, setEntries] = useState<SalaryEntry[]>([]);
  const [slips, setSlips] = useState<SalarySlip[]>([]);

  const [newStaffName, setNewStaffName] = useState("");
  const [newStaffJob, setNewStaffJob] = useState("");
  const [newStaffSalary, setNewStaffSalary] = useState("");

  const selectedStaff = staff.find((s) => s.id === staffId);
  const monthYear = currentMonthYear();

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
      .gte("entry_date", `${monthYear}-01`)
      .order("entry_date", { ascending: false });
    setEntries((data as SalaryEntry[]) || []);
  }, [staffId, monthYear]);

  const loadSlips = useCallback(async () => {
    const supabase = createClient();
    const { data } = await supabase
      .from("salary_slips")
      .select("*, staff:staff_members!staff_id(full_name_ar)")
      .eq("month_year", monthYear)
      .order("created_at", { ascending: false });
    setSlips((data as SalarySlip[]) || []);
  }, [monthYear]);

  useEffect(() => {
    loadStaff();
    loadSlips();
  }, [loadStaff, loadSlips]);

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

  async function handleEntry(e: React.FormEvent) {
    e.preventDefault();
    if (!clinicId) { setMessage("لا توجد عيادة نشطة"); return; }
    const supabase = createClient();
    const { error } = await supabase.from("salary_entries").insert({
      clinic_id: clinicId,
      staff_id: staffId,
      entry_type: entryType,
      amount: parseFloat(amount),
      entry_date: entryDate,
      notes_ar: notes || null,
    });
    setMessage(error ? "تعذر الحفظ" : "تم تسجيل الحركة");
    if (!error) {
      setAmount("");
      setNotes("");
      loadEntries();
    }
  }

  async function addStaff(e: React.FormEvent) {
    e.preventDefault();
    const activeCount = staff.filter((s) => s.is_active).length;
    if (activeCount >= STAFF_SLOTS) {
      setMessage(`الحد الأقصى ${STAFF_SLOTS} موظفين نشطين`);
      return;
    }
    if (!clinicId) { setMessage("لا توجد عيادة نشطة"); return; }
    const supabase = createClient();
    const nextSlot = activeCount + 1;
    const { error } = await supabase.from("staff_members").insert({
      clinic_id: clinicId,
      full_name_ar: newStaffName.trim(),
      job_title_ar: newStaffJob.trim(),
      base_salary: parseFloat(newStaffSalary),
      slot_number: nextSlot,
      is_active: true,
    });
    if (error) {
      setMessage(`تعذر إضافة الموظف: ${error.message}`);
    } else {
      setNewStaffName("");
      setNewStaffJob("");
      setNewStaffSalary("");
      await loadStaff();
      setMessage("✓ تم إضافة الموظف");
    }
  }

  async function generateSlip() {
    if (!selectedStaff || !clinicId) return;
    const supabase = createClient();
    const { error } = await supabase.from("salary_slips").upsert(
      {
        clinic_id: clinicId,
        staff_id: staffId,
        month_year: monthYear,
        base_salary: selectedStaff.base_salary,
        total_advances: advances,
        total_deductions: deductions,
        net_payout: netPreview,
        status: "draft",
      },
      { onConflict: "clinic_id,staff_id,month_year" }
    );
    setMessage(error ? "تعذر إنشاء القسيمة" : "تم إنشاء قسيمة الراتب");
    loadSlips();
  }

  async function markSlipPaid(slipId: string) {
    const supabase = createClient();
    await supabase
      .from("salary_slips")
      .update({ status: "paid", paid_at: new Date().toISOString() })
      .eq("id", slipId);
    setMessage("تم تأكيد الصرف — يُحدَّث ربح العيادة");
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

  async function updateSalary(staffMember: StaffMember, newSalary: number) {
    if (newSalary <= 0) return;
    const supabase = createClient();
    const { error } = await supabase
      .from("staff_members")
      .update({ base_salary: newSalary })
      .eq("id", staffMember.id);
    if (!error) {
      setMessage(`تم تعديل راتب ${staffMember.full_name_ar}`);
      loadStaff();
    }
  }

  // Only active staff appear in the operation dropdowns
  const staffOptions = staff
    .filter((s) => s.is_active)
    .map((s) => ({ value: s.id, label: `${s.full_name_ar} — ${s.job_title_ar}` }));

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-bold text-slate-text">رواتب الموظفين</h2>
        <p className="text-slate-muted">
          تتبع {STAFF_SLOTS} موظفين — سلف وخصومات بأي تاريخ — شهر {monthYear}
        </p>
      </div>

      {/* Active staff with toggle */}
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

      {staff.filter(s => s.is_active).length < STAFF_SLOTS && (
        <Card>
          <CardHeader>
            <CardTitle>إضافة موظف ({staff.filter(s => s.is_active).length}/{STAFF_SLOTS})</CardTitle>
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
            <Input
              label="الراتب الأساسي"
              type="number"
              value={newStaffSalary}
              onChange={(e) => setNewStaffSalary(e.target.value)}
              required
              dir="ltr"
              className="text-left"
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
            <CardTitle>تسجيل سلفة أو خصم</CardTitle>
          </CardHeader>
          <form onSubmit={handleEntry} className="space-y-4">
            {message && <Alert variant="success">{message}</Alert>}

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

            <Input
              label="المبلغ"
              type="number"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              required
              dir="ltr"
              className="text-left"
            />

            <Input
              label="التاريخ"
              type="date"
              value={entryDate}
              onChange={(e) => setEntryDate(e.target.value)}
              dir="ltr"
              className="text-left"
            />

            <Input
              label="ملاحظات"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
            />

            <Button type="submit">حفظ الحركة</Button>
          </form>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>قسيمة راتب — {monthYear}</CardTitle>
          </CardHeader>
          <div className="space-y-3 rounded-lg bg-surface p-4 text-sm">
            <div className="flex justify-between">
              <span>الراتب الأساسي</span>
              <span>{formatCurrency(selectedStaff?.base_salary ?? 0)}</span>
            </div>
            <div className="flex justify-between text-debt-text">
              <span>− السلف</span>
              <span>{formatCurrency(advances)}</span>
            </div>
            <div className="flex justify-between text-debt-text">
              <span>− الخصومات</span>
              <span>{formatCurrency(deductions)}</span>
            </div>
            <hr className="border-slate-border" />
            <div className="flex justify-between text-lg font-bold text-primary">
              <span>صافي الصرف</span>
              <span>{formatCurrency(netPreview)}</span>
            </div>
          </div>
          <div className="mt-4 flex gap-2">
            <Button onClick={generateSlip} disabled={!staffId}>
              إنشاء قسيمة
            </Button>
          </div>
        </Card>
      </div>

      {entries.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>حركات الشهر الحالي</CardTitle>
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

      {slips.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>قسائم الشهر</CardTitle>
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
                    {slip.status === "paid" ? "مدفوع" : "مسودة"}
                  </p>
                </div>
                {slip.status === "draft" && (
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
