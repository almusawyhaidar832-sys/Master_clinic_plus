import type { SupabaseClient } from "@supabase/supabase-js";
import {
  fetchClinicProfile,
  getClinicDisplayName,
  formatDoctorDisplayName,
} from "@/lib/services/clinic-profile";
import type { ClinicProfile } from "@/types/clinic-profile";
import {
  fetchClinicProfitStatsForPeriod,
  fetchDaySummary,
} from "@/lib/services/clinic-stats";
import {
  fetchRefundsForReport,
  fetchTotalRefundsAmount,
} from "@/lib/services/session-refunds";
import {
  doctorPaymentLabel,
  normalizeDoctorPaymentType,
  resolveDoctorPeriodEarned,
} from "@/lib/services/doctor-payment";
import type { DoctorPaymentType } from "@/types";
import {
  buildAssistantPayrollLines,
  buildAssistantPayrollLinesFromRecords,
  computeDoctorMonthlySettlement,
  doctorShareFromExpense,
  type DoctorMonthlySettlement,
} from "@/lib/services/assistant-payroll";
import { fetchPayrollRecordsForDoctorMonth } from "@/lib/services/assistant-payroll-records";
import {
  resolveSalaryEntryPerson,
  SALARY_ENTRY_TYPE_LABELS,
  fetchDoctorMonthSalaryBreakdown,
  fetchDoctorSalaryBreakdownsBatch,
  enrichSettlementWithSalaryBreakdown,
  type DoctorMonthSalaryBreakdown,
} from "@/lib/services/salary-entry-display";
import {
  calcOperationEarned,
  computeEarningsFromOperationsForDoctors,
  computeSalaryDoctorWithdrawable,
  fetchDoctorSalaryPayoutRecords,
  fetchDoctorSalaryPayoutsByDoctor,
  fetchDoctorWalletStatsBatch,
  fetchOperationCountsByDoctor,
  fetchWithdrawalSumsByDoctor,
  filterWithdrawalsInPeriod,
  withdrawalEffectiveDate,
  type DoctorWalletStats,
} from "@/lib/services/doctor-wallet";
import {
  type DoctorWithdrawalLine,
  withdrawalSourceLabel,
} from "@/lib/withdrawals/display";
import { isSalaryDoctor } from "@/lib/services/doctor-payment";
import { currentMonthYear, monthDateRange, todayISO } from "@/lib/utils";
import type { ConfirmedPayrollPayoutLine } from "@/lib/services/payroll-paid-portions";
import { fetchConfirmedPayrollPayoutLines } from "@/lib/services/payroll-paid-portions";
import {
  labDetailsFromOperation,
  sumMaterialsCosts,
} from "@/lib/invoices/lab-session-details";

function mapWithdrawalLine(
  row: {
    id: string;
    doctor_id: string;
    amount: number | string;
    status: string;
    source?: string | null;
    requested_at: string;
    processed_at?: string | null;
    doctor?: { full_name_ar: string } | { full_name_ar: string }[] | null;
  },
  doctorNameOverride?: string
): DoctorWithdrawalLine {
  return {
    id: row.id,
    doctorId: row.doctor_id,
    doctorName:
      doctorNameOverride ??
      formatDoctorDisplayName(
        relationName(
          row.doctor as { full_name_ar: string } | { full_name_ar: string }[]
        ) || "طبيب"
      ),
    amount: Number(row.amount ?? 0),
    status: row.status,
    source: withdrawalSourceLabel(row.source),
    effectiveDate: withdrawalEffectiveDate(row),
  };
}

async function fetchClinicMonthWithdrawalLines(
  supabase: SupabaseClient,
  clinicId: string | undefined,
  from: string,
  to: string
): Promise<DoctorWithdrawalLine[]> {
  if (!clinicId) return [];

  let res = await supabase
    .from("doctor_withdrawals")
    .select(
      "id, doctor_id, amount, status, source, requested_at, processed_at, doctor:doctors!doctor_id(full_name_ar)"
    )
    .eq("clinic_id", clinicId)
    .neq("status", "rejected")
    .order("requested_at", { ascending: false });

  if (res.error?.message?.includes("source")) {
    res = await supabase
      .from("doctor_withdrawals")
      .select(
        "id, doctor_id, amount, status, requested_at, processed_at, doctor:doctors!doctor_id(full_name_ar)"
      )
      .eq("clinic_id", clinicId)
      .neq("status", "rejected")
      .order("requested_at", { ascending: false });
  }

  if (res.error) return [];

  return filterWithdrawalsInPeriod(res.data ?? [], { from, to }).map((row) =>
    mapWithdrawalLine(row as Parameters<typeof mapWithdrawalLine>[0])
  );
}

function relationName(
  rel: { full_name_ar: string } | { full_name_ar: string }[] | null | undefined
): string | undefined {
  if (!rel) return undefined;
  return Array.isArray(rel) ? rel[0]?.full_name_ar : rel.full_name_ar;
}

