"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { CurrencyInput } from "@/components/ui/CurrencyInput";
import { Select } from "@/components/ui/Select";
import { Card, CardHeader, CardTitle } from "@/components/ui/Card";
import { Alert } from "@/components/ui/Alert";
import { translateDbError } from "@/lib/db-errors";
import {
  calculateSalaryNet,
  formatCurrency,
  currentMonthYear,
  todayISO,
  parseFormattedNumber,
  monthDateRange,
  listRecentMonthYears,
  formatMonthYearAr,
  cn,
} from "@/lib/utils";
import { createClient } from "@/lib/supabase/client";
import { authPortalHeaders } from "@/lib/auth/api-portal";
import { useActiveClinicId } from "@/hooks/useActiveClinicId";
import {
  fetchActivePayrollMonth,
  isMonthClosed,
  resetPayrollBoard,
} from "@/lib/services/salary-payroll";
import type { PayrollRecord, StaffMember, SalaryEntry, SalarySlip } from "@/types";
import {
  countActiveAssistantsForPayroll,
  fetchPayrollMonthViaApi,
  generateMonthlyPayrollViaApi,
  confirmPayrollViaApi,
  unconfirmPayrollViaApi,
} from "@/lib/services/assistant-payroll-records";
import { breakdownAssistantSalary } from "@/lib/services/assistant-payroll";
import { notifyClinicProfitRefresh } from "@/lib/services/clinic-profit";
import { notifyFinancialMutation } from "@/lib/sync/mutation-notify";
import {
  fetchActivePayrollPersonsViaApi,
  parsePayrollPersonKey,
  payrollCategoryLabel,
  payrollPersonKey,
  type PayrollEmployeeCategory,
  type PayrollPerson,
} from "@/lib/services/payroll-persons";
import { EmployeePayrollProfileCard } from "@/components/payroll/EmployeePayrollProfileCard";
import { EditEmployeeSalaryModal } from "@/components/payroll/EditEmployeeSalaryModal";
import { EditSalaryEntryModal } from "@/components/payroll/EditSalaryEntryModal";
import { DeactivateEmployeeDialog } from "@/components/payroll/DeactivateEmployeeDialog";
import {
  isSalaryReasonRequired,
  salaryReasonFieldLabel,
  salaryReasonPlaceholder,
  validateSalaryEntryReason,
} from "@/lib/services/salary-entry-reason";
import {
  computeAssistantNetPay,
  computeStaffNetPay,
  summarizeSalaryEntries,
} from "@/lib/services/salary-entry-math";
import { isDailyWageAssistant, isDailyWage } from "@/lib/services/assistant-compensation";
import {
  assistantIsFullyPaid,
  assistantPaidClinicShare,
  assistantPaidDoctorShare,
  assistantPaidTotalSalary,
  assistantPendingClinicShare,
  assistantPendingDoctorShare,
  assistantPendingTotalSalary,
  dailyWagePendingFromAccrued,
  slipIsFullyPaid,
  slipPaidNet,
  slipPendingNet,
} from "@/lib/services/payroll-paid-portions";
import {
  DAILY_ASSISTANT_PAYROLL_ENTRY_TYPES,
  EMPLOYEE_PAYROLL_ENTRY_TYPES,
  formatPayrollEntryTypesList,
  payrollEntryFormSubtitle,
} from "@/lib/services/salary-entry-display";
import { ChevronDown } from "lucide-react";

interface DoctorOption {
  id: string;
  full_name_ar: string;
}

function parsePositiveAmount(raw: string): number | null {
  const n = parseFloat(parseFormattedNumber(raw));
  if (!Number.isFinite(n) || n <= 0) return null;
  return n;
}

function StaffRow({
  staff: s,
  onEdit,
  onDeactivate,
}: {
  staff: StaffMember;
  onEdit: () => void;
  onDeactivate: () => void;
}) {
  return (
    <li className="flex flex-wrap items-center gap-2 py-3 px-1">
      <div className="flex-1 min-w-0">
        <p className={`font-medium text-sm ${s.is_active ? "text-slate-text" : "text-slate-400 line-through"}`}>
          {s.full_name_ar}
        </p>
        <p className="text-xs text-slate-muted">{s.job_title_ar}</p>
      </div>

      <span className="rounded-lg border border-slate-border bg-slate-50 px-3 py-1 text-sm font-semibold text-slate-700">
        {formatCurrency(s.base_salary)}
      </span>

      <Button size="sm" variant="outline" onClick={onEdit}>
        تعديل الراتب
      </Button>
      <Button
        size="sm"
        variant="outline"
        onClick={onDeactivate}
        className="border-amber-300 text-amber-800 hover:bg-amber-50"
      >
        إيقاف
      </Button>
    </li>
  );
}

const employeeEntryTypes = [
  { value: "advance", label: "سلفة" },
  { value: "deduction", label: "خصم" },
  { value: "absence", label: "خصم غياب" },
  { value: "bonus", label: "مكافأة" },
];

const dailyAssistantEntryTypes = [
  { value: "daily_wage", label: "أجر يومي" },
  { value: "advance", label: "سلفة" },
  { value: "deduction", label: "خصم" },
  { value: "absence", label: "خصم غياب" },
  { value: "bonus", label: "مكافأة" },
];

const doctorEntryTypes = [
  { value: "advance", label: "سلفة (يُخصم من الراتب)" },
  { value: "deduction", label: "خصم" },
  { value: "absence", label: "خصم غياب" },
  { value: "bonus", label: "مكافأة (يُضاف للراتب)" },
];

const entryTypeLabels = [
  ...employeeEntryTypes,
  { value: "daily_wage", label: "أجر يومي" },
  ...doctorEntryTypes,
];

const entryTypeShortLabel: Record<string, string> = {
  advance: "سلفة",
  deduction: "خصم",
  absence: "غياب",
  bonus: "مكافأة",
  daily_wage: "أجر يومي",
};

function slipDisplayName(slip: SalarySlip, persons: PayrollPerson[]): string {
  const staff = slip.staff as { full_name_ar?: string } | null | undefined;
  if (staff?.full_name_ar) return staff.full_name_ar;
  const doctor = slip.doctor as { full_name_ar?: string } | null | undefined;
  if (doctor?.full_name_ar) return doctor.full_name_ar;
  if (slip.doctor_id) {
    return (
      persons.find(
        (p) => p.category === "doctor_salary" && p.id === slip.doctor_id
      )?.full_name_ar ?? "طبيب"
    );
  }
  if (slip.staff_id) {
    return (
      persons.find(
        (p) =>
          (p.category === "general" || p.category === "accountant") &&
          p.id === slip.staff_id
      )?.full_name_ar ?? "موظف"
    );
  }
  return "—";
}

function entrySubmitLabel(type: string): string {
  switch (type) {
    case "advance":
      return "تسجيل السلفة وخصمها من الراتب";
    case "deduction":
      return "تسجيل الخصم";
    case "absence":
      return "تسجيل خصم الغياب";
    case "bonus":
      return "تسجيل المكافأة وإضافتها للراتب";
    case "daily_wage":
      return "تسجيل أجر اليوم";
    default:
      return "حفظ الحركة";
  }
}

function entryDisabledReason(opts: {
  boardLocked: boolean;
  slipPaid: boolean;
  selectedPerson: PayrollPerson | null;
  saving: boolean;
}): string | null {
  if (!opts.selectedPerson) {
    return "اختر موظفاً من القائمة أعلاه أولاً";
  }
  if (opts.boardLocked) {
    return "هذا الشهر مُغلق أو أرشيف — غيّر «شهر العمل» إلى الشهر النشط";
  }
  if (opts.slipPaid) {
    return "راتب هذا الموظف مُصرف بالكامل لهذا الشهر — لا يمكن إضافة حركات";
  }
  if (opts.saving) return null;
  return null;
}