export interface DoctorLedgerSummary {
  id: string;
  full_name_ar: string;
  specialty_ar: string | null;
  percentage: string;
  payment_type: DoctorPaymentType;
  salary_amount: number;
  paymentLabel: string;
  /** مستحق الفترة (شهر التقرير عند التحديد) */
  totalEarned: number;
  /** إجمالي المسحوب / المُصرف — كل الفترات */
  totalWithdrawn: number;
  /** مسحوب أو راتب مُصرف خلال شهر التقرير فقط */
  monthWithdrawn: number;
  pendingWithdrawalAmount: number;
  withdrawableBalance: number;
  /** الرصيد المحاسبي — يطابق تطبيق الطبيب */
  availableBalance: number;
  operationsCount: number;
}

export interface MasterClinicReport {
  generatedAt: string;
  clinicProfile: ClinicProfile | null;
  clinicName: string;
  periodLabel: string;
  monthYear: string;
  summary: {
    totalRevenue: number;
    totalClinicShare: number;
    generalExpenses: number;
    staffSalaries: number;
    doctorPayouts: number;
    outstandingDebts: number;
    netProfit: number;
    totalRefunds: number;
    cashInflow: number;
    reviewFees: number;
  };
  /** ملخص يوم واحد — اليوم الحالي إن كان التقرير للشهر الجاري، وإلا آخر يوم في الشهر */
  today: {
    operationsCount: number;
    totalCollected: number;
    totalRemainingDebt: number;
    date: string;
    label: string;
  };
  isCurrentMonthReport: boolean;
  month: {
    operationsCount: number;
    totalCollected: number;
    totalRemainingDebt: number;
    totalBilled: number;
  };
  doctors: DoctorLedgerSummary[];
  pendingWithdrawals: {
    id: string;
    doctorName: string;
    amount: number;
    requested_at: string;
  }[];
  expenses: {
    description_ar: string;
    amount: number;
    expense_date: string;
  }[];
  salaryAdvances: {
    personName: string;
    personCategory: string;
    jobTitle: string;
    entryType: string;
    amount: number;
    entry_date: string;
    notes: string | null;
  }[];
  /** صرف رواتب مؤكَّد — حركات مالية (مو كتابة الاستحقاق) */
  confirmedPayrollPayouts: ConfirmedPayrollPayoutLine[];
  monthWithdrawals: DoctorWithdrawalLine[];
  monthOperations: {
    operation_date?: string;
    operation_name_ar?: string;
    operation_type?: string;
    patientName: string;
    doctorName: string;
    total_amount: number;
    paid_amount: number;
    remaining_debt: number;
    materials_cost: number;
    lab_notes: string | null;
  }[];
  /** ملخص تكاليف المختبر — للعرض فقط (لا يُضاف للإيرادات) */
  labCostsSummary: {
    totalMaterialsCost: number;
    sessionsWithLab: number;
  };
  refunds: {
    id: string;
    patientName: string;
    amount: number;
    doctorName: string;
    date: string;
    reason: string;
  }[];
}

function getMonthBounds(monthYear?: string) {
  const my = monthYear ?? currentMonthYear();
  const [y, m] = my.split("-").map(Number);
  const start = `${y}-${String(m).padStart(2, "0")}-01`;
  const lastDay = new Date(y, m, 0).getDate();
  const end = `${y}-${String(m).padStart(2, "0")}-${String(lastDay).padStart(2, "0")}`;
  return { start, end, my };
}

/** مستحق راتب ثابت للشهر — لا يُفترض الراتب الكامل إن لم تُسجَّل حركة في الفترة */
function resolveSalaryDoctorPeriodEarned(
  breakdown: DoctorMonthSalaryBreakdown | undefined,
  periodScoped: boolean,
  salaryPaidMonth: number,
  opsCount: number,
  baseSalary: number
): number {
  if (!periodScoped) {
    return breakdown?.netPayout ?? baseSalary;
  }
  if (salaryPaidMonth > 0) return salaryPaidMonth;
  const hasSlip = Boolean(breakdown?.slipStatus);
  const hasEntries = (breakdown?.entries.length ?? 0) > 0;
  if (!hasSlip && !hasEntries && opsCount === 0) return 0;
  return breakdown?.netPayout ?? 0;
}

/** رصيد السحب الحالي — مستقل عن شهر التقرير (يطابق محفظة الطبيب) */
function resolveDoctorCurrentBalances(
  wallet: DoctorWalletStats | undefined,
  withdrawalsAll: { pendingWithdrawalAmount?: number } | undefined,
  salaryFallback?: { earned: number; paidAll: number }
): Pick<
  DoctorLedgerSummary,
  "withdrawableBalance" | "availableBalance" | "pendingWithdrawalAmount"
> {
  const pendingWithdrawalAmount =
    wallet?.pendingAmount ?? withdrawalsAll?.pendingWithdrawalAmount ?? 0;
  const withdrawableBalance =
    wallet?.withdrawableLimit ??
    (salaryFallback
      ? computeSalaryDoctorWithdrawable(
          salaryFallback.earned,
          salaryFallback.paidAll
        )
      : 0);
  return {
    withdrawableBalance,
    availableBalance: wallet?.availableBalance ?? withdrawableBalance,
    pendingWithdrawalAmount,
  };
}

/** طبيب له نشاط فعلي ضمن شهر التقرير */
export function doctorLedgerHasPeriodActivity(
  ledger: DoctorLedgerSummary,
  options?: { withdrawalsInPeriod?: number }
): boolean {
  return (
    ledger.operationsCount > 0 ||
    ledger.monthWithdrawn > 0 ||
    ledger.totalEarned > 0 ||
    (options?.withdrawalsInPeriod ?? 0) > 0
  );
}

export async function fetchDoctorLedgers(
  supabase: SupabaseClient,
  monthYear?: string
): Promise<DoctorLedgerSummary[]> {
  const { start, end } = getMonthBounds(monthYear);
  const periodScoped = Boolean(monthYear);
  const { getActiveClinicId } = await import("@/lib/clinic-context");
  const active = await getActiveClinicId(supabase);
  if (!active?.clinicId) return [];

  const { data: doctors } = await supabase
    .from("doctors")
    .select("*")
    .eq("clinic_id", active.clinicId)
    .eq("is_active", true)
    .order("full_name_ar");

  if (!doctors?.length) return [];

  const doctorIds = doctors.map((d) => d.id as string);
  const salaryPeriod = periodScoped
    ? { from: start, to: end }
    : monthDateRange(currentMonthYear());

  const salaryDoctorMeta = doctors
    .filter((d) => isSalaryDoctor({ payment_type: d.payment_type }))
    .map((d) => ({
      id: d.id as string,
      base: Number(d.salary_amount ?? 0),
    }));
  const salaryByDoctor = new Map(
    salaryDoctorMeta.map((d) => [d.id, d.base] as const)
  );
  const salaryBreakdowns =
    periodScoped && salaryDoctorMeta.length > 0
      ? await fetchDoctorSalaryBreakdownsBatch(
          supabase,
          active.clinicId,
          salaryDoctorMeta.map((d) => d.id),
          monthYear ?? currentMonthYear(),
          salaryByDoctor
        )
      : new Map();

  const [
    periodEarningsMap,
    opsCountMap,
    withdrawalSumsAll,
    withdrawalSumsMonth,
    walletLifetime,
    salaryPayoutsAll,
    salaryPayoutsMonth,
  ] = await Promise.all([
    computeEarningsFromOperationsForDoctors(
      supabase,
      doctorIds,
      periodScoped ? start : undefined,
      periodScoped ? end : undefined
    ),
    fetchOperationCountsByDoctor(
      supabase,
      active.clinicId,
      doctorIds,
      periodScoped ? { from: start, to: end } : undefined
    ),
    fetchWithdrawalSumsByDoctor(supabase, doctorIds),
    periodScoped
      ? fetchWithdrawalSumsByDoctor(supabase, doctorIds, { from: start, to: end })
      : Promise.resolve(new Map()),
    fetchDoctorWalletStatsBatch(supabase, doctorIds),
    fetchDoctorSalaryPayoutsByDoctor(supabase, doctorIds),
    fetchDoctorSalaryPayoutsByDoctor(
      supabase,
      doctorIds,
      salaryPeriod.from,
      salaryPeriod.to
    ),
  ]);

  return doctors.map((doc) => {
    const payment_type = normalizeDoctorPaymentType(doc.payment_type);
    const salary_amount = Number(doc.salary_amount ?? 0);
    const doctorForCalc = { payment_type, salary_amount };
    const operationsShareSum = periodEarningsMap.get(doc.id) ?? 0;
    const withdrawalsAll = withdrawalSumsAll.get(doc.id);
    const withdrawalsMonth = withdrawalSumsMonth.get(doc.id);
    const wallet = walletLifetime.get(doc.id);
    const totalEarned = resolveDoctorPeriodEarned(
      doctorForCalc,
      operationsShareSum
    );

    if (isSalaryDoctor({ payment_type })) {
      const salaryPaidAll = salaryPayoutsAll.get(doc.id) ?? 0;
      const salaryPaidMonth = salaryPayoutsMonth.get(doc.id) ?? 0;
      const breakdown = salaryBreakdowns.get(doc.id);
      const opsCount = opsCountMap.get(doc.id) ?? 0;
      const earnedNet = resolveSalaryDoctorPeriodEarned(
        breakdown,
        periodScoped,
        salaryPaidMonth,
        opsCount,
        salary_amount
      );
      return {
        id: doc.id,
        full_name_ar: doc.full_name_ar,
        specialty_ar: doc.specialty_ar,
        percentage: doc.percentage,
        payment_type,
        salary_amount,
        paymentLabel: doctorPaymentLabel({
          payment_type,
          percentage: doc.percentage,
          salary_amount,
        }),
        totalEarned: earnedNet,
        totalWithdrawn: periodScoped ? salaryPaidMonth : salaryPaidAll,
        monthWithdrawn: salaryPaidMonth,
        ...resolveDoctorCurrentBalances(wallet, withdrawalsAll, {
          earned: wallet?.totalEarnings ?? earnedNet,
          paidAll: wallet?.totalWithdrawn ?? salaryPaidAll,
        }),
        pendingWithdrawalAmount: 0,
        operationsCount: opsCount,
      };
    }

    const monthWithdrawn = withdrawalsMonth?.totalWithdrawn ?? 0;
    return {
      id: doc.id,
      full_name_ar: doc.full_name_ar,
      specialty_ar: doc.specialty_ar,
      percentage: doc.percentage,
      payment_type,
      salary_amount,
      paymentLabel: doctorPaymentLabel({
        payment_type,
        percentage: doc.percentage,
        salary_amount,
      }),
      totalEarned,
      totalWithdrawn: periodScoped
        ? monthWithdrawn
        : (withdrawalsAll?.totalWithdrawn ?? 0),
      monthWithdrawn,
      ...resolveDoctorCurrentBalances(wallet, withdrawalsAll),
      operationsCount: opsCountMap.get(doc.id) ?? 0,
    };
  });
}