export default function SalaryPage() {
  const {
    clinicId,
    clinicName,
    source: clinicSource,
    loading: clinicLoading,
    missingClinic,
  } = useActiveClinicId();
  const calendarMonth = currentMonthYear();
  const [workMonth, setWorkMonth] = useState(calendarMonth);
  const [activePayrollMonth, setActivePayrollMonth] = useState(calendarMonth);
  const [monthClosed, setMonthClosed] = useState(false);
  const [resetting, setResetting] = useState(false);

  const [staff, setStaff] = useState<StaffMember[]>([]);
  const [payrollPersons, setPayrollPersons] = useState<PayrollPerson[]>([]);
  const [payrollRecords, setPayrollRecords] = useState<PayrollRecord[]>([]);
  const [activeAssistantsCount, setActiveAssistantsCount] = useState(0);
  const [generatingPayroll, setGeneratingPayroll] = useState(false);
  const [confirmingPayrollId, setConfirmingPayrollId] = useState<string | null>(null);
  const [selectedKey, setSelectedKey] = useState("");
  const [selectedPerson, setSelectedPerson] = useState<PayrollPerson | null>(null);
  const [editingPerson, setEditingPerson] = useState<PayrollPerson | null>(null);
  const [deactivatingPerson, setDeactivatingPerson] =
    useState<PayrollPerson | null>(null);
  const [entryType, setEntryType] = useState("advance");
  const [amount, setAmount] = useState("");
  const [entryDate, setEntryDate] = useState(todayISO());
  const [notes, setNotes] = useState("");
  const [message, setMessage] = useState<string | null>(null);
  const [messageOk, setMessageOk] = useState(true);
  const [entries, setEntries] = useState<SalaryEntry[]>([]);
  const [slips, setSlips] = useState<SalarySlip[]>([]);
  const [saving, setSaving] = useState(false);
  const [entryFeedback, setEntryFeedback] = useState<{
    text: string;
    ok: boolean;
  } | null>(null);
  const [editingEntry, setEditingEntry] = useState<SalaryEntry | null>(null);
  const entryFormRef = useRef<HTMLDivElement>(null);
  const payrollEntryFormRef = useRef<HTMLDivElement>(null);

  const [employeeType, setEmployeeType] =
    useState<PayrollEmployeeCategory>("general");
  const [newName, setNewName] = useState("");
  const [newSalary, setNewSalary] = useState("");
  const [newJob, setNewJob] = useState("موظف خدمات");
  const [doctorId, setDoctorId] = useState("");
  const [doctorSharePct, setDoctorSharePct] = useState("50");
  const [assistantCompMode, setAssistantCompMode] = useState<
    "monthly_fixed" | "daily_wage"
  >("monthly_fixed");
  const [generalCompMode, setGeneralCompMode] = useState<
    "monthly_fixed" | "daily_wage"
  >("monthly_fixed");
  const [doctors, setDoctors] = useState<DoctorOption[]>([]);
  const [addingStaff, setAddingStaff] = useState(false);
  const [showActiveStaff, setShowActiveStaff] = useState(false);
  const [showMonthlyPayroll, setShowMonthlyPayroll] = useState(false);
  const [showAddEmployee, setShowAddEmployee] = useState(false);

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

  const selection = parsePayrollPersonKey(selectedKey);
  const assistantId = selection?.category === "assistant" ? selection.id : "";
  const isAssistantSelected = selection?.category === "assistant";
  const isDoctorSalarySelected = selection?.category === "doctor_salary";
  const isStaffSelected =
    selection?.category === "general" || selection?.category === "accountant";
  const isGeneralSelected = isStaffSelected;
  const staffId =
    selection?.category === "general" || selection?.category === "accountant"
      ? selection?.id ?? ""
      : "";
  const doctorSalaryId = isDoctorSalarySelected ? selection.id : "";
  const selectedStaff =
    staff.find((s) => s.id === staffId) ??
    (isGeneralSelected && selectedPerson
      ? ({
          id: staffId,
          clinic_id: clinicId ?? "",
          full_name_ar: selectedPerson.full_name_ar,
          job_title_ar: selectedPerson.job_title_ar,
          base_salary: selectedPerson.base_salary,
          phone: null,
          slot_number: null,
          is_active: true,
        } as StaffMember)
      : undefined);
  const selectedAssistantRecord = payrollRecords.find(
    (r) => r.assistant_id === assistantId
  );
  const staffSlipThisMonth = slips.find((s) =>
    isDoctorSalarySelected
      ? s.doctor_id === doctorSalaryId
      : s.staff_id === staffId
  );
  const isDailyAssistantSelected =
    isAssistantSelected &&
    isDailyWageAssistant(selectedPerson?.compensation_mode);
  const isDailyStaffSelected =
    isStaffSelected && isDailyWage(selectedPerson?.compensation_mode);
  const isDailyWageSelected = isDailyAssistantSelected || isDailyStaffSelected;

  const activeEmployeeEntryTypes = isDailyWageSelected
    ? dailyAssistantEntryTypes
    : employeeEntryTypes;
  const payrollEntryTypes = isDailyWageSelected
    ? DAILY_ASSISTANT_PAYROLL_ENTRY_TYPES
    : EMPLOYEE_PAYROLL_ENTRY_TYPES;
  const slipPaid = isAssistantSelected
    ? assistantIsFullyPaid(selectedAssistantRecord ?? null, {
        dailyWage: isDailyAssistantSelected,
      })
    : slipIsFullyPaid(staffSlipThisMonth ?? null, {
        dailyWage: isDailyStaffSelected,
      });
  const slipFullySettled = slipPaid;
  const slipBlocksNewEntries = isDailyWageSelected ? false : slipFullySettled;
  const slipPendingAmount = isAssistantSelected
    ? assistantPendingTotalSalary(selectedAssistantRecord ?? null, {
        dailyWage: isDailyAssistantSelected,
      })
    : slipPendingNet(staffSlipThisMonth ?? null, {
        dailyWage: isDailyStaffSelected,
      });
  const slipConfirmedAmount = isAssistantSelected
    ? assistantPaidTotalSalary(selectedAssistantRecord ?? null)
    : slipPaidNet(staffSlipThisMonth ?? null);
  const assistantPendingDoctor = assistantPendingDoctorShare(
    selectedAssistantRecord ?? null,
    { dailyWage: isDailyAssistantSelected }
  );
  const assistantPendingClinic = assistantPendingClinicShare(
    selectedAssistantRecord ?? null,
    { dailyWage: isDailyAssistantSelected }
  );
  const canConfirmPayroll =
    slipPendingAmount > 0 ||
    assistantPendingDoctor > 0 ||
    assistantPendingClinic > 0;
  const canUnconfirmPayroll =
    slipConfirmedAmount > 0 ||
    assistantPaidDoctorShare(selectedAssistantRecord ?? null) > 0 ||
    assistantPaidClinicShare(selectedAssistantRecord ?? null) > 0;

  const payrollBaseSalary =
    selectedStaff?.base_salary ?? selectedPerson?.base_salary ?? 0;

  function applyEntryMutationResult(result: {
    entries: SalaryEntry[];
    slip?: SalarySlip | null;
    payrollRecord?: PayrollRecord | null;
  }) {
    setEntries(result.entries);
    if (result.slip) {
      setSlips((prev) => {
        const rest = prev.filter((s) => s.id !== result.slip!.id);
        return [result.slip as SalarySlip, ...rest];
      });
    }
    if (result.payrollRecord) {
      setPayrollRecords((prev) => {
        const rest = prev.filter((r) => r.id !== result.payrollRecord!.id);
        return [result.payrollRecord as PayrollRecord, ...rest];
      });
    }
  }

  function showMessage(text: string, ok: boolean) {
    setMessage(text);
    setMessageOk(ok);
  }

  function flashEntryFeedback(text: string, ok: boolean) {
    setEntryFeedback({ text, ok });
    showMessage(text, ok);
    requestAnimationFrame(() => {
      payrollEntryFormRef.current?.scrollIntoView({
        behavior: "smooth",
        block: "center",
      });
      entryFormRef.current?.scrollIntoView({
        behavior: "smooth",
        block: "center",
      });
    });
  }

  useEffect(() => {
    let next =
      isCurrentMonth && isActivePayrollMonth ? todayISO() : monthTo;
    if (next < monthFrom) next = monthFrom;
    if (next > monthTo) next = monthTo;
    setEntryDate(next);
  }, [workMonth, isCurrentMonth, isActivePayrollMonth, monthFrom, monthTo]);

  useEffect(() => {
    if (isDoctorSalarySelected) {
      if (!doctorEntryTypes.some((t) => t.value === entryType)) {
        setEntryType("advance");
      }
    } else if (isDailyWageSelected) {
      if (!dailyAssistantEntryTypes.some((t) => t.value === entryType)) {
        setEntryType("daily_wage");
      }
    } else if (isStaffSelected || isAssistantSelected) {
      if (!employeeEntryTypes.some((t) => t.value === entryType)) {
        setEntryType("advance");
      }
    }
  }, [
    selectedKey,
    isDoctorSalarySelected,
    isStaffSelected,
    isAssistantSelected,
    isDailyWageSelected,
    entryType,
  ]);

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

  useEffect(() => {
    if (!clinicId) {
      setDoctors([]);
      return;
    }
    const supabase = createClient();
    supabase
      .from("doctors")
      .select("id, full_name_ar")
      .eq("clinic_id", clinicId)
      .eq("is_active", true)
      .order("full_name_ar")
      .then(({ data }) => {
        const list = (data as DoctorOption[]) ?? [];
        setDoctors(list);
        if (list[0] && !doctorId) setDoctorId(list[0].id);
      });
  }, [clinicId, doctorId]);

  const loadStaff = useCallback(async () => {
    if (!clinicId) {
      setStaff([]);
      return;
    }
    const params = new URLSearchParams({ clinic_id: clinicId });
    const res = await fetch(`/api/payroll/staff-members?${params}`, {
      credentials: "include",
      headers: authPortalHeaders("accountant"),
    });
    const json = await res.json();
    if (res.ok) {
      const resolvedClinic = (json as { clinic_id?: string }).clinic_id;
      if (resolvedClinic && resolvedClinic !== clinicId) {
        showMessage(
          "تعارض العيادة — حدّث الصفحة أو أعد تسجيل الدخول",
          false
        );
        setStaff([]);
        return;
      }
      setStaff((json.staff as StaffMember[]) || []);
      return;
    }
    setStaff([]);
  }, [clinicId]);

  const applyPayrollSelection = useCallback(
    (persons: PayrollPerson[], preferKey?: string) => {
      setSelectedKey((prev) => {
        const candidate = preferKey ?? prev;
        const next =
          candidate && persons.some((p) => payrollPersonKey(p) === candidate)
            ? candidate
            : persons[0]
              ? payrollPersonKey(persons[0])
              : "";
        setSelectedPerson(
          persons.find((p) => payrollPersonKey(p) === next) ?? null
        );
        return next;
      });
    },
    []
  );

  const handleEmployeeSelect = useCallback(
    (key: string, persons?: PayrollPerson[]) => {
      const list = persons ?? payrollPersons;
      setSelectedKey(key);
      setSelectedPerson(
        list.find((p) => payrollPersonKey(p) === key) ?? null
      );
    },
    [payrollPersons]
  );

  const loadPayrollPersons = useCallback(
    async (options?: { preferKey?: string }): Promise<PayrollPerson[]> => {
      if (!clinicId) {
        setPayrollPersons([]);
        setSelectedKey("");
        setSelectedPerson(null);
        return [];
      }

      try {
        const persons = await fetchActivePayrollPersonsViaApi(clinicId);
        setPayrollPersons(persons);
        applyPayrollSelection(persons, options?.preferKey);
        return persons;
      } catch (e) {
        const msg =
          e instanceof Error ? e.message : "تعذر جلب قائمة العاملين";
        showMessage(msg, false);
        setPayrollPersons([]);
        setSelectedKey("");
        setSelectedPerson(null);
        return [];
      }
    },
    [clinicId, applyPayrollSelection]
  );

  const loadPayrollMonth = useCallback(async () => {
    if (!clinicId) {
      setPayrollRecords([]);
      setSlips([]);
      setActiveAssistantsCount(0);
      return;
    }
    try {
      const { records, slips } = await fetchPayrollMonthViaApi(
        clinicId,
        workMonth
      );
      setPayrollRecords(records);
      setSlips(slips);
    } catch (e) {
      const msg =
        e instanceof Error ? e.message : "تعذر جلب رواتب الشهر";
      showMessage(msg, false);
      setPayrollRecords([]);
      setSlips([]);
    }
    const supabase = createClient();
    setActiveAssistantsCount(
      await countActiveAssistantsForPayroll(supabase, clinicId)
    );
  }, [clinicId, workMonth]);

  const loadEntries = useCallback(async () => {
    if ((!staffId && !doctorSalaryId && !assistantId) || !clinicId) {
      setEntries([]);
      return;
    }
    try {
      const params = new URLSearchParams({
        clinic_id: clinicId,
        month_year: workMonth,
      });
      if (staffId) params.set("staff_id", staffId);
      if (assistantId) params.set("assistant_id", assistantId);
      if (doctorSalaryId) params.set("doctor_id", doctorSalaryId);
      const res = await fetch(`/api/payroll/salary-entries?${params}`, {
        credentials: "include",
        headers: authPortalHeaders("accountant"),
      });
      const json = (await res.json()) as {
        entries?: SalaryEntry[];
        error?: string;
      };
      if (res.ok) {
        setEntries(json.entries ?? []);
        return;
      }
    } catch {
      // fallback below
    }
    const supabase = createClient();
    let query = supabase
      .from("salary_entries")
      .select("*")
      .eq("clinic_id", clinicId)
      .gte("entry_date", monthFrom)
      .lte("entry_date", monthTo)
      .order("entry_date", { ascending: false });
    query = staffId
      ? query.eq("staff_id", staffId)
      : assistantId
        ? query.eq("assistant_id", assistantId)
        : query.eq("doctor_id", doctorSalaryId);
    const { data } = await query;
    setEntries((data as SalaryEntry[]) || []);
  }, [staffId, assistantId, doctorSalaryId, clinicId, workMonth, monthFrom, monthTo]);


  useEffect(() => {
    if (clinicId === undefined) return;
    setPayrollPersons([]);
    setPayrollRecords([]);
    setSlips([]);
    setStaff([]);
    setEntries([]);
    setSelectedKey("");
    setSelectedPerson(null);
  }, [clinicId]);

  useEffect(() => {
    loadStaff();
  }, [loadStaff]);

  useEffect(() => {
    loadPayrollPersons();
  }, [loadPayrollPersons]);

  useEffect(() => {
    loadPayrollMonth();
  }, [loadPayrollMonth]);

  useEffect(() => {
    loadEntries();
  }, [loadEntries]);

  const { advances, deductions, bonuses, dailyWages } =
    summarizeSalaryEntries(entries);

  function netAfterEntry(
    person: PayrollPerson,
    adv: number,
    ded: number,
    bon: number,
    daily: number,
    type: string,
    pending: number,
    confirmedPaid: number
  ): number {
    if (person.category === "assistant" && isDailyWageAssistant(person.compensation_mode)) {
      const nextDaily = daily + (type === "daily_wage" ? pending : 0);
      const nextAdv = adv + (type === "advance" ? pending : 0);
      const nextDed =
        ded +
        (type === "deduction" || type === "absence" ? pending : 0);
      const nextBon = bon + (type === "bonus" ? pending : 0);
      const accrued = Math.max(
        0,
        Math.round((nextDaily + nextBon - nextAdv - nextDed) * 100) / 100
      );
      return dailyWagePendingFromAccrued(accrued, confirmedPaid);
    }
    if (
      (person.category === "general" || person.category === "accountant") &&
      isDailyWage(person.compensation_mode)
    ) {
      const nextDaily = daily + (type === "daily_wage" ? pending : 0);
      const nextAdv = adv + (type === "advance" ? pending : 0);
      const nextDed =
        ded +
        (type === "deduction" || type === "absence" ? pending : 0);
      const nextBon = bon + (type === "bonus" ? pending : 0);
      const accrued = Math.max(
        0,
        Math.round((nextDaily + nextBon - nextAdv - nextDed) * 100) / 100
      );
      return dailyWagePendingFromAccrued(accrued, confirmedPaid);
    }
    return calculateSalaryNet(
      person.base_salary,
      adv + (type === "advance" ? pending : 0),
      ded + (type === "deduction" || type === "absence" ? pending : 0),
      bon + (type === "bonus" ? pending : 0)
    );
  }

  const fullDailyNet =
    selectedPerson && isDailyWageSelected
      ? isDailyAssistantSelected
        ? computeAssistantNetPay(
            selectedPerson.compensation_mode,
            0,
            entries
          ).netPayout
        : computeStaffNetPay(
            0,
            entries,
            selectedPerson.compensation_mode
          ).netPayout
      : 0;

  const netPreview =
    isDoctorSalarySelected && selectedPerson
      ? calculateSalaryNet(
          selectedPerson.base_salary,
          advances,
          deductions,
          bonuses
        )
      : selectedPerson && (isStaffSelected || isAssistantSelected)
        ? isDailyWageSelected
          ? dailyWagePendingFromAccrued(fullDailyNet, slipConfirmedAmount)
          : calculateSalaryNet(
              selectedPerson.base_salary,
              advances,
              deductions,
              bonuses
            )
        : 0;
  const pendingAmount = parsePositiveAmount(amount) ?? 0;
  const dailyWageEntryPreview = useMemo(() => {
    if (
      !isDailyAssistantSelected ||
      entryType !== "daily_wage" ||
      pendingAmount <= 0 ||
      !selectedPerson
    ) {
      return null;
    }
    return breakdownAssistantSalary({
      total_salary: pendingAmount,
      doctor_share_percentage: selectedPerson.doctor_share_percentage ?? 0,
    });
  }, [
    isDailyAssistantSelected,
    entryType,
    pendingAmount,
    selectedPerson,
  ]);
  const netAfterPending =
    pendingAmount > 0 && selectedPerson
      ? isDoctorSalarySelected
        ? calculateSalaryNet(
            selectedPerson.base_salary,
            advances + (entryType === "advance" ? pendingAmount : 0),
            deductions +
              (entryType === "deduction" || entryType === "absence"
                ? pendingAmount
                : 0),
            bonuses + (entryType === "bonus" ? pendingAmount : 0)
          )
        : isStaffSelected || isAssistantSelected
          ? netAfterEntry(
              selectedPerson,
              advances,
              deductions,
              bonuses,
              dailyWages,
              entryType,
              pendingAmount,
              slipConfirmedAmount
            )
          : null
      : null;
  const employeeEntryBlockReason =
    (isStaffSelected || isAssistantSelected) && !isDoctorSalarySelected
      ? entryDisabledReason({
          boardLocked,
          slipPaid: slipBlocksNewEntries,
          selectedPerson,
          saving,
        })
      : null;
  const doctorEntryBlockReason = isDoctorSalarySelected
    ? entryDisabledReason({
        boardLocked,
        slipPaid: slipFullySettled,
        selectedPerson,
        saving,
      })
    : null;

  const totalPaidThisMonth = slips
    .reduce((sum, s) => sum + slipPaidNet(s), 0);

  async function handleEmployeeEntry(e?: React.SyntheticEvent) {
    e?.preventDefault();
    setEntryFeedback(null);

    if (employeeEntryBlockReason) {
      flashEntryFeedback(employeeEntryBlockReason, false);
      return;
    }
    if (!clinicId) {
      flashEntryFeedback("لا توجد عيادة نشطة — ربط الحساب بالعيادة مطلوب", false);
      return;
    }
    if (clinicSource === "fallback") {
      flashEntryFeedback(
        "حسابك غير مربوط بعيادة — نفّذ link_profile_to_first_clinic() ثم أعد تسجيل الدخول",
        false
      );
      return;
    }
    const parsed = parsePositiveAmount(amount);
    if (parsed == null) {
      flashEntryFeedback("أدخل مبلغاً أكبر من صفر في حقل المبلغ", false);
      return;
    }
    if (!selectedPerson || (!staffId && !assistantId)) {
      flashEntryFeedback("اختر موظفاً أو مساعداً من القائمة أعلاه", false);
      return;
    }
    if (entryDate < monthFrom || entryDate > monthTo) {
      flashEntryFeedback(
        `تاريخ الحركة يجب أن يكون داخل ${formatMonthYearAr(workMonth)} (${monthFrom} — ${monthTo})`,
        false
      );
      return;
    }
    const reasonError = validateSalaryEntryReason(entryType, notes);
    if (reasonError) {
      flashEntryFeedback(reasonError, false);
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
          staff_id: staffId || undefined,
          assistant_id: assistantId || undefined,
          month_year: workMonth,
          entry_type: entryType,
          amount: parsed,
          entry_date: entryDate,
          base_salary: selectedPerson.base_salary,
          notes_ar: notes || null,
        }),
      });
      const json = (await res.json()) as {
        error?: string;
        warning?: string;
        entries?: SalaryEntry[];
        slip?: SalarySlip;
        payroll_record?: PayrollRecord;
        net_payout?: number;
      };
      if (!res.ok) {
        flashEntryFeedback(
          `تعذر الحفظ: ${translateDbError(json.error ?? "خطأ غير معروف")}`,
          false
        );
        return;
      }

      if (json.entries) {
        setEntries(json.entries);
      } else {
        await loadEntries();
      }

      if (json.slip) {
        setSlips((prev) => {
          const rest = prev.filter(
            (s) => !(s.month_year === workMonth && s.staff_id === staffId)
          );
          return [json.slip as SalarySlip, ...rest];
        });
      } else if (json.payroll_record) {
        setPayrollRecords((prev) => {
          const rest = prev.filter((r) => r.id !== json.payroll_record!.id);
          return [json.payroll_record as PayrollRecord, ...rest];
        });
      } else {
        await loadPayrollMonth();
      }

      if (json.warning?.includes("إلغاء تأكيد الصرف")) {
        await loadPayrollMonth();
      }

      notifyClinicProfitRefresh(clinicId ?? undefined);

      const typeLabel =
        activeEmployeeEntryTypes.find((t) => t.value === entryType)?.label ??
        "الحركة";
      const netText =
        json.net_payout != null
          ? ` — الصافي الآن ${formatCurrency(json.net_payout)}`
          : "";
      flashEntryFeedback(
        json.warning
          ? `✓ تم تسجيل ${typeLabel}${netText} — ${json.warning}`
          : `✓ تم تسجيل ${typeLabel}${netText}`,
        !json.warning
      );
      setAmount("");
      setNotes("");
    } catch {
      flashEntryFeedback("تعذر الاتصال بالسيرفر — أعد المحاولة", false);
    } finally {
      setSaving(false);
    }
  }

  async function handleDoctorSalaryEntry(e?: React.SyntheticEvent) {
    e?.preventDefault();
    setEntryFeedback(null);

    if (doctorEntryBlockReason) {
      flashEntryFeedback(doctorEntryBlockReason, false);
      return;
    }
    if (!clinicId || !doctorSalaryId || !selectedPerson) {
      flashEntryFeedback("اختر طبيباً على نظام الراتب الثابت", false);
      return;
    }
    if (clinicSource === "fallback") {
      flashEntryFeedback(
        "حسابك غير مربوط بعيادة — نفّذ link_profile_to_first_clinic() ثم أعد تسجيل الدخول",
        false
      );
      return;
    }
    const parsed = parsePositiveAmount(amount);
    if (parsed == null) {
      flashEntryFeedback("أدخل مبلغاً أكبر من صفر في حقل المبلغ", false);
      return;
    }
    if (entryDate < monthFrom || entryDate > monthTo) {
      flashEntryFeedback(
        `تاريخ الحركة يجب أن يكون داخل ${formatMonthYearAr(workMonth)}`,
        false
      );
      return;
    }
    const reasonError = validateSalaryEntryReason(entryType, notes);
    if (reasonError) {
      flashEntryFeedback(reasonError, false);
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
          doctor_id: doctorSalaryId,
          month_year: workMonth,
          entry_type: entryType,
          amount: parsed,
          entry_date: entryDate,
          base_salary: selectedPerson.base_salary,
          notes_ar: notes || null,
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
        flashEntryFeedback(
          `تعذر الحفظ: ${translateDbError(json.error ?? "خطأ غير معروف")}`,
          false
        );
        return;
      }

      if (json.entries) {
        setEntries(json.entries);
      } else {
        await loadEntries();
      }

      if (json.slip) {
        setSlips((prev) => {
          const rest = prev.filter(
            (s) =>
              !(s.month_year === workMonth && s.doctor_id === doctorSalaryId)
          );
          return [json.slip as SalarySlip, ...rest];
        });
      } else {
        await loadPayrollMonth();
      }

      const typeLabel =
        doctorEntryTypes.find((t) => t.value === entryType)?.label ?? "الحركة";
      const netText =
        json.net_payout != null
          ? ` — صافي الراتب الآن ${formatCurrency(json.net_payout)}`
          : "";
      const successText = `✓ تم تسجيل ${typeLabel}${netText}`;
      flashEntryFeedback(
        json.warning ? `${successText} — ${json.warning}` : successText,
        !json.warning
      );
      setAmount("");
      setNotes("");
    } catch {
      flashEntryFeedback("تعذر الاتصال بالسيرفر — أعد المحاولة", false);
    } finally {
      setSaving(false);
    }
  }

  async function addStaff(e: React.FormEvent) {
    e.preventDefault();
    if (!clinicId) {
      showMessage("لا توجد عيادة نشطة", false);
      return;
    }
    if (!newName.trim()) {
      showMessage("أدخل اسم الموظف", false);
      return;
    }
    let salary: number;
    if (employeeType === "assistant" && assistantCompMode === "daily_wage") {
      salary = 0;
    } else if (employeeType === "general" && generalCompMode === "daily_wage") {
      salary = 0;
    } else {
      const parsed = parsePositiveAmount(newSalary);
      if (parsed == null) {
        showMessage("أدخل راتباً صحيحاً", false);
        return;
      }
      salary = parsed;
    }

    if (employeeType === "assistant") {
      if (!doctorId) {
        showMessage("اختر الطبيب المسؤول", false);
        return;
      }
      const share = Number(doctorSharePct);
      if (!Number.isFinite(share) || share < 0 || share > 100) {
        showMessage("نسبة الطبيب بين 0 و 100", false);
        return;
      }
    }

    setAddingStaff(true);
    const addedName = newName.trim();

    try {
      const res = await fetch("/api/payroll/add-employee", {
        method: "POST",
        credentials: "include",
        headers: {
          "Content-Type": "application/json",
          ...authPortalHeaders("accountant"),
        },
        body: JSON.stringify({
          employee_type: employeeType,
          full_name_ar: addedName,
          base_salary: salary,
          job_title_ar: newJob.trim() || "موظف خدمات",
          doctor_id: employeeType === "assistant" ? doctorId : undefined,
          doctor_share_percentage:
            employeeType === "assistant" ? Number(doctorSharePct) : undefined,
          compensation_mode:
            employeeType === "assistant"
              ? assistantCompMode
              : employeeType === "general"
                ? generalCompMode
                : undefined,
        }),
      });

      const json = await res.json();
      if (!res.ok) {
        showMessage(
          `تعذر الإضافة: ${translateDbError(json.error ?? "خطأ غير معروف")}`,
          false
        );
        return;
      }

      setNewName("");
      setNewSalary("");
      const newKey = json.payroll_key as string;
      const addedPerson = json.person as PayrollPerson | undefined;

      await loadStaff();
      const persons = await loadPayrollPersons({ preferKey: newKey });

      let merged = persons;
      if (addedPerson) {
        const addedKey = payrollPersonKey(addedPerson);
        if (!persons.some((p) => payrollPersonKey(p) === addedKey)) {
          merged = [...persons, addedPerson].sort((a, b) =>
            a.name.localeCompare(b.name, "ar")
          );
          setPayrollPersons(merged);
        }
        handleEmployeeSelect(newKey, merged);
      }

      await loadPayrollMonth();

      const count = merged.length;
      if (employeeType === "assistant") {
        showMessage(
          `تم إضافة مساعد الطبيب ${addedName} — يظهر الآن في القائمة (${count} نشط)`,
          true
        );
      } else {
        showMessage(
          `تم إضافة ${addedName} — مصاريف عيادة فقط (${count} نشط)`,
          true
        );
      }
    } finally {
      setAddingStaff(false);
    }
  }

  async function generateSlip() {
    if (isAssistantSelected) {
      showMessage("قسائم المساعدين تُدار عبر «توليد رواتب الشهر»", false);
      return;
    }
    if ((!selectedStaff && !isDoctorSalarySelected) || !clinicId) {
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
    if (slipBlocksNewEntries) {
      showMessage("قسيمة هذا الشهر مُسلَّمة مسبقاً", false);
      return;
    }

    setSaving(true);
    const supabase = createClient();
    const base = selectedPerson?.base_salary ?? selectedStaff?.base_salary ?? 0;
    const payload: Record<string, unknown> = {
      clinic_id: clinicId,
      month_year: workMonth,
      base_salary: base,
      total_advances: advances,
      total_deductions: deductions,
      net_payout: netPreview,
      status: "draft" as const,
    };
    if (isDoctorSalarySelected) {
      payload.doctor_id = doctorSalaryId;
    } else {
      payload.staff_id = staffId;
    }

    let slipQuery = supabase
      .from("salary_slips")
      .select("id, status")
      .eq("clinic_id", clinicId)
      .eq("month_year", workMonth);
    slipQuery = isDoctorSalarySelected
      ? slipQuery.eq("doctor_id", doctorSalaryId)
      : slipQuery.eq("staff_id", staffId);
    const { data: existing, error: fetchErr } = await slipQuery.maybeSingle();

    if (fetchErr) {
      setSaving(false);
      showMessage(`تعذر إنشاء القسيمة: ${translateDbError(fetchErr.message)}`, false);
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
      showMessage(`تعذر إنشاء القسيمة: ${translateDbError(error.message)}`, false);
      return;
    }
    showMessage("تم إنشاء قسيمة الراتب", true);
    loadPayrollMonth();
  }

  async function markSlipPaid(slipId: string) {
    if (confirmingPayrollId) return;
    setConfirmingPayrollId(slipId);
    try {
      const result = await confirmPayrollViaApi("slip", slipId);
      if (!result.ok) {
        showMessage(`تعذر تأكيد الصرف: ${result.error}`, false);
        return;
      }
      notifyClinicProfitRefresh(clinicId ?? undefined);
      const confirmed =
        result.confirmed_amount ??
        result.net_payout ??
        slipPendingAmount;
      showMessage(
        confirmed > 0
          ? `تم تأكيد الصرف — خُصم ${formatCurrency(confirmed)} من ربح العيادة (المبلغ المتبقي فقط)`
          : "تم تأكيد الصرف",
        true
      );
      void loadPayrollMonth();
    } finally {
      setConfirmingPayrollId(null);
    }
  }

  async function unmarkSlipPaid(slipId: string) {
    if (
      !window.confirm(
        "إلغاء تأكيد الصرف؟\n\nسُتعاد القسيمة إلى «مسودة» ويُحذف خصم الربح — يمكنك التعديل ثم التأكيد مجدداً."
      )
    ) {
      return;
    }
    const result = await unconfirmPayrollViaApi("slip", slipId);
    if (!result.ok) {
      showMessage(`تعذر إلغاء الصرف: ${result.error}`, false);
      return;
    }
    notifyClinicProfitRefresh();
    showMessage("تم إلغاء الصرف — يمكنك تعديل الحركات وتأكيد الصرف مرة أخرى", true);
    loadPayrollMonth();
    loadEntries();
  }

  async function markAssistantPayrollPaid(recordId: string) {
    if (confirmingPayrollId) return;
    setConfirmingPayrollId(recordId);
    try {
      const result = await confirmPayrollViaApi("assistant", recordId);
      if (!result.ok) {
        showMessage(`تعذر تأكيد صرف المساعد: ${result.error}`, false);
        return;
      }
      notifyClinicProfitRefresh(clinicId ?? undefined);
      if (result.doctor_id) {
        notifyFinancialMutation({
          clinicId: clinicId ?? "",
          doctorId: result.doctor_id,
        });
      }
      const deducted = result.doctor_deducted ?? 0;
      const clinicPart = result.clinic_deducted ?? 0;
      showMessage(
        deducted > 0 || clinicPart > 0
          ? `تم تأكيد الصرف — خُصم ${formatCurrency(deducted)} من الطبيب${clinicPart > 0 ? ` و${formatCurrency(clinicPart)} من ربح العيادة` : ""} (المبلغ المتبقي فقط)`
          : "تم تأكيد الصرف — لا حصة للطبيب (النسبة 0%)",
        true
      );
      void loadPayrollMonth();
    } finally {
      setConfirmingPayrollId(null);
    }
  }

  async function unmarkAssistantPayrollPaid(recordId: string) {
    if (
      !window.confirm(
        "إلغاء تأكيد صرف المساعد؟\n\nيُعاد السجل إلى «مُولَّد» ويُلغى خصم حصة الطبيب — يمكنك التأكيد مجدداً لاحقاً."
      )
    ) {
      return;
    }
    const result = await unconfirmPayrollViaApi("assistant", recordId);
    if (!result.ok) {
      showMessage(`تعذر إلغاء الصرف: ${result.error}`, false);
      return;
    }
    notifyClinicProfitRefresh();
    showMessage("تم إلغاء صرف المساعد — يمكن تأكيد الصرف مرة أخرى", true);
    loadPayrollMonth();
  }

  function staffMemberToPerson(s: StaffMember): PayrollPerson {
    const profileId = s.profile_id;
    const isAccountant = Boolean(profileId);
    const job = s.job_title_ar || (isAccountant ? "محاسب" : "موظف خدمات");
    return {
      id: s.id,
      name: s.full_name_ar,
      role: job,
      category: isAccountant ? "accountant" : "general",
      full_name_ar: s.full_name_ar,
      job_title_ar: job,
      base_salary: s.base_salary,
      profile_id: profileId ?? null,
      is_active: true,
    };
  }

  async function refreshAfterEmployeeChange(preferKey?: string) {
    await Promise.all([
      loadStaff(),
      loadPayrollPersons({ preferKey }),
      loadPayrollMonth(),
    ]);
  }

  async function handleGenerateMonthlyPayroll() {
    if (!clinicId) {
      showMessage("لا توجد عيادة نشطة", false);
      return;
    }
    if (boardLocked) {
      showMessage("هذا الشهر مُغلق أو أرشيف — لا يمكن توليد رواتب جديدة", false);
      return;
    }
    setGeneratingPayroll(true);
    const result = await generateMonthlyPayrollViaApi(clinicId, workMonth);
    setGeneratingPayroll(false);

    if (!result.ok) {
      const hint =
        result.error?.includes("payroll_records") ||
        result.error?.includes("schema")
          ? " — شغّل supabase/scripts/06-assistant-payroll-records.sql"
          : "";
      showMessage(`${result.error ?? "تعذر توليد الرواتب"}${hint}`, false);
      return;
    }

    const totalTouched =
      result.totalCreated ??
      result.assistantCreated +
        (result.assistantUpdated ?? 0) +
        result.generalCreated +
        (result.generalUpdated ?? 0) +
        (result.doctorSalaryCreated ?? 0) +
        (result.doctorSalaryUpdated ?? 0);
    if (totalTouched === 0 && payrollPersons.length === 0) {
      showMessage("لا يوجد عاملون نشطون — أضف موظفاً أولاً", false);
    } else if (totalTouched === 0) {
      showMessage(
        "تمت مزامنة الرواتب — السجلات المدفوعة تبقى كما هي",
        true
      );
    } else {
      showMessage(
        `تم توليد/تحديث ${totalTouched} راتب — ${result.assistantCreated} مساعد · ${result.generalCreated} موظف · ${result.doctorSalaryCreated ?? 0} طبيب راتب · محدَّث: ${(result.assistantUpdated ?? 0) + (result.generalUpdated ?? 0) + (result.doctorSalaryUpdated ?? 0)}`,
        true
      );
    }
    notifyClinicProfitRefresh();
    await Promise.all([loadPayrollMonth(), loadPayrollPersons()]);
  }

  const payrollClinicTotal =
    payrollRecords.reduce(
      (s, r) => s + Number(r.clinic_share_amount ?? 0),
      0
    ) +
    slips.reduce((s, sl) => s + Number(sl.net_payout ?? 0), 0);
  const payrollDoctorTotal = payrollRecords.reduce(
    (s, r) => s + Number(r.doctor_share_amount ?? 0),
    0
  );
  const hasGeneratedPayroll = payrollRecords.length > 0 || slips.length > 0;

  const payrollMonthRows = useMemo(
    () =>
      payrollPersons.map((person) => {
        if (person.category === "assistant") {
          const record = payrollRecords.find(
            (r) => r.assistant_id === person.id
          );
          return { person, record: record ?? null, slip: null as SalarySlip | null };
        }
        if (person.category === "doctor_salary") {
          const slip = slips.find((s) => s.doctor_id === person.id);
          return { person, record: null, slip: slip ?? null };
        }
        const slip = slips.find((s) => s.staff_id === person.id);
        return { person, record: null, slip: slip ?? null };
      }),
    [payrollPersons, payrollRecords, slips]
  );

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
    await loadPayrollMonth();
    await loadEntries();
    showMessage(
      `تم التصفير — أُغلق ${formatMonthYearAr(result.closedMonth ?? workMonth)}. ابدأ ${formatMonthYearAr(result.nextMonth ?? "")}`,
      true
    );
  }

  const payrollPersonOptions = payrollPersons.map((p) => ({
    value: payrollPersonKey(p),
    label: `${p.full_name_ar} — ${p.job_title_ar} (${payrollCategoryLabel(p.category)})`,
  }));
  const activePayrollCount = payrollPersons.length;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h2 className="text-2xl font-bold text-slate-text">رواتب الموظفين</h2>
          <p className="text-slate-muted">
            عدد موظفين غير محدود — حساب منفصل لكل شهر
            {clinicName ? (
              <>
                {" "}
                · العيادة النشطة:{" "}
                <strong className="text-slate-text">{clinicName}</strong>
                {clinicSource === "developer" ? " (دخول نيابة)" : ""}
              </>
            ) : null}
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
          <li>
            <strong>توليد رواتب الشهر:</strong> مساعدو الأطباء يُقسَّم راتبهم ·
            موظفو الخدمات يُصرف راتبهم كاملاً من مصاريف العيادة (لا خصم من الأطباء).
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

      <EmployeePayrollProfileCard
        options={payrollPersonOptions}
        selectedKey={selectedKey}
        onSelect={(key) => void handleEmployeeSelect(key)}
        person={selectedPerson}
        totalCount={activePayrollCount}
        onEditSalary={
          selectedPerson ? () => setEditingPerson(selectedPerson) : undefined
        }
        onDeactivate={
          selectedPerson ? () => setDeactivatingPerson(selectedPerson) : undefined
        }
      />

      {isDoctorSalarySelected && selectedPerson && (
        <div ref={entryFormRef}>
          <Card className="border-amber-200 bg-gradient-to-b from-amber-50/80 to-white">
            <CardHeader>
              <CardTitle>
                طبيب راتب ثابت — سلفة · خصم · غياب · مكافأة (
                {formatMonthYearAr(workMonth)})
              </CardTitle>
              <p className="text-xs text-amber-900">
                {selectedPerson.full_name_ar} — الراتب الأساسي{" "}
                {formatCurrency(selectedPerson.base_salary)}
              </p>
            </CardHeader>
            <form
              noValidate
              onSubmit={(e) => {
                e.preventDefault();
                void handleDoctorSalaryEntry();
              }}
              className="space-y-4"
            >
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                {doctorEntryTypes.map((t) => (
                  <button
                    key={t.value}
                    type="button"
                    onClick={() => setEntryType(t.value)}
                    className={`rounded-lg border px-3 py-3 text-sm font-semibold transition ${
                      entryType === t.value
                        ? "border-amber-600 bg-amber-600 text-white shadow-sm"
                        : "border-slate-border bg-white text-slate-text hover:border-amber-500 hover:bg-amber-50"
                    }`}
                  >
                    {entryTypeShortLabel[t.value] ?? t.label}
                  </button>
                ))}
              </div>
              <p className="text-xs text-slate-muted">
                {doctorEntryTypes.find((t) => t.value === entryType)?.label}
              </p>

              <CurrencyInput
                label="المبلغ"
                value={amount}
                onChange={setAmount}
                placeholder="500,000"
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
                label={salaryReasonFieldLabel(entryType)}
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                placeholder={salaryReasonPlaceholder(entryType)}
                required={isSalaryReasonRequired(entryType)}
              />

              {entryFeedback && (
                <Alert variant={entryFeedback.ok ? "success" : "error"}>
                  {entryFeedback.text}
                </Alert>
              )}

              {netAfterPending != null && (
                <p className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm">
                  صافي الراتب بعد هذه الحركة:{" "}
                  <strong className="text-amber-900">
                    {formatCurrency(netAfterPending)}
                  </strong>
                </p>
              )}

              <Button
                type="button"
                className="w-full bg-amber-600 hover:bg-amber-700 disabled:opacity-70"
                disabled={saving}
                onClick={() => void handleDoctorSalaryEntry()}
              >
                {saving ? "جاري الحفظ..." : entrySubmitLabel(entryType)}
              </Button>
              {doctorEntryBlockReason ? (
                <p className="text-center text-xs text-amber-800">
                  تنبيه: {doctorEntryBlockReason}
                </p>
              ) : (
                <p className="text-center text-xs text-slate-muted">
                  تُحدَّث قسيمة راتب الطبيب تلقائياً بعد كل حركة
                </p>
              )}
            </form>
          </Card>
        </div>
      )}

      {!clinicLoading && (missingClinic || !clinicId) && (
        <Alert variant="warning">
          حسابك غير مربوط بعيادة — لن تظهر رواتب أي عيادة حتى الربط. نفّذ في
          Supabase SQL:{" "}
          <code dir="ltr" className="text-xs">
            SELECT public.link_profile_to_first_clinic();
          </code>
        </Alert>
      )}

      {staff.length > 0 && (
        <Card>
          <CardHeader className="mb-0">
            <button
              type="button"
              onClick={() => setShowActiveStaff((v) => !v)}
              className="flex w-full items-start gap-2 text-right hover:opacity-90"
              aria-expanded={showActiveStaff}
            >
              <ChevronDown
                className={cn(
                  "mt-1 h-5 w-5 shrink-0 text-slate-muted transition-transform",
                  showActiveStaff && "rotate-180"
                )}
              />
              <div className="min-w-0 flex-1">
                <CardTitle className="text-right">
                  موظفو الخدمات النشطون ({staff.length})
                </CardTitle>
                <p className="text-xs text-slate-muted">
                  {showActiveStaff
                    ? "تعديل الراتب أو إيقاف الموظف من الأزرار أدناه"
                    : "اضغط لعرض قائمة الموظفين"}
                </p>
              </div>
            </button>
          </CardHeader>
          {showActiveStaff && (
            <ul className="mt-4 divide-y divide-slate-border/40 border-t border-slate-border/40 pt-4">
              {staff.map((s) => (
                <StaffRow
                  key={s.id}
                  staff={s}
                  onEdit={() => setEditingPerson(staffMemberToPerson(s))}
                  onDeactivate={() => setDeactivatingPerson(staffMemberToPerson(s))}
                />
              ))}
            </ul>
          )}
        </Card>
      )}

      <Card>
        <CardHeader className="mb-0">
          <button
            type="button"
            onClick={() => setShowMonthlyPayroll((v) => !v)}
            className="flex w-full items-start gap-2 text-right hover:opacity-90"
            aria-expanded={showMonthlyPayroll}
          >
            <ChevronDown
              className={cn(
                "mt-1 h-5 w-5 shrink-0 text-slate-muted transition-transform",
                showMonthlyPayroll && "rotate-180"
              )}
            />
            <div className="min-w-0 flex-1">
              <CardTitle className="text-right">
                رواتب الشهر — {formatMonthYearAr(workMonth)}
              </CardTitle>
              <p className="text-xs text-slate-muted">
                {showMonthlyPayroll
                  ? "جدول التوليد والصرف لجميع العاملين"
                  : "اضغط لعرض جدول رواتب الشهر وتوليد الرواتب"}
              </p>
            </div>
          </button>
        </CardHeader>
        {showMonthlyPayroll && (
          <>
            {isActivePayrollMonth && !monthClosed && (
              <div className="mb-3 flex justify-end border-t border-slate-border/40 pt-4">
                <Button
                  type="button"
                  size="sm"
                  disabled={generatingPayroll || !clinicId || boardLocked}
                  onClick={handleGenerateMonthlyPayroll}
                >
                  {generatingPayroll ? "جاري التوليد..." : "توليد رواتب الشهر"}
                </Button>
              </div>
            )}
        <p className="mb-3 px-1 text-xs text-slate-muted">
          <strong>مساعد طبيب:</strong> يُقسّم بين الطبيب والعيادة ·{" "}
          <strong>موظف عيادة:</strong> راتبه كامل من مصاريف العيادة ·{" "}
          <strong>الخصم/المكافأة:</strong> لهذا الشهر فقط — الشهر الجديد يبدأ بالراتب الأساسي
        </p>
        {payrollPersons.length === 0 ? (
          <p className="rounded-lg border border-dashed border-slate-border px-4 py-8 text-center text-sm text-slate-muted">
            لا يوجد عاملون نشطون — أضف موظفاً من النموذج أدناه
          </p>
        ) : (
          <>
            <div className="overflow-x-auto">
              <table className="w-full min-w-[720px] text-sm">
                <thead>
                  <tr className="border-b text-right text-xs text-slate-muted">
                    <th className="py-2 pe-2">الاسم</th>
                    <th className="py-2 pe-2">النوع</th>
                    <th className="py-2 pe-2">الراتب الأساسي</th>
                    <th className="py-2 pe-2">سلف/خصم</th>
                    <th className="py-2 pe-2">صافي العيادة</th>
                    <th className="py-2 pe-2">حصة الطبيب</th>
                    <th className="py-2">الحالة</th>
                  </tr>
                </thead>
                <tbody>
                  {payrollMonthRows.map(({ person, record, slip }) => {
                    const isAssistant = person.category === "assistant";
                    const baseSalary = isAssistant
                      ? person.base_salary
                      : slip?.base_salary ?? person.base_salary;
                    const adjustments = slip
                      ? Number(slip.total_advances ?? 0) +
                        Number(slip.total_deductions ?? 0)
                      : 0;
                    const clinicNet = isAssistant
                      ? record?.clinic_share_amount
                      : slip?.net_payout;
                    const doctorShare = record?.doctor_share_amount;
                    const rowKey = payrollPersonKey(person);

                    return (
                      <tr
                        key={rowKey}
                        className="border-b border-slate-border/30"
                      >
                        <td className="py-2 pe-2 font-medium">
                          {person.full_name_ar}
                        </td>
                        <td className="py-2 pe-2 text-slate-600">
                          {payrollCategoryLabel(person.category)}
                        </td>
                        <td className="py-2 pe-2">
                          {formatCurrency(baseSalary)}
                        </td>
                        <td className="py-2 pe-2 text-debt-text">
                          {slip && adjustments > 0
                            ? formatCurrency(adjustments)
                            : isAssistant && record
                              ? "—"
                              : "—"}
                        </td>
                        <td className="py-2 pe-2 font-medium text-primary">
                          {clinicNet != null
                            ? formatCurrency(clinicNet)
                            : "—"}
                        </td>
                        <td className="py-2 pe-2 text-amber-800">
                          {isAssistant && record
                            ? `${formatCurrency(doctorShare ?? 0)} (${record.doctor_share_percentage}%)`
                            : "—"}
                        </td>
                        <td className="py-2 text-xs">
                          {isAssistant ? (
                            record ? (
                              <div className="flex flex-wrap items-center gap-2">
                                <span>
                                  {record.status === "paid" ? "مدفوع" : "مُولَّد"}
                                </span>
                                {!boardLocked && (
                                  <>
                                    <Button
                                      size="sm"
                                      variant="outline"
                                      disabled={
                                        record.status === "paid" ||
                                        Boolean(confirmingPayrollId)
                                      }
                                      onClick={() =>
                                        markAssistantPayrollPaid(record.id)
                                      }
                                    >
                                      {confirmingPayrollId === record.id
                                        ? "جاري التأكيد..."
                                        : "تأكيد الصرف"}
                                    </Button>
                                    <Button
                                      size="sm"
                                      variant="outline"
                                      className="border-amber-300 text-amber-800 hover:bg-amber-50"
                                      disabled={record.status !== "paid"}
                                      onClick={() =>
                                        unmarkAssistantPayrollPaid(record.id)
                                      }
                                    >
                                      إلغاء الصرف
                                    </Button>
                                  </>
                                )}
                              </div>
                            ) : (
                              <span className="text-amber-700">لم يُولَّد</span>
                            )
                          ) : slip ? (
                            <div className="flex flex-wrap items-center gap-2">
                              <span>
                                {slip.status === "paid" ? "مدفوع" : "مسودة"}
                              </span>
                              {!boardLocked && (
                                <>
                                  <Button
                                    size="sm"
                                    variant="outline"
                                    disabled={
                                      slip.status === "paid" ||
                                      Boolean(confirmingPayrollId)
                                    }
                                    onClick={() => markSlipPaid(slip.id)}
                                  >
                                    {confirmingPayrollId === slip.id
                                      ? "جاري التأكيد..."
                                      : "تأكيد الصرف"}
                                  </Button>
                                  <Button
                                    size="sm"
                                    variant="outline"
                                    className="border-amber-300 text-amber-800 hover:bg-amber-50"
                                    disabled={slip.status !== "paid"}
                                    onClick={() => unmarkSlipPaid(slip.id)}
                                  >
                                    إلغاء الصرف
                                  </Button>
                                </>
                              )}
                            </div>
                          ) : (
                            <span className="text-amber-700">لم يُولَّد</span>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            {!hasGeneratedPayroll && (
              <p className="mt-3 text-center text-xs text-amber-800">
                اضغط «توليد رواتب الشهر» لإنشاء قسائم موظفي العيادة
              </p>
            )}
            <div className="mt-3 flex flex-wrap gap-4 border-t border-slate-border/40 pt-3 text-sm">
              <span>
                إجمالي مصاريف العيادة:{" "}
                <strong className="text-primary">
                  {formatCurrency(payrollClinicTotal)}
                </strong>
              </span>
              <span>
                إجمالي خصم الأطباء (مساعدون فقط):{" "}
                <strong className="text-amber-800">
                  {formatCurrency(payrollDoctorTotal)}
                </strong>
              </span>
            </div>
          </>
        )}
          </>
        )}
      </Card>

      {isActivePayrollMonth && !monthClosed && (
        <Card>
          <CardHeader className="mb-0">
            <button
              type="button"
              onClick={() => setShowAddEmployee((v) => !v)}
              className="flex w-full items-start gap-2 text-right hover:opacity-90"
              aria-expanded={showAddEmployee}
            >
              <ChevronDown
                className={cn(
                  "mt-1 h-5 w-5 shrink-0 text-slate-muted transition-transform",
                  showAddEmployee && "rotate-180"
                )}
              />
              <div className="min-w-0 flex-1">
                <CardTitle className="text-right">
                  إضافة موظف ({activePayrollCount} نشط)
                </CardTitle>
                <p className="text-xs text-slate-muted">
                  {showAddEmployee
                    ? "نموذج إضافة موظف جديد"
                    : "اضغط لعرض نموذج إضافة موظف"}
                </p>
              </div>
            </button>
          </CardHeader>
          {showAddEmployee && (
          <form onSubmit={addStaff} className="mt-4 space-y-4 border-t border-slate-border/40 pt-4">
            <div>
              <p className="mb-2 text-sm font-medium text-slate-text">نوع الموظف</p>
              <div className="flex flex-wrap gap-4">
                <label className="flex cursor-pointer items-center gap-2 text-sm">
                  <input
                    type="radio"
                    name="employeeType"
                    checked={employeeType === "general"}
                    onChange={() => setEmployeeType("general")}
                    className="text-primary"
                  />
                  موظف عام / خدمات
                </label>
                <label className="flex cursor-pointer items-center gap-2 text-sm">
                  <input
                    type="radio"
                    name="employeeType"
                    checked={employeeType === "assistant"}
                    onChange={() => setEmployeeType("assistant")}
                    className="text-primary"
                  />
                  مساعد طبيب
                </label>
              </div>
            </div>

            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              <Input
                label="الاسم"
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                required
              />
              <CurrencyInput
                label={
                  (employeeType === "assistant" &&
                    assistantCompMode === "daily_wage") ||
                  (employeeType === "general" && generalCompMode === "daily_wage")
                    ? "الراتب الشهري (غير مطلوب)"
                    : "الراتب الشهري"
                }
                value={newSalary}
                onChange={setNewSalary}
                placeholder={
                  (employeeType === "assistant" &&
                    assistantCompMode === "daily_wage") ||
                  (employeeType === "general" && generalCompMode === "daily_wage")
                    ? "—"
                    : "600,000"
                }
                required={
                  !(
                    (employeeType === "assistant" &&
                      assistantCompMode === "daily_wage") ||
                    (employeeType === "general" && generalCompMode === "daily_wage")
                  )
                }
                disabled={
                  (employeeType === "assistant" &&
                    assistantCompMode === "daily_wage") ||
                  (employeeType === "general" && generalCompMode === "daily_wage")
                }
              />
              {employeeType === "general" && (
                <div className="sm:col-span-2">
                  <p className="mb-2 text-sm font-medium text-slate-text">
                    نظام التعويض
                  </p>
                  <div className="flex flex-wrap gap-4">
                    <label className="flex cursor-pointer items-center gap-2 text-sm">
                      <input
                        type="radio"
                        name="generalCompMode"
                        checked={generalCompMode === "monthly_fixed"}
                        onChange={() => setGeneralCompMode("monthly_fixed")}
                        className="text-primary"
                      />
                      راتب شهري ثابت
                    </label>
                    <label className="flex cursor-pointer items-center gap-2 text-sm">
                      <input
                        type="radio"
                        name="generalCompMode"
                        checked={generalCompMode === "daily_wage"}
                        onChange={() => setGeneralCompMode("daily_wage")}
                        className="text-primary"
                      />
                      أجر يومي متغير
                    </label>
                  </div>
                </div>
              )}
              {employeeType === "assistant" && (
                <div className="sm:col-span-2">
                  <p className="mb-2 text-sm font-medium text-slate-text">
                    نظام التعويض
                  </p>
                  <div className="flex flex-wrap gap-4">
                    <label className="flex cursor-pointer items-center gap-2 text-sm">
                      <input
                        type="radio"
                        name="assistantCompMode"
                        checked={assistantCompMode === "monthly_fixed"}
                        onChange={() => setAssistantCompMode("monthly_fixed")}
                        className="text-primary"
                      />
                      راتب شهري ثابت
                    </label>
                    <label className="flex cursor-pointer items-center gap-2 text-sm">
                      <input
                        type="radio"
                        name="assistantCompMode"
                        checked={assistantCompMode === "daily_wage"}
                        onChange={() => setAssistantCompMode("daily_wage")}
                        className="text-primary"
                      />
                      أجر يومي متغير
                    </label>
                  </div>
                </div>
              )}
              {employeeType === "general" ? (
                <Input
                  label="الوظيفة"
                  value={newJob}
                  onChange={(e) => setNewJob(e.target.value)}
                  placeholder="موظف خدمات"
                />
              ) : (
                <>
                  <Select
                    label="الطبيب المسؤول"
                    value={doctorId}
                    onChange={(e) => setDoctorId(e.target.value)}
                    options={doctors.map((d) => ({
                      value: d.id,
                      label: d.full_name_ar,
                    }))}
                    placeholder="اختر الطبيب"
                    required
                  />
                  <Input
                    label="نسبة تحمّل الطبيب (%)"
                    type="number"
                    min={0}
                    max={100}
                    value={doctorSharePct}
                    onChange={(e) => setDoctorSharePct(e.target.value)}
                    dir="ltr"
                  />
                </>
              )}
            </div>

            <p className="text-xs text-slate-muted">
              {employeeType === "general"
                ? generalCompMode === "daily_wage"
                  ? "موظف بأجر يومي — سجّل كل يوم من النموذج، ثم «توليد رواتب الشهر» و«تأكيد الصرف»."
                  : "الراتب كاملاً من مصاريف تشغيل العيادة — لا يُخصم من أي طبيب."
                : assistantCompMode === "daily_wage"
                  ? "مساعد بأجر يومي — سجّل كل يوم من النموذج، يُجمع الشهر ثم يُخصم عند التوليد والتأكيد."
                  : "يُقسّم الراتب بين الطبيب والعيادة حسب النسبة عند توليد الرواتب."}
            </p>

            <Button type="submit" size="sm" disabled={addingStaff}>
              {addingStaff ? "جاري الإضافة..." : "إضافة موظف"}
            </Button>
          </form>
          )}
        </Card>
      )}

      <div className="grid gap-6 lg:grid-cols-2">
        <div ref={payrollEntryFormRef}>
        <Card>
          <CardHeader>
            <CardTitle>
              تسجيل حركات الراتب — {formatMonthYearAr(workMonth)}
            </CardTitle>
            <p className="text-xs text-slate-600">
              {payrollEntryFormSubtitle(payrollEntryTypes)}
            </p>
            {isDailyWageSelected && (
              <p className="text-xs text-teal-800">
                {isDailyStaffSelected
                  ? "لكل يوم عمل: اختر «أجر يومي»، اكتب المبلغ، وحدّد تاريخ ذلك اليوم. ثم «توليد رواتب الشهر» و«تأكيد الصرف»."
                  : "لكل يوم عمل: اختر «أجر يومي»، اكتب المبلغ (مثلاً 15,000 أو 10,000)، وحدّد تاريخ ذلك اليوم."}
              </p>
            )}
          </CardHeader>
          {isDoctorSalarySelected ? (
            <p className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-4 text-sm text-amber-900">
              سلفة وخصم ومكافأة طبيب الراتب الثابت من النموذج المخصص أعلاه.
            </p>
          ) : (
            <form
              noValidate
              onSubmit={(e) => {
                e.preventDefault();
                void handleEmployeeEntry();
              }}
              className="space-y-4"
            >
              {selectedPerson ? (
                <div className="rounded-lg border border-slate-border bg-slate-50 px-3 py-2 text-sm">
                  <span className="text-slate-muted">الموظف المختار: </span>
                  <strong>{selectedPerson.full_name_ar}</strong>
                  {!isDailyWageSelected && (
                    <>
                      <span className="mx-2 text-slate-muted">·</span>
                      <span>{formatCurrency(selectedPerson.base_salary)}</span>
                    </>
                  )}
                  {isDailyWageSelected && (
                    <span className="mr-2 rounded-full bg-sky-100 px-2 py-0.5 text-xs text-sky-800">
                      أجر يومي
                    </span>
                  )}
                </div>
              ) : (
                <p className="rounded-lg border border-dashed border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-900">
                  اختر موظفاً من القائمة الشاملة أعلاه أولاً
                </p>
              )}

              {isStaffSelected && !isDailyStaffSelected && (
                <Alert variant="info">
                  هذا الموظف على <strong>راتب شهري ثابت</strong> — خيار «أجر يومي»
                  لا يظهر إلا بعد التحويل. اضغط <strong>تعديل الراتب</strong> أعلاه
                  واختر <strong>أجر يومي متغير</strong>، ثم ارجع وسجّل كل يوم من هنا.
                </Alert>
              )}

              {isAssistantSelected && !isDailyAssistantSelected && (
                <Alert variant="info">
                  هذا المساعد على <strong>راتب شهري ثابت</strong> — خيار «أجر يومي»
                  لا يظهر إلا بعد التحويل. اضغط <strong>تعديل الراتب</strong> أعلاه
                  واختر <strong>أجر يومي متغير</strong>، ثم ارجع وسجّل كل يوم من هنا.
                </Alert>
              )}

              <Select
                label="نوع الحركة"
                value={entryType}
                onChange={(e) => setEntryType(e.target.value)}
                options={activeEmployeeEntryTypes}
              />

              <CurrencyInput
                label={
                  entryType === "daily_wage" ? "أجر هذا اليوم" : "المبلغ"
                }
                value={amount}
                onChange={setAmount}
                placeholder={
                  entryType === "daily_wage" ? "15,000" : "500,000"
                }
              />

              {dailyWageEntryPreview && (
                <div className="space-y-1 rounded-lg border border-teal-200 bg-teal-50 px-3 py-2.5 text-xs text-teal-900">
                  <p className="font-medium">
                    تقسيم أجر اليوم ({formatCurrency(dailyWageEntryPreview.totalSalary)})
                    {selectedPerson?.doctor_name_ar
                      ? ` — د. ${selectedPerson.doctor_name_ar}`
                      : ""}
                  </p>
                  <p>
                    الطبيب يتحمل {dailyWageEntryPreview.doctorSharePercentage}% ={" "}
                    <strong>{formatCurrency(dailyWageEntryPreview.doctorShare)}</strong>
                  </p>
                  <p>
                    العيادة تتحمل {100 - dailyWageEntryPreview.doctorSharePercentage}% ={" "}
                    <strong>{formatCurrency(dailyWageEntryPreview.clinicShare)}</strong>
                  </p>
                  <p className="text-teal-700">
                    يُجمع مع أيام الشهر ثم يُخصم عند توليد الرواتب وتأكيد الصرف.
                  </p>
                </div>
              )}

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
                label={salaryReasonFieldLabel(entryType)}
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                placeholder={salaryReasonPlaceholder(entryType)}
                required={isSalaryReasonRequired(entryType)}
              />

              {entryFeedback && !isDoctorSalarySelected && (
                <Alert variant={entryFeedback.ok ? "success" : "error"}>
                  {entryFeedback.text}
                </Alert>
              )}

              {netAfterPending != null && (
                <p className="rounded-lg border border-primary/20 bg-primary/5 px-3 py-2 text-sm">
                  {isDailyWageSelected && entryType === "daily_wage"
                    ? "مجموع أجر الشهر بعد هذه الحركة"
                    : "صافي الراتب بعد هذه الحركة"}
                  :{" "}
                  <strong className="text-primary">
                    {formatCurrency(netAfterPending)}
                  </strong>
                  {dailyWageEntryPreview && (
                    <span className="mt-1 block text-xs text-slate-600">
                      (شامل هذا اليوم — الطبيب{" "}
                      {formatCurrency(dailyWageEntryPreview.doctorShare)} · العيادة{" "}
                      {formatCurrency(dailyWageEntryPreview.clinicShare)})
                    </span>
                  )}
                </p>
              )}

              <Button
                type="button"
                className="w-full bg-teal-600 hover:bg-teal-700"
                disabled={saving}
                onClick={() => void handleEmployeeEntry()}
              >
                {saving
                  ? "جاري الحفظ..."
                  : entrySubmitLabel(entryType)}
              </Button>
              {employeeEntryBlockReason ? (
                <p className="text-center text-xs text-amber-800">
                  تنبيه: {employeeEntryBlockReason}
                </p>
              ) : !selectedPerson || (!staffId && !assistantId) ? (
                <p className="text-center text-xs text-amber-800">
                  اختر موظفاً أو مساعداً من القائمة أعلاه أولاً
                </p>
              ) : isDailyWageSelected && slipConfirmedAmount > 0 && slipPendingAmount > 0 ? (
                <p className="text-center text-xs text-teal-800">
                  مُؤكَّد {formatCurrency(slipConfirmedAmount)} — المتبقي{" "}
                  {formatCurrency(slipPendingAmount)} يُجمَع في الجدول ويُخصم عند «تأكيد
                  الصرف» فقط
                </p>
              ) : isDailyWageSelected && entryType === "daily_wage" ? (
                <p className="text-center text-xs text-teal-800">
                  مثال: اليوم 15,000 — غداً 10,000 (سجّل كل يوم بحركة منفصلة)
                </p>
              ) : (
                <p className="text-center text-xs text-slate-muted">
                  يُحدَّث صافي الراتب وقسيمة الشهر تلقائياً
                </p>
              )}
            </form>
          )}
        </Card>
        </div>

        <Card>
          <CardHeader>
            <CardTitle>
              {isAssistantSelected ? "راتب مساعد" : "قسيمة راتب"} —{" "}
              {formatMonthYearAr(workMonth)}
            </CardTitle>
          </CardHeader>
          {isAssistantSelected ? (
            <>
              {selectedAssistantRecord ? (
                <div className="space-y-3 rounded-lg bg-surface p-4 text-sm">
                  {!isDailyAssistantSelected && (
                    <div className="flex justify-between">
                      <span>الراتب الأساسي</span>
                      <span>{formatCurrency(selectedPerson?.base_salary ?? 0)}</span>
                    </div>
                  )}
                  {dailyWages > 0 && (
                    <div className="flex justify-between text-teal-800">
                      <span>+ أيام العمل</span>
                      <span>{formatCurrency(dailyWages)}</span>
                    </div>
                  )}
                  {advances > 0 && (
                    <div className="flex justify-between text-debt-text">
                      <span>− سلف</span>
                      <span>{formatCurrency(advances)}</span>
                    </div>
                  )}
                  {deductions > 0 && (
                    <div className="flex justify-between text-debt-text">
                      <span>− خصومات</span>
                      <span>{formatCurrency(deductions)}</span>
                    </div>
                  )}
                  {bonuses > 0 && (
                    <div className="flex justify-between text-emerald-700">
                      <span>+ مكافآت</span>
                      <span>{formatCurrency(bonuses)}</span>
                    </div>
                  )}
                  <div className="flex justify-between font-bold text-primary">
                    <span>صافي الراتب</span>
                    <span>{formatCurrency(netPreview)}</span>
                  </div>
                  <hr className="border-slate-border" />
                  <div className="flex justify-between">
                    <span>الراتب المُولَّد (بعد الحركات)</span>
                    <span>{formatCurrency(selectedAssistantRecord.total_salary)}</span>
                  </div>
                  <div className="flex justify-between text-primary">
                    <span>حصة العيادة</span>
                    <span>{formatCurrency(selectedAssistantRecord.clinic_share_amount)}</span>
                  </div>
                  <div className="flex justify-between text-amber-800">
                    <span>حصة الطبيب ({selectedAssistantRecord.doctor_share_percentage}%)</span>
                    <span>{formatCurrency(selectedAssistantRecord.doctor_share_amount)}</span>
                  </div>
                  <hr className="border-slate-border" />
                  <p className="text-xs text-slate-muted">
                    الحالة:{" "}
                    {slipFullySettled && slipPendingAmount <= 0
                      ? "مُؤكَّد بالكامل"
                      : slipConfirmedAmount > 0
                        ? `مُؤكَّد ${formatCurrency(slipConfirmedAmount)} — متبقٍ ${formatCurrency(slipPendingAmount)}`
                        : "مُولَّد"}
                  </p>
                  {!boardLocked && (
                    <div className="flex flex-wrap gap-2">
                      <Button
                        type="button"
                        className="flex-1 min-w-[10rem]"
                        disabled={
                          !canConfirmPayroll || Boolean(confirmingPayrollId)
                        }
                        onClick={() =>
                          markAssistantPayrollPaid(selectedAssistantRecord.id)
                        }
                      >
                        {confirmingPayrollId === selectedAssistantRecord.id
                          ? "جاري التأكيد..."
                          : canConfirmPayroll
                            ? `تأكيد الصرف — ${formatCurrency(slipPendingAmount)}`
                            : "مُؤكَّد بالكامل"}
                      </Button>
                      <Button
                        type="button"
                        variant="outline"
                        className="flex-1 min-w-[10rem] border-amber-300 text-amber-800 hover:bg-amber-50"
                        disabled={!canUnconfirmPayroll}
                        onClick={() =>
                          unmarkAssistantPayrollPaid(selectedAssistantRecord.id)
                        }
                      >
                        إلغاء آخر تأكيد
                      </Button>
                    </div>
                  )}
                </div>
              ) : (
                <div className="space-y-3">
                  <p className="rounded-lg border border-dashed border-slate-border px-4 py-4 text-center text-sm text-slate-muted">
                    لا يوجد سجل راتب لهذا المساعد في {formatMonthYearAr(workMonth)}
                  </p>
                  <Button
                    type="button"
                    disabled={generatingPayroll || boardLocked || !clinicId}
                    onClick={handleGenerateMonthlyPayroll}
                    className="w-full bg-teal-600 hover:bg-teal-700"
                  >
                    {generatingPayroll ? "جاري التوليد..." : "توليد رواتب الشهر"}
                  </Button>
                </div>
              )}
            </>
          ) : (
            <>
              <p className="mb-3 rounded-lg bg-slate-50 px-3 py-2 text-xs text-slate-muted">
                {isDoctorSalarySelected
                  ? "طبيب راتب ثابت — الصرف من مصاريف العيادة. الجلسات لا تدخل محفظة الطبيب."
                  : "موظف خدمات — الراتب كامل من مصاريف تشغيل العيادة، بدون ربط بطبيب."}
              </p>
              {staffSlipThisMonth && slipFullySettled && slipPendingAmount <= 0 && (
                <p className="mb-3 rounded-lg bg-emerald-50 px-3 py-2 text-sm text-emerald-800">
                  ✓ قسيمة{" "}
                  {selectedStaff?.full_name_ar ?? selectedPerson?.full_name_ar}{" "}
                  لهذا الشهر <strong>مدفوعة بالكامل</strong>.
                </p>
              )}
              {staffSlipThisMonth && slipConfirmedAmount > 0 && slipPendingAmount > 0 && (
                <p className="mb-3 rounded-lg bg-teal-50 px-3 py-2 text-sm text-teal-800">
                  مُؤكَّد {formatCurrency(slipConfirmedAmount)} — المتبقي{" "}
                  {formatCurrency(slipPendingAmount)} يُخصم عند «تأكيد الصرف» فقط
                </p>
              )}
              <div className="space-y-3 rounded-lg bg-surface p-4 text-sm">
                <div className="flex justify-between">
                  <span>الراتب الأساسي</span>
                  <span>
                    {formatCurrency(
                      selectedStaff?.base_salary ??
                        selectedPerson?.base_salary ??
                        0
                    )}
                  </span>
                </div>
                <div className="flex justify-between text-debt-text">
                  <span>− سلف {formatMonthYearAr(workMonth)}</span>
                  <span>{formatCurrency(advances)}</span>
                </div>
                <div className="flex justify-between text-debt-text">
                  <span>− خصومات {formatMonthYearAr(workMonth)}</span>
                  <span>{formatCurrency(deductions)}</span>
                </div>
                {bonuses > 0 && (
                  <div className="flex justify-between text-emerald-700">
                    <span>+ مكافآت {formatMonthYearAr(workMonth)}</span>
                    <span>{formatCurrency(bonuses)}</span>
                  </div>
                )}
                <hr className="border-slate-border" />
                <div className="flex justify-between text-lg font-bold text-primary">
                  <span>صافي الصرف</span>
                  <span>{formatCurrency(netPreview)}</span>
                </div>
              </div>
              <div className="mt-4 flex flex-wrap gap-2">
                <Button
                  onClick={generateSlip}
                  disabled={
                    (!staffId && !doctorSalaryId) ||
                    saving ||
                    slipBlocksNewEntries ||
                    boardLocked
                  }
                >
                  {boardLocked
                    ? "شهر مُغلق"
                    : slipBlocksNewEntries
                      ? "مُسلَّمة"
                      : saving
                        ? "جاري الإنشاء..."
                        : "إنشاء / تحديث قسيمة"}
                </Button>
                {staffSlipThisMonth && !boardLocked && (
                  <>
                    <Button
                      type="button"
                      variant="outline"
                      disabled={
                        !canConfirmPayroll || Boolean(confirmingPayrollId)
                      }
                      onClick={() => markSlipPaid(staffSlipThisMonth.id)}
                    >
                      {confirmingPayrollId === staffSlipThisMonth.id
                        ? "جاري التأكيد..."
                        : canConfirmPayroll
                          ? `تأكيد الصرف — ${formatCurrency(slipPendingAmount)}`
                          : "مُؤكَّد بالكامل"}
                    </Button>
                    <Button
                      type="button"
                      variant="outline"
                      className="border-amber-300 text-amber-800 hover:bg-amber-50"
                      disabled={!canUnconfirmPayroll}
                      onClick={() => unmarkSlipPaid(staffSlipThisMonth.id)}
                    >
                      إلغاء آخر تأكيد
                    </Button>
                  </>
                )}
              </div>
            </>
          )}
        </Card>
      </div>

      {entries.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>حركات {formatMonthYearAr(workMonth)}</CardTitle>
          </CardHeader>
          <ul className="space-y-2 text-sm">
            {entries.map((e) => {
              const isBonus = e.entry_type === "bonus";
              const typeLabel =
                entryTypeLabels.find((t) => t.value === e.entry_type)?.label ??
                e.entry_type;
              return (
                <li
                  key={e.id}
                  className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-border/40 py-2"
                >
                  <span className="min-w-0 flex-1">
                    {typeLabel} — {e.entry_date}
                    {e.notes_ar ? (
                      <span className="block text-xs text-slate-muted">
                        {isSalaryReasonRequired(e.entry_type)
                          ? `السبب: ${e.notes_ar}`
                          : e.notes_ar}
                      </span>
                    ) : null}
                  </span>
                  <div className="flex items-center gap-2">
                    <span
                      className={`font-medium ${isBonus ? "text-emerald-700" : ""}`}
                    >
                      {isBonus ? "+" : "−"}
                      {formatCurrency(e.amount)}
                    </span>
                    {!boardLocked && (
                      <Button
                        type="button"
                        size="sm"
                        variant="outline"
                        onClick={() => setEditingEntry(e)}
                      >
                        تعديل
                      </Button>
                    )}
                  </div>
                </li>
              );
            })}
          </ul>
        </Card>
      )}

      {entries.length === 0 &&
        !slipPaid &&
        (isStaffSelected || isAssistantSelected || isDoctorSalarySelected) && (
          <p className="text-center text-sm text-slate-muted">
            لا حركات لـ {formatMonthYearAr(workMonth)} —{" "}
            {isDoctorSalarySelected
              ? `سجّل حركات الراتب (${formatPayrollEntryTypesList(EMPLOYEE_PAYROLL_ENTRY_TYPES)}) من النموذج أعلاه.`
              : isDailyWageSelected
                ? `سجّل حركات الراتب (${formatPayrollEntryTypesList(DAILY_ASSISTANT_PAYROLL_ENTRY_TYPES)}) من النموذج أعلاه.`
                : `سجّل حركات الراتب (${formatPayrollEntryTypesList(EMPLOYEE_PAYROLL_ENTRY_TYPES)})، أو أنشئ قسيمة بالراتب الأساسي فقط.`}
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
                    {slipDisplayName(slip, payrollPersons)}
                  </p>
                  <p className="text-sm text-primary">
                    {formatCurrency(slip.net_payout)}
                  </p>
                  <p className="text-xs text-slate-muted">
                    {slip.status === "paid" ? "مدفوع ✓" : "مسودة — لم يُخصم من الربح بعد"}
                  </p>
                </div>
                <div className="flex flex-wrap gap-2">
                  <Button
                    size="sm"
                    disabled={
                      slip.status === "paid" ||
                      boardLocked ||
                      Boolean(confirmingPayrollId)
                    }
                    onClick={() => markSlipPaid(slip.id)}
                  >
                    {confirmingPayrollId === slip.id
                      ? "جاري التأكيد..."
                      : "تأكيد الصرف"}
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    className="border-amber-300 text-amber-800 hover:bg-amber-50"
                    disabled={slip.status !== "paid" || boardLocked}
                    onClick={() => unmarkSlipPaid(slip.id)}
                  >
                    إلغاء الصرف
                  </Button>
                </div>
              </li>
            ))}
          </ul>
        </Card>
      )}

      {editingPerson && (
        <EditEmployeeSalaryModal
          person={editingPerson}
          onClose={() => setEditingPerson(null)}
          onSaved={async () => {
            await refreshAfterEmployeeChange(selectedKey);
            showMessage(`تم تحديث راتب ${editingPerson.full_name_ar}`, true);
          }}
        />
      )}

      {deactivatingPerson && (
        <DeactivateEmployeeDialog
          person={deactivatingPerson}
          onClose={() => setDeactivatingPerson(null)}
          onDeactivated={async () => {
            const name = deactivatingPerson.full_name_ar;
            setSelectedKey("");
            setSelectedPerson(null);
            await refreshAfterEmployeeChange();
            showMessage(`تم إيقاف ${name} — لن يظهر في الرواتب`, true);
          }}
        />
      )}

      {editingEntry && (
        <EditSalaryEntryModal
          entry={editingEntry}
          typeLabel={
            entryTypeLabels.find((t) => t.value === editingEntry.entry_type)
              ?.label ?? editingEntry.entry_type
          }
          monthFrom={monthFrom}
          monthTo={monthTo}
          boardLocked={boardLocked}
          onClose={() => setEditingEntry(null)}
          onSaved={(result) => {
            applyEntryMutationResult(result);
            const base = result.deleted ? "تم حذف الحركة" : "تم تحديث الحركة";
            showMessage(
              result.notice ? `${base} — ${result.notice}` : base,
              true
            );
          }}
        />
      )}
    </div>
  );
}