/** ملخص طبيب واحد — 4 استعلامات مجمّعة بدل تحميل كل الأطباء */
export async function fetchDoctorLedgerSummary(
  supabase: SupabaseClient,
  doctorId: string,
  monthYear?: string
): Promise<DoctorLedgerSummary | undefined> {
  const { start, end } = getMonthBounds(monthYear);
  const periodScoped = Boolean(monthYear);

  const { data: doctor } = await supabase
    .from("doctors")
    .select("*")
    .eq("id", doctorId)
    .maybeSingle();

  if (!doctor) return undefined;

  const doctorIds = [doctorId];
  const salaryPeriod = periodScoped
    ? { from: start, to: end }
    : monthDateRange(currentMonthYear());

  const [
    periodEarningsMap,
    opsCountMap,
    withdrawalSumsAll,
    withdrawalSumsMonth,
    walletLifetime,
    salaryPayoutsAll,
    salaryPayoutsMonth,
  ] = await Promise.all([
    computeEarningsFromOperationsForDoctors(
      supabase,
      doctorIds,
      periodScoped ? start : undefined,
      periodScoped ? end : undefined
    ),
    fetchOperationCountsByDoctor(
      supabase,
      doctor.clinic_id as string,
      doctorIds,
      periodScoped ? { from: start, to: end } : undefined
    ),
    fetchWithdrawalSumsByDoctor(supabase, doctorIds),
    periodScoped
      ? fetchWithdrawalSumsByDoctor(supabase, doctorIds, { from: start, to: end })
      : Promise.resolve(new Map()),
    fetchDoctorWalletStatsBatch(supabase, doctorIds),
    fetchDoctorSalaryPayoutsByDoctor(supabase, doctorIds),
    fetchDoctorSalaryPayoutsByDoctor(
      supabase,
      doctorIds,
      salaryPeriod.from,
      salaryPeriod.to
    ),
  ]);

  const payment_type = normalizeDoctorPaymentType(doctor.payment_type);
  const salary_amount = Number(doctor.salary_amount ?? 0);
  const doctorForCalc = { payment_type, salary_amount };
  const withdrawalsAll = withdrawalSumsAll.get(doctorId);
  const withdrawalsMonth = withdrawalSumsMonth.get(doctorId);
  const wallet = walletLifetime.get(doctorId);
  const totalEarned = resolveDoctorPeriodEarned(
    doctorForCalc,
    periodEarningsMap.get(doctorId) ?? 0
  );

  if (isSalaryDoctor({ payment_type })) {
    const salaryPaidAll = salaryPayoutsAll.get(doctorId) ?? 0;
    const salaryPaidMonth = salaryPayoutsMonth.get(doctorId) ?? 0;
    const opsCount = opsCountMap.get(doctorId) ?? 0;
    let earnedNet = totalEarned;
    if (periodScoped && monthYear) {
      const breakdown = await fetchDoctorMonthSalaryBreakdown(
        supabase,
        doctor.clinic_id as string,
        doctorId,
        monthYear,
        salary_amount
      );
      earnedNet = resolveSalaryDoctorPeriodEarned(
        breakdown ?? undefined,
        true,
        salaryPaidMonth,
        opsCount,
        salary_amount
      );
    }
    return {
      id: doctor.id,
      full_name_ar: doctor.full_name_ar,
      specialty_ar: doctor.specialty_ar,
      percentage: doctor.percentage,
      payment_type,
      salary_amount,
      paymentLabel: doctorPaymentLabel({
        payment_type,
        percentage: doctor.percentage,
        salary_amount,
      }),
      totalEarned: earnedNet,
      totalWithdrawn: periodScoped ? salaryPaidMonth : salaryPaidAll,
      monthWithdrawn: salaryPaidMonth,
      ...resolveDoctorCurrentBalances(wallet, withdrawalsAll, {
        earned: wallet?.totalEarnings ?? earnedNet,
        paidAll: wallet?.totalWithdrawn ?? salaryPaidAll,
      }),
      pendingWithdrawalAmount: 0,
      operationsCount: opsCount,
    };
  }

  const monthWithdrawn = withdrawalsMonth?.totalWithdrawn ?? 0;
  return {
    id: doctor.id,
    full_name_ar: doctor.full_name_ar,
    specialty_ar: doctor.specialty_ar,
    percentage: doctor.percentage,
    payment_type,
    salary_amount,
    paymentLabel: doctorPaymentLabel({
      payment_type,
      percentage: doctor.percentage,
      salary_amount,
    }),
    totalEarned,
    totalWithdrawn: periodScoped
      ? monthWithdrawn
      : (withdrawalsAll?.totalWithdrawn ?? 0),
    monthWithdrawn,
    ...resolveDoctorCurrentBalances(wallet, withdrawalsAll),
    operationsCount: opsCountMap.get(doctorId) ?? 0,
  };
}

export async function fetchDoctorLedgerDetail(
  supabase: SupabaseClient,
  doctorId: string,
  monthYear?: string
) {
  const { start, end } = getMonthBounds(monthYear);
  const periodScoped = Boolean(monthYear);

  const { data: doctor } = await supabase
    .from("doctors")
    .select("*")
    .eq("id", doctorId)
    .single();

  let opsQuery = supabase
    .from("patient_operations")
    .select(
      `*, patient:patients!patient_id(full_name_ar),
       patient_treatment_cases(doctor_share_total, final_price)`
    )
    .eq("doctor_id", doctorId)
    .order("operation_date", { ascending: false })
    .limit(100);

  if (periodScoped) {
    opsQuery = opsQuery
      .gte("operation_date", start)
      .lte("operation_date", end);
  }

  let expensesQuery = supabase
    .from("doctor_expenses")
    .select("*")
    .eq("doctor_id", doctorId)
    .order("expense_date", { ascending: false });

  if (periodScoped) {
    expensesQuery = expensesQuery
      .gte("expense_date", start)
      .lte("expense_date", end);
  }

  const payrollPromise =
    periodScoped && monthYear
      ? fetchPayrollRecordsForDoctorMonth(supabase, doctorId, monthYear)
      : Promise.resolve([]);

  const assistantsFallbackPromise = periodScoped
    ? Promise.resolve({ data: [] as { id: string; full_name_ar: string; total_salary: number; doctor_share_percentage: number }[] })
    : supabase
        .from("assistants")
        .select("id, full_name_ar, total_salary, doctor_share_percentage")
        .eq("doctor_id", doctorId)
        .eq("is_active", true);

  const salaryPeriod = periodScoped
    ? { from: start, to: end }
    : monthDateRange(currentMonthYear());

  const [summary, opsRes, withdrawalsRes, payrollRes, expensesRes, assistantsFallback, salaryPayouts] =
    await Promise.all([
      fetchDoctorLedgerSummary(supabase, doctorId, monthYear),
      opsQuery,
      supabase
        .from("doctor_withdrawals")
        .select("*")
        .eq("doctor_id", doctorId)
        .order("requested_at", { ascending: false }),
      payrollPromise,
      expensesQuery,
      assistantsFallbackPromise,
      fetchDoctorSalaryPayoutRecords(
        supabase,
        doctorId,
        salaryPeriod.from,
        salaryPeriod.to
      ),
    ]);

  const operations = opsRes.data ?? [];
  const doctorPct = Number(doctor?.percentage ?? 50) / 100;
  const totalDoctorIncome = operations.reduce(
    (s, r) =>
      s +
      calcOperationEarned(
        {
          doctor_share_amount: r.doctor_share_amount,
          paid_amount: r.paid_amount,
          patient_treatment_cases: r.patient_treatment_cases,
        },
        doctorPct
      ),
    0
  );

  const expenseLines = (expensesRes.data ?? []).map((e) => ({
    id: e.id as string,
    description: (e.description_ar as string) || "صرفية عيادة",
    amount: Number(e.amount ?? 0),
    percentageSplit: Number(e.percentage_split ?? 0),
    doctorShare: doctorShareFromExpense(
      Number(e.amount ?? 0),
      Number(e.percentage_split ?? 0)
    ),
    expenseDate: e.expense_date as string,
  }));

  const assistantLines =
    payrollRes.length > 0
      ? buildAssistantPayrollLinesFromRecords(payrollRes, "paid")
      : periodScoped
        ? []
        : buildAssistantPayrollLines(
            (assistantsFallback.data ?? []).map((a) => ({
              id: a.id as string,
              full_name_ar: a.full_name_ar as string,
              total_salary: Number(a.total_salary ?? 0),
              doctor_share_percentage: Number(a.doctor_share_percentage ?? 0),
            }))
          );

  let settlement: DoctorMonthlySettlement | null = null;
  if (periodScoped && monthYear) {
    settlement = computeDoctorMonthlySettlement(
      summary?.totalEarned ?? totalDoctorIncome,
      expenseLines,
      assistantLines
    );
    if (isSalaryDoctor({ payment_type: doctor?.payment_type })) {
      const breakdown = await fetchDoctorMonthSalaryBreakdown(
        supabase,
        doctor.clinic_id as string,
        doctorId,
        monthYear,
        Number(doctor?.salary_amount ?? 0)
      );
      if (breakdown) {
        settlement = enrichSettlementWithSalaryBreakdown(settlement, breakdown);
      }
    }
  }

  const allWithdrawals = withdrawalsRes.data ?? [];
  const withdrawals = periodScoped
    ? filterWithdrawalsInPeriod(allWithdrawals, { from: start, to: end })
    : allWithdrawals;

  return {
    doctor,
    summary,
    operations,
    withdrawals,
    salaryPayouts,
    settlement,
  };
}

export async function fetchMasterClinicReport(
  supabase: SupabaseClient,
  monthYear?: string,
  explicitClinicId?: string
): Promise<MasterClinicReport> {
  const { start, end, my } = getMonthBounds(monthYear);
  const isCurrentMonthReport = my === currentMonthYear();
  const daySnapshotDate = isCurrentMonthReport ? todayISO() : end;
  const daySnapshotLabel = isCurrentMonthReport
    ? "اليوم"
    : `آخر يوم (${end})`;

  const clinicProfile = await fetchClinicProfile(supabase);
  const active = explicitClinicId
    ? null
    : await import("@/lib/clinic-context").then((m) =>
        m.getActiveClinicId(supabase)
      );
  const clinicId = explicitClinicId ?? active?.clinicId;

  const monthOpsQuery = (select: string) => {
    let q = supabase
      .from("patient_operations")
      .select(select)
      .gte("operation_date", start)
      .lte("operation_date", end);
    if (clinicId) q = q.eq("clinic_id", clinicId);
    return q;
  };

  const monthOpsDetailSelect =
    "operation_date, operation_type, operation_name_ar, total_amount, paid_amount, remaining_debt, materials_cost, lab_notes, patient:patients!patient_id(full_name_ar), doctor:doctors!doctor_id(full_name_ar)";
  const monthOpsDetailSelectBase =
    "operation_date, operation_type, operation_name_ar, total_amount, paid_amount, remaining_debt, patient:patients!patient_id(full_name_ar), doctor:doctors!doctor_id(full_name_ar)";

  type MonthOpDetailRow = {
    operation_date?: string;
    operation_type?: string;
    operation_name_ar?: string;
    total_amount?: number | string | null;
    paid_amount?: number | string | null;
    remaining_debt?: number | string | null;
    materials_cost?: number | string | null;
    lab_notes?: string | null;
    patient?:
      | { full_name_ar: string }
      | { full_name_ar: string }[]
      | null;
    doctor?:
      | { full_name_ar: string }
      | { full_name_ar: string }[]
      | null;
  };

  async function fetchMonthOperationsDetail(): Promise<MonthOpDetailRow[]> {
    let res = await monthOpsQuery(monthOpsDetailSelect)
      .order("operation_date", { ascending: false })
      .limit(200);

    if (
      res.error?.message?.includes("materials_cost") ||
      res.error?.message?.includes("lab_notes")
    ) {
      res = await monthOpsQuery(monthOpsDetailSelectBase)
        .order("operation_date", { ascending: false })
        .limit(200);
    }

    return (res.data ?? []) as MonthOpDetailRow[];
  }

  const [
    profitStats,
    today,
    doctors,
    pendingWithdrawalsRes,
    expensesRes,
    salaryEntriesRes,
    monthOpsRes,
    monthOpsCountRes,
    refunds,
    monthRefundsTotal,
    confirmedPayrollPayouts,
  ] = await Promise.all([
    clinicId
      ? fetchClinicProfitStatsForPeriod(supabase, clinicId, start, end)
      : Promise.resolve({
          cashInflow: 0,
          outstandingDebts: 0,
          netProfit: 0,
          totalRefunds: 0,
          clinicShareTotal: 0,
          doctorShareTotal: 0,
          totalExpenses: 0,
          totalSalariesPaid: 0,
          breakdown: [],
        }),
    fetchDaySummary(supabase, daySnapshotDate),
    fetchDoctorLedgers(supabase, my),
    clinicId
      ? supabase
          .from("doctor_withdrawals")
          .select("id, amount, requested_at, doctor:doctors!doctor_id(full_name_ar)")
          .eq("clinic_id", clinicId)
          .eq("status", "pending")
          .order("requested_at", { ascending: false })
      : Promise.resolve({ data: [], error: null }),
    clinicId
      ? supabase
          .from("expenses")
          .select("description_ar, amount, expense_date")
          .eq("clinic_id", clinicId)
          .gte("expense_date", start)
          .lte("expense_date", end)
          .order("expense_date", { ascending: false })
      : Promise.resolve({ data: [], error: null }),
    clinicId
      ? supabase
          .from("salary_entries")
          .select(
            `entry_type, amount, entry_date, notes_ar,
         staff_id, assistant_id, doctor_id,
         staff:staff_members!staff_id(full_name_ar, job_title_ar),
         assistant:assistants!assistant_id(full_name_ar),
         doctor:doctors!doctor_id(full_name_ar)`
          )
          .eq("clinic_id", clinicId)
          .gte("entry_date", start)
          .lte("entry_date", end)
          .order("entry_date", { ascending: false })
      : Promise.resolve({ data: [], error: null }),
    fetchMonthOperationsDetail(),
    monthOpsQuery("paid_amount, remaining_debt, total_amount"),
    fetchRefundsForReport(supabase, start, end, clinicId ?? undefined),
    clinicId
      ? fetchTotalRefundsAmount(supabase, {
          clinicId,
          from: start,
          to: end,
        })
      : Promise.resolve(0),
    clinicId
      ? fetchConfirmedPayrollPayoutLines(supabase, clinicId, start, end)
      : Promise.resolve([]),
  ]);

  const monthRows = monthOpsCountRes.data ?? [];
  const monthCollected = monthRows.reduce(
    (s, r) => s + Number(r.paid_amount ?? 0),
    0
  );
  const monthDebt = monthRows.reduce(
    (s, r) => s + Number(r.remaining_debt ?? 0),
    0
  );
  const monthBilled = monthRows.reduce(
    (s, r) => s + Number(r.total_amount ?? 0),
    0
  );

  const totalRevenue = monthCollected;
  const totalRefunds = Math.round(monthRefundsTotal * 100) / 100;
  const netProfit = profitStats.netProfit;
  const reviewFees = profitStats.breakdown.find(
    (b) => b.label === "كشفيات المراجعين"
  )?.amount ?? 0;

  const monthWithdrawals = await fetchClinicMonthWithdrawalLines(
    supabase,
    clinicId ?? undefined,
    start,
    end
  );

  const monthOperationRows = (monthOpsRes ?? []).map((op) => {
    const lab = labDetailsFromOperation(op as { materials_cost?: unknown; lab_notes?: unknown });
    return {
      operation_date: op.operation_date,
      operation_name_ar: op.operation_type || op.operation_name_ar,
      operation_type: op.operation_type,
      patientName:
        relationName(
          op.patient as { full_name_ar: string } | { full_name_ar: string }[]
        ) ?? "—",
      doctorName: formatDoctorDisplayName(
        relationName(
          op.doctor as { full_name_ar: string } | { full_name_ar: string }[]
        )
      ),
      total_amount: Number(op.total_amount),
      paid_amount: Number(op.paid_amount),
      remaining_debt: Number(
        op.remaining_debt ??
          Math.max(0, Number(op.total_amount) - Number(op.paid_amount))
      ),
      materials_cost: lab.materialsCost,
      lab_notes: lab.labNotes,
    };
  });

  const labCostsSummary = {
    totalMaterialsCost: sumMaterialsCosts(
      monthOperationRows.map((op) => ({ materialsCost: op.materials_cost }))
    ),
    sessionsWithLab: monthOperationRows.filter((op) => op.materials_cost > 0).length,
  };

  return {
    generatedAt: new Date().toISOString(),
    clinicProfile,
    clinicName: getClinicDisplayName(clinicProfile),
    periodLabel: `شهر ${my}`,
    monthYear: my,
    isCurrentMonthReport,
    summary: {
      totalRevenue,
      totalClinicShare: profitStats.clinicShareTotal,
      generalExpenses: profitStats.totalExpenses,
      staffSalaries: profitStats.totalSalariesPaid,
      doctorPayouts: profitStats.doctorShareTotal,
      outstandingDebts: profitStats.outstandingDebts,
      totalRefunds,
      netProfit,
      cashInflow: profitStats.cashInflow,
      reviewFees,
    },
    today: {
      ...today,
      date: daySnapshotDate,
      label: daySnapshotLabel,
    },
    month: {
      operationsCount: monthRows.length,
      totalCollected: monthCollected,
      totalRemainingDebt: monthDebt,
      totalBilled: monthBilled,
    },
    doctors: doctors.filter((d) => doctorLedgerHasPeriodActivity(d)),
    pendingWithdrawals: isCurrentMonthReport
      ? (pendingWithdrawalsRes.data ?? []).map((w) => ({
      id: w.id,
      doctorName: formatDoctorDisplayName(
        relationName(w.doctor as { full_name_ar: string } | { full_name_ar: string }[])
      ),
      amount: Number(w.amount),
      requested_at: w.requested_at,
    }))
      : [],
    expenses: expensesRes.data ?? [],
    salaryAdvances: (salaryEntriesRes.data ?? []).map((e) => {
      const person = resolveSalaryEntryPerson(
        e as Parameters<typeof resolveSalaryEntryPerson>[0]
      );
      return {
        personName: person.name,
        personCategory: person.category,
        jobTitle: person.jobTitle,
        entryType:
          SALARY_ENTRY_TYPE_LABELS[
            e.entry_type as keyof typeof SALARY_ENTRY_TYPE_LABELS
          ] ?? e.entry_type,
        amount: Number(e.amount),
        entry_date: e.entry_date,
        notes: e.notes_ar,
      };
    }),
    confirmedPayrollPayouts,
    refunds: refunds.map((r) => ({
      id: r.id,
      patientName: r.patientName,
      amount: r.amount,
      doctorName: formatDoctorDisplayName(r.doctorName),
      date: r.date,
      reason: r.reason,
    })),
    monthWithdrawals,
    monthOperations: monthOperationRows,
    labCostsSummary,
  };
}

/** Alias for accountant handover report — same comprehensive dataset */
export async function fetchAccountantClinicReport(
  supabase: SupabaseClient,
  monthYear?: string
): Promise<MasterClinicReport> {
  return fetchMasterClinicReport(supabase, monthYear);
}

export interface DoctorSettlementRow {
  doctorId: string;
  doctorName: string;
  specialty: string | null;
  payment_type: DoctorPaymentType;
  paymentLabel: string;
  totalEarned: number;
  /** إجمالي المسحوب / المُصرف — كل الفترات */
  totalWithdrawn: number;
  /** مسحوب أو راتب مُصرف خلال شهر التقرير */
  monthWithdrawn: number;
  pendingWithdrawalAmount: number;
  /** الرصيد الحالي — يطابق تطبيق الطبيب */
  remainingBalance: number;
  withdrawals: DoctorWithdrawalLine[];
  settlement: DoctorMonthlySettlement;
}

export interface MonthlySettlementReport {
  generatedAt: string;
  clinicProfile: ClinicProfile | null;
  clinicName: string;
  periodLabel: string;
  monthYear: string;
  isCurrentMonthReport: boolean;
  doctors: DoctorSettlementRow[];
  totals: {
    totalDoctorIncome: number;
    totalClinicExpenses: number;
    totalAssistantDeductions: number;
    totalNetPayout: number;
    totalWithdrawn: number;
    totalRemaining: number;
    clinicNetProfit: number;
  };
}

/** كشف تسوية شهري موحّد — يجمع تصفية كل الأطباء */
export async function fetchMonthlySettlementReport(
  supabase: SupabaseClient,
  monthYear?: string
): Promise<MonthlySettlementReport> {
  const { my } = getMonthBounds(monthYear);
  const [master, ledgers] = await Promise.all([
    fetchMasterClinicReport(supabase, my),
    fetchDoctorLedgers(supabase, my),
  ]);

  const doctors: DoctorSettlementRow[] = [];

  for (const ledger of ledgers) {
    const detail = await fetchDoctorLedgerDetail(supabase, ledger.id, my);
    if (!detail.settlement) continue;

    const withdrawals = (detail.withdrawals ?? []).map((w) =>
      mapWithdrawalLine(
        {
          id: w.id as string,
          doctor_id: ledger.id,
          amount: w.amount,
          status: w.status as string,
          source: (w as { source?: string | null }).source,
          requested_at: w.requested_at as string,
          processed_at: (w as { processed_at?: string | null }).processed_at,
        },
        formatDoctorDisplayName(ledger.full_name_ar)
      )
    );

    if (
      !doctorLedgerHasPeriodActivity(ledger, {
        withdrawalsInPeriod: withdrawals.length,
      }) &&
      detail.settlement.totalClinicExpenses === 0 &&
      detail.settlement.assistantPayrollDeduction === 0
    ) {
      continue;
    }

    const remainingBalance = master.isCurrentMonthReport
      ? ledger.availableBalance
      : 0;

    doctors.push({
      doctorId: ledger.id,
      doctorName: ledger.full_name_ar,
      specialty: ledger.specialty_ar,
      payment_type: ledger.payment_type,
      paymentLabel: ledger.paymentLabel,
      totalEarned: ledger.totalEarned,
      totalWithdrawn: ledger.monthWithdrawn,
      monthWithdrawn: ledger.monthWithdrawn,
      pendingWithdrawalAmount: ledger.pendingWithdrawalAmount,
      remainingBalance,
      withdrawals,
      settlement: detail.settlement,
    });
  }

  const totals = doctors.reduce(
    (acc, d) => ({
      totalDoctorIncome:
        acc.totalDoctorIncome + d.settlement.totalDoctorIncome,
      totalClinicExpenses:
        acc.totalClinicExpenses + d.settlement.totalClinicExpenses,
      totalAssistantDeductions:
        acc.totalAssistantDeductions + d.settlement.assistantPayrollDeduction,
      totalNetPayout: acc.totalNetPayout + d.settlement.doctorNetProfit,
      totalWithdrawn: acc.totalWithdrawn + d.monthWithdrawn,
      totalRemaining: acc.totalRemaining + d.remainingBalance,
      clinicNetProfit: master.summary.netProfit,
    }),
    {
      totalDoctorIncome: 0,
      totalClinicExpenses: 0,
      totalAssistantDeductions: 0,
      totalNetPayout: 0,
      totalWithdrawn: 0,
      totalRemaining: 0,
      clinicNetProfit: master.summary.netProfit,
    }
  );

  return {
    generatedAt: new Date().toISOString(),
    clinicProfile: master.clinicProfile,
    clinicName: master.clinicName,
    periodLabel: master.periodLabel,
    monthYear: my,
    isCurrentMonthReport: master.isCurrentMonthReport,
    doctors,
    totals,
  };
}

export function getReportPeriodOptions(): { value: string; label: string }[] {
  const options: { value: string; label: string }[] = [];
  const now = new Date();
  for (let i = 0; i < 12; i++) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    const value = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
    const label = d.toLocaleDateString("ar-EG", {
      year: "numeric",
      month: "long",
    });
    options.push({ value, label });
  }
  return options;
}
