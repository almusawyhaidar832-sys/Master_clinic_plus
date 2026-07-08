import type { SupabaseClient } from "@supabase/supabase-js";
import { fetchDailyAssistantPayrollLines } from "@/lib/ledger/daily-assistant-payroll";
import {
  CONFIRMED_PAYROLL_TYPE_LABELS,
  fetchConfirmedPayrollPayoutLines,
} from "@/lib/services/payroll-paid-portions";
import { BALANCE_TOPUP_CLINIC_TYPE } from "@/lib/services/balance-topup";
import { FINANCIAL_EPSILON } from "@/lib/services/patient-financial-plan";
import { formatCurrency } from "@/lib/utils";

export type ProfitLedgerCategory =
  | "general_expense"
  | "doctor_expense_clinic"
  | "assistant_payroll"
  | "staff_salary"
  | "doctor_salary"
  | "balance_topup";

export interface ProfitLedgerLine {
  id: string;
  category: ProfitLedgerCategory;
  date: string;
  /** سالب = خصم من الربح، موجب = إضافة للربح */
  amount: number;
  title: string;
  subtitle?: string;
  actorName?: string;
  /** إجمالي أجر المساعد في هذه الدفعة (وليس تراكم الشهر) */
  totalAmount?: number;
  /** ما يُخصم من رصيد الطبيب في هذه الدفعة */
  doctorShare?: number;
  /** ما يُخصم من ربح العيادة في هذه الدفعة */
  clinicShare?: number;
  doctorSharePct?: number;
}

export interface ProfitLedgerGroup {
  category: ProfitLedgerCategory;
  label: string;
  /** إجمالي الخصم (رقم موجب للعرض) */
  totalDeduction: number;
  /** إجمالي الإضافة (رقم موجب للعرض) */
  totalAddition: number;
  lines: ProfitLedgerLine[];
}

export interface ProfitDeductionLedger {
  from: string;
  to: string;
  groups: ProfitLedgerGroup[];
  totalDeductions: number;
  totalAdditions: number;
  operationCount: number;
  summaryAr: string;
}

const CATEGORY_LABELS: Record<ProfitLedgerCategory, string> = {
  general_expense: "صرفيات العيادة",
  doctor_expense_clinic: "فواتير أطباء — حصة العيادة",
  assistant_payroll: "أجور مساعدي الأطباء",
  staff_salary: "رواتب الموظفين",
  doctor_salary: "رواتب الأطباء",
  balance_topup: "شحن رصيد العيادة",
};

function roundMoney(n: number): number {
  return Math.round(n * 100) / 100;
}

function payrollCategoryFromType(type: string): ProfitLedgerCategory | null {
  if (type === "assistant_payroll_clinic") return null;
  if (type === "doctor_salary_paid") return "doctor_salary";
  return "staff_salary";
}

function extractAssistantNameFromDesc(desc: string | null | undefined): string {
  const text = String(desc ?? "").trim();
  const m = text.match(/مساعد\s+(.+?)\s+—/);
  if (m?.[1]) return m[1].trim();
  return "مساعد";
}

type AssistantPayrollTxRow = {
  id: string;
  doctor_id: string | null;
  amount: number;
  type: string;
  reference_id: string | null;
  description_ar: string | null;
  transaction_date: string;
};

/** دمج حركات الطبيب + العيادة لكل دفعة صرف — يوم بيوم بدون تراكم */
async function appendAssistantPayrollBatchedLines(
  supabase: SupabaseClient,
  clinicId: string,
  from: string,
  to: string,
  getGroup: (cat: ProfitLedgerCategory) => ProfitLedgerGroup,
  payrollParentIds: string[]
): Promise<void> {
  const { data } = await supabase
    .from("transactions")
    .select(
      "id, doctor_id, amount, type, reference_id, description_ar, transaction_date"
    )
    .eq("clinic_id", clinicId)
    .gte("transaction_date", from)
    .lte("transaction_date", to)
    .in("type", ["assistant_payroll_doctor", "assistant_payroll_clinic"])
    .order("transaction_date", { ascending: false });

  const batches = new Map<
    string,
    { doctor?: AssistantPayrollTxRow; clinic?: AssistantPayrollTxRow }
  >();

  for (const raw of data ?? []) {
    const tx = raw as AssistantPayrollTxRow;
    const key = tx.reference_id ?? tx.id;
    const batch = batches.get(key) ?? {};
    if (tx.type === "assistant_payroll_doctor") batch.doctor = tx;
    else if (tx.type === "assistant_payroll_clinic") batch.clinic = tx;
    batches.set(key, batch);
  }

  const parentIds = new Set<string>();
  for (const batch of batches.values()) {
    const ref = batch.doctor?.reference_id ?? batch.clinic?.reference_id;
    if (ref) parentIds.add(parsePayrollParentId(ref));
  }

  const recordMap = new Map<
    string,
    {
      assistant_name_ar: string;
      doctor_name_ar: string;
      doctor_share_percentage: number;
    }
  >();

  if (parentIds.size > 0) {
    const { data: records } = await supabase
      .from("payroll_records")
      .select(
        "id, assistant_name_ar, doctor_share_percentage, doctor:doctors(full_name_ar)"
      )
      .eq("clinic_id", clinicId)
      .in("id", [...parentIds]);

    for (const r of records ?? []) {
      const doctor = relationOne(
        r.doctor as
          | { full_name_ar?: string }
          | { full_name_ar?: string }[]
          | null
      );
      recordMap.set(String(r.id), {
        assistant_name_ar: String(r.assistant_name_ar ?? "مساعد"),
        doctor_name_ar: doctor?.full_name_ar?.trim() || "طبيب",
        doctor_share_percentage: Number(r.doctor_share_percentage ?? 0),
      });
    }
  }

  type BatchEntry = {
    key: string;
    batch: { doctor?: AssistantPayrollTxRow; clinic?: AssistantPayrollTxRow };
    date: string;
    doctorShare: number;
    clinicShare: number;
    totalAmount: number;
  };

  const entries: BatchEntry[] = [];

  for (const [key, batch] of batches) {
    const doctorShare = roundMoney(Math.abs(Number(batch.doctor?.amount ?? 0)));
    const clinicShare = roundMoney(Math.abs(Number(batch.clinic?.amount ?? 0)));
    const totalAmount = roundMoney(doctorShare + clinicShare);
    if (totalAmount <= 0) continue;

    const date = String(
      batch.clinic?.transaction_date ?? batch.doctor?.transaction_date ?? ""
    );
    entries.push({ key, batch, date, doctorShare, clinicShare, totalAmount });
  }

  entries.sort((a, b) => b.date.localeCompare(a.date));

  for (const entry of entries) {
    const ref =
      entry.batch.doctor?.reference_id ?? entry.batch.clinic?.reference_id ?? "";
    const parentId = ref ? parsePayrollParentId(ref) : "";
    if (parentId) payrollParentIds.push(parentId);

    const record = parentId ? recordMap.get(parentId) : undefined;
    const assistantName =
      record?.assistant_name_ar ??
      extractAssistantNameFromDesc(
        entry.batch.doctor?.description_ar ?? entry.batch.clinic?.description_ar
      );
    const doctorName = record?.doctor_name_ar ?? "";
    const pct =
      record?.doctor_share_percentage ??
      (entry.totalAmount > 0
        ? roundMoney((entry.doctorShare / entry.totalAmount) * 100)
        : 0);

    const txId = entry.batch.clinic?.id ?? entry.batch.doctor?.id ?? entry.key;

    pushLine(getGroup("assistant_payroll"), {
      id: `assistant-batch-${txId}`,
      category: "assistant_payroll",
      date: entry.date,
      amount: entry.clinicShare > 0 ? -entry.clinicShare : 0,
      title: `أجر مساعد — ${assistantName}`,
      subtitle: appendSubtitle(
        doctorName ? `الطبيب: ${doctorName}` : undefined,
        `نسبة الطبيب ${pct}%`
      ),
      totalAmount: entry.totalAmount,
      doctorShare: entry.doctorShare,
      clinicShare: entry.clinicShare,
      doctorSharePct: pct,
      actorLookupKey: parentId || txId,
    });
  }
}

/** أجور مساعدين مسجّلة — حصة العيادة قبل تأكيد الصرف */
async function appendRegisteredAssistantPayrollLines(
  supabase: SupabaseClient,
  clinicId: string,
  from: string,
  to: string,
  getGroup: (cat: ProfitLedgerCategory) => ProfitLedgerGroup
): Promise<void> {
  const lines = await fetchDailyAssistantPayrollLines(supabase, clinicId, {
    dateFrom: from,
    dateTo: to,
  });
  const registered = lines.filter(
    (line) =>
      line.statusLabel === "أجر مسجّل" && line.clinicShare > FINANCIAL_EPSILON
  );
  if (!registered.length) return;

  const doctorIds = [...new Set(registered.map((line) => line.doctorId))];
  const { data: doctors } = await supabase
    .from("doctors")
    .select("id, full_name_ar")
    .eq("clinic_id", clinicId)
    .in("id", doctorIds);

  const doctorNameById = new Map(
    (doctors ?? []).map((doctor) => [
      String(doctor.id),
      String(doctor.full_name_ar ?? "طبيب"),
    ])
  );

  for (const line of registered) {
    const doctorName = doctorNameById.get(line.doctorId) ?? "طبيب";
    pushLine(getGroup("assistant_payroll"), {
      id: line.id,
      category: "assistant_payroll",
      date: line.lineDate,
      amount: -line.clinicShare,
      title: `أجر مساعد — ${line.assistantName}`,
      subtitle: appendSubtitle(
        `الطبيب: ${doctorName}`,
        `أجر مسجّل — نسبة الطبيب ${line.doctorSharePct}%`
      ),
      totalAmount: line.totalSalary,
      doctorShare: line.doctorDeduction,
      clinicShare: line.clinicShare,
      doctorSharePct: line.doctorSharePct,
      actorLookupKey: line.assistantId ?? line.id,
    });
  }
}

function emptyGroup(category: ProfitLedgerCategory): ProfitLedgerGroup {
  return {
    category,
    label: CATEGORY_LABELS[category],
    totalDeduction: 0,
    totalAddition: 0,
    lines: [],
  };
}

function pushLine(group: ProfitLedgerGroup, line: LedgerLineDraft): void {
  group.lines.push(line);
  if (line.amount < 0) {
    group.totalDeduction = roundMoney(group.totalDeduction + Math.abs(line.amount));
  } else if (line.amount > 0) {
    group.totalAddition = roundMoney(group.totalAddition + line.amount);
  }
}

function parsePayrollParentId(referenceId: string): string {
  const marker = ":from:";
  const idx = referenceId.indexOf(marker);
  if (idx > 0) return referenceId.slice(0, idx);
  return referenceId;
}

function appendSubtitle(...parts: (string | undefined)[]): string | undefined {
  const merged = parts.map((p) => p?.trim()).filter(Boolean) as string[];
  return merged.length > 0 ? merged.join(" · ") : undefined;
}

type LedgerLineDraft = ProfitLedgerLine & { actorLookupKey: string };

/** استخراج اسم المحاسب/المسجّل من سجل التدقيق أو created_by */
export async function resolveLedgerActorNames(
  supabase: SupabaseClient,
  clinicId: string,
  opts: {
    expenseIds: string[];
    doctorExpenseIds: string[];
    payrollParentIds: string[];
    financialTxIds: string[];
  }
): Promise<Map<string, string>> {
  const result = new Map<string, string>();
  const allEntityIds = [
    ...new Set([
      ...opts.expenseIds,
      ...opts.doctorExpenseIds,
      ...opts.payrollParentIds,
      ...opts.financialTxIds,
    ].filter(Boolean)),
  ];

  if (allEntityIds.length === 0) return result;

  const profileIdsToResolve = new Set<string>();

  const { data: auditRows } = await supabase
    .from("audit_logs")
    .select("entity_id, actor_name, changed_by, changed_at")
    .eq("clinic_id", clinicId)
    .in("entity_id", allEntityIds)
    .order("changed_at", { ascending: false });

  for (const row of auditRows ?? []) {
    const entityId = String(row.entity_id ?? "");
    if (!entityId || result.has(entityId)) continue;

    const actorName = String(row.actor_name ?? "").trim();
    if (actorName) {
      result.set(entityId, actorName);
    } else if (row.changed_by) {
      profileIdsToResolve.add(String(row.changed_by));
    }
  }

  const unresolvedExpenseIds = opts.expenseIds.filter((id) => !result.has(id));
  if (unresolvedExpenseIds.length > 0) {
    const { data: expenseRows } = await supabase
      .from("expenses")
      .select("id, created_by")
      .eq("clinic_id", clinicId)
      .in("id", unresolvedExpenseIds);

    for (const row of expenseRows ?? []) {
      const id = String(row.id);
      if (result.has(id) || !row.created_by) continue;
      profileIdsToResolve.add(String(row.created_by));
    }
  }

  const unresolvedDoctorExpenseIds = opts.doctorExpenseIds.filter(
    (id) => !result.has(id)
  );
  if (unresolvedDoctorExpenseIds.length > 0) {
    const { data: doctorExpenseRows } = await supabase
      .from("doctor_expenses")
      .select("id, created_by")
      .eq("clinic_id", clinicId)
      .in("id", unresolvedDoctorExpenseIds);

    for (const row of doctorExpenseRows ?? []) {
      const id = String(row.id);
      if (result.has(id) || !row.created_by) continue;
      profileIdsToResolve.add(String(row.created_by));
    }
  }

  if (profileIdsToResolve.size > 0) {
    const { data: profiles } = await supabase
      .from("profiles")
      .select("id, full_name")
      .in("id", [...profileIdsToResolve]);

    const profileMap = new Map<string, string>();
    for (const p of profiles ?? []) {
      const name = String(p.full_name ?? "").trim();
      if (name) profileMap.set(String(p.id), name);
    }

    for (const row of auditRows ?? []) {
      const entityId = String(row.entity_id ?? "");
      if (!entityId || result.has(entityId) || !row.changed_by) continue;
      const name = profileMap.get(String(row.changed_by));
      if (name) result.set(entityId, name);
    }

    if (unresolvedExpenseIds.length > 0) {
      const { data: expenseRows } = await supabase
        .from("expenses")
        .select("id, created_by")
        .eq("clinic_id", clinicId)
        .in("id", unresolvedExpenseIds);

      for (const row of expenseRows ?? []) {
        const id = String(row.id);
        if (result.has(id) || !row.created_by) continue;
        const name = profileMap.get(String(row.created_by));
        if (name) result.set(id, name);
      }
    }

    if (unresolvedDoctorExpenseIds.length > 0) {
      const { data: doctorExpenseRows } = await supabase
        .from("doctor_expenses")
        .select("id, created_by")
        .eq("clinic_id", clinicId)
        .in("id", unresolvedDoctorExpenseIds);

      for (const row of doctorExpenseRows ?? []) {
        const id = String(row.id);
        if (result.has(id) || !row.created_by) continue;
        const name = profileMap.get(String(row.created_by));
        if (name) result.set(id, name);
      }
    }
  }

  return result;
}

function buildSummaryAr(
  totalDeductions: number,
  totalAdditions: number,
  operationCount: number,
  groups: ProfitLedgerGroup[]
): string {
  const activeGroups = groups.filter(
    (g) => g.totalDeduction > 0 || g.totalAddition > 0
  );

  if (operationCount === 0) {
    return "لا توجد حركات مالية أثّرت على ربح العيادة في هذه الفترة.";
  }

  const parts: string[] = [];

  if (totalDeductions > 0) {
    parts.push(`انخفض الربح بمبلغ ${formatCurrency(totalDeductions)}`);
    const reasons = activeGroups
      .filter((g) => g.totalDeduction > 0 && g.category !== "balance_topup")
      .map((g) => `${g.label} (${formatCurrency(g.totalDeduction)})`);
    if (reasons.length > 0) {
      parts.push(`بسبب: ${reasons.join("، ")}`);
    }
  }

  if (totalAdditions > 0) {
    parts.push(`وزيد الربح بمبلغ ${formatCurrency(totalAdditions)} (شحن رصيد)`);
  }

  parts.push(`— ${operationCount} عملية مالية مسجّلة.`);

  return parts.join(" ");
}

function paidAtInRange(
  paidAt: string | null | undefined,
  from: string,
  to: string
): boolean {
  if (!paidAt) return false;
  const d = String(paidAt).slice(0, 10);
  return d >= from && d <= to;
}

function relationOne<T>(rel: T | T[] | null | undefined): T | null {
  if (!rel) return null;
  return Array.isArray(rel) ? rel[0] ?? null : rel;
}

/** رواتب مؤكَّدة سابقاً بدون حركة transactions — للأرشيف القديم */
async function appendLegacyPayrollLines(
  supabase: SupabaseClient,
  clinicId: string,
  from: string,
  to: string,
  payrollParentIds: string[],
  getGroup: (cat: ProfitLedgerCategory) => ProfitLedgerGroup
): Promise<void> {
  const covered = new Set(payrollParentIds);

  const [recordsRes, slipsRes] = await Promise.all([
    supabase
      .from("payroll_records")
      .select(
        "id, assistant_name_ar, paid_doctor_share_amount, paid_clinic_share_amount, clinic_share_amount, doctor_share_amount, paid_at, status"
      )
      .eq("clinic_id", clinicId)
      .or("status.eq.paid,paid_clinic_share_amount.gt.0"),
    supabase
      .from("salary_slips")
      .select(
        "id, paid_net_payout, net_payout, paid_at, month_year, status, doctor_id, staff:staff_members(full_name_ar, job_title_ar), doctor:doctors(full_name_ar)"
      )
      .eq("clinic_id", clinicId)
      .or("status.eq.paid,paid_net_payout.gt.0"),
  ]);

  for (const row of recordsRes.data ?? []) {
    const id = String(row.id);
    if (covered.has(id)) continue;
    if (!paidAtInRange(row.paid_at as string | null, from, to)) continue;

    const doctorAmount = roundMoney(Number(row.paid_doctor_share_amount ?? 0));
    const clinicAmount = roundMoney(
      Number(row.paid_clinic_share_amount ?? 0) > 0
        ? Number(row.paid_clinic_share_amount)
        : row.status === "paid"
          ? Number(row.clinic_share_amount ?? 0)
          : 0
    );
    const totalAmount = roundMoney(
      doctorAmount > 0 || clinicAmount > 0
        ? doctorAmount + clinicAmount
        : row.status === "paid"
          ? Number(row.clinic_share_amount ?? 0) + Number(row.doctor_share_amount ?? 0)
          : 0
    );
    if (totalAmount <= 0 && clinicAmount <= 0) continue;

    payrollParentIds.push(id);
    covered.add(id);

    const assistantName = String(row.assistant_name_ar ?? "").trim() || "مساعد";
    const pct =
      totalAmount > 0
        ? roundMoney((doctorAmount / totalAmount) * 100)
        : 0;

    pushLine(getGroup("assistant_payroll"), {
      id: `legacy-payroll-${id}`,
      category: "assistant_payroll",
      date: String(row.paid_at).slice(0, 10),
      amount: clinicAmount > 0 ? -clinicAmount : 0,
      title: `أجر مساعد — ${assistantName}`,
      subtitle: "صرف سابق · سجل أرشيف",
      totalAmount: totalAmount > 0 ? totalAmount : clinicAmount,
      doctorShare: doctorAmount,
      clinicShare: clinicAmount,
      doctorSharePct: pct,
      actorLookupKey: id,
    });
  }

  for (const row of slipsRes.data ?? []) {
    const id = String(row.id);
    if (covered.has(id)) continue;
    if (!paidAtInRange(row.paid_at as string | null, from, to)) continue;

    const paid = roundMoney(
      Number(row.paid_net_payout ?? 0) > 0
        ? Number(row.paid_net_payout)
        : row.status === "paid"
          ? Number(row.net_payout ?? 0)
          : 0
    );
    if (paid <= 0) continue;

    payrollParentIds.push(id);
    covered.add(id);

    const doctorId = row.doctor_id as string | null;
    const category: ProfitLedgerCategory = doctorId
      ? "doctor_salary"
      : "staff_salary";
    const staff = relationOne(
      row.staff as
        | { full_name_ar?: string; job_title_ar?: string }
        | { full_name_ar?: string; job_title_ar?: string }[]
        | null
    );
    const doctor = relationOne(
      row.doctor as { full_name_ar?: string } | { full_name_ar?: string }[] | null
    );
    const personName =
      (doctorId ? doctor?.full_name_ar : staff?.full_name_ar)?.trim() ||
      (doctorId ? "طبيب" : "موظف");
    const monthYear = String(row.month_year ?? "");

    pushLine(getGroup(category), {
      id: `legacy-slip-${id}`,
      category,
      date: String(row.paid_at).slice(0, 10),
      amount: -paid,
      title: doctorId
        ? `راتب طبيب — ${personName}`
        : `راتب موظف — ${personName}`,
      subtitle: monthYear
        ? `صرف سابق · ${monthYear} · سجل أرشيف`
        : "صرف سابق · سجل أرشيف",
      actorLookupKey: id,
    });
  }
}

/** سجل تفصيلي لكل ما يخصم أو يضيف لصافي ربح العيادة ضمن الفترة */
export async function fetchProfitDeductionLedger(
  supabase: SupabaseClient,
  clinicId: string,
  from: string,
  to: string
): Promise<ProfitDeductionLedger> {
  const [
    expensesRes,
    doctorExpenseTxRes,
    payrollLines,
    balanceTopupTxRes,
  ] = await Promise.all([
    supabase
      .from("expenses")
      .select(
        "id, description_ar, amount, expense_date, expense_kind, category:expense_categories(name_ar)"
      )
      .eq("clinic_id", clinicId)
      .gte("expense_date", from)
      .lte("expense_date", to)
      .order("expense_date", { ascending: false }),
    supabase
      .from("transactions")
      .select(
        "id, amount, transaction_date, description_ar, reference_id, doctor_id, doctor:doctors(full_name_ar)"
      )
      .eq("clinic_id", clinicId)
      .eq("type", "doctor_expense_clinic")
      .lt("amount", 0)
      .gte("transaction_date", from)
      .lte("transaction_date", to)
      .order("transaction_date", { ascending: false }),
    fetchConfirmedPayrollPayoutLines(supabase, clinicId, from, to),
    supabase
      .from("transactions")
      .select("id, amount, transaction_date, description_ar, reference_id")
      .eq("clinic_id", clinicId)
      .eq("type", BALANCE_TOPUP_CLINIC_TYPE)
      .gt("amount", 0)
      .gte("transaction_date", from)
      .lte("transaction_date", to)
      .order("transaction_date", { ascending: false }),
  ]);

  const groupMap = new Map<ProfitLedgerCategory, ProfitLedgerGroup>();
  const expenseIds: string[] = [];
  const doctorExpenseIds: string[] = [];
  const payrollParentIds: string[] = [];
  const financialTxIds: string[] = [];

  const getGroup = (cat: ProfitLedgerCategory) => {
    if (!groupMap.has(cat)) groupMap.set(cat, emptyGroup(cat));
    return groupMap.get(cat)!;
  };

  for (const row of expensesRes.data ?? []) {
    if ((row.expense_kind ?? "general") === "doctor_salary") continue;
    const amount = roundMoney(Number(row.amount ?? 0));
    if (amount <= 0) continue;

    const expenseId = String(row.id);
    expenseIds.push(expenseId);

    const category = row.category as { name_ar?: string } | null;
    const catName = category?.name_ar?.trim();

    pushLine(getGroup("general_expense"), {
      id: expenseId,
      category: "general_expense",
      date: String(row.expense_date ?? ""),
      amount: -amount,
      title: String(row.description_ar ?? "صرفية عيادة").trim() || "صرفية عيادة",
      subtitle: catName ? `تصنيف: ${catName}` : undefined,
      actorLookupKey: expenseId,
    });
  }

  for (const row of doctorExpenseTxRes.data ?? []) {
    const amount = roundMoney(Math.abs(Number(row.amount ?? 0)));
    if (amount <= 0) continue;

    const doctorExpenseId = String(row.reference_id ?? "");
    if (doctorExpenseId) doctorExpenseIds.push(doctorExpenseId);

    const doctor = row.doctor as { full_name_ar?: string } | null;
    const doctorName = doctor?.full_name_ar?.trim();
    const desc = String(row.description_ar ?? "").trim();

    pushLine(getGroup("doctor_expense_clinic"), {
      id: String(row.id),
      category: "doctor_expense_clinic",
      date: String(row.transaction_date ?? ""),
      amount: -amount,
      title: desc || "فاتورة صرفية طبيب",
      subtitle: doctorName ? `الطبيب: ${doctorName}` : undefined,
      actorLookupKey: doctorExpenseId || String(row.id),
    });
  }

  for (const line of payrollLines) {
    const category = payrollCategoryFromType(line.type);
    if (!category) continue;
    const isCredit = line.amount < 0;
    const displayAmount = isCredit ? Math.abs(line.amount) : -line.amount;
    const parentId = line.referenceId
      ? parsePayrollParentId(line.referenceId)
      : "";
    if (parentId) payrollParentIds.push(parentId);

    pushLine(getGroup(category), {
      id: line.id,
      category,
      date: line.transactionDate,
      amount: displayAmount,
      title:
        line.descriptionAr ||
        CONFIRMED_PAYROLL_TYPE_LABELS[line.type] ||
        line.typeLabel,
      subtitle: isCredit ? "تصحيح / استرداد" : "صرف مؤكَّد — خصم من ربح العيادة",
      actorLookupKey: parentId || line.id,
    });
  }

  await appendAssistantPayrollBatchedLines(
    supabase,
    clinicId,
    from,
    to,
    getGroup,
    payrollParentIds
  );

  await appendRegisteredAssistantPayrollLines(
    supabase,
    clinicId,
    from,
    to,
    getGroup
  );

  await appendLegacyPayrollLines(
    supabase,
    clinicId,
    from,
    to,
    payrollParentIds,
    getGroup
  );

  for (const row of balanceTopupTxRes.data ?? []) {
    const amount = roundMoney(Number(row.amount ?? 0));
    if (amount <= 0) continue;

    const refId = String(row.reference_id ?? "");
    if (refId) financialTxIds.push(refId);

    pushLine(getGroup("balance_topup"), {
      id: String(row.id),
      category: "balance_topup",
      date: String(row.transaction_date ?? ""),
      amount,
      title: String(row.description_ar ?? "").trim() || "شحن رصيد العيادة",
      actorLookupKey: refId || String(row.id),
    });
  }

  const actorMap = await resolveLedgerActorNames(supabase, clinicId, {
    expenseIds,
    doctorExpenseIds,
    payrollParentIds,
    financialTxIds,
  });

  for (const group of groupMap.values()) {
    const cleanLines: ProfitLedgerLine[] = [];
    for (const draft of group.lines as LedgerLineDraft[]) {
      const actorName = actorMap.get(draft.actorLookupKey);
      const { actorLookupKey: _drop, ...line } = draft;
      if (actorName) {
        line.actorName = actorName;
        line.subtitle = appendSubtitle(line.subtitle, `المحاسب: ${actorName}`);
      }
      cleanLines.push(line);
    }
    group.lines = cleanLines;
  }

  const categoryOrder: ProfitLedgerCategory[] = [
    "general_expense",
    "doctor_expense_clinic",
    "assistant_payroll",
    "staff_salary",
    "doctor_salary",
    "balance_topup",
  ];

  const groups = categoryOrder
    .map((cat) => groupMap.get(cat))
    .filter((g): g is ProfitLedgerGroup => !!g && g.lines.length > 0);

  let totalDeductions = 0;
  let totalAdditions = 0;
  let operationCount = 0;

  for (const g of groups) {
    totalDeductions = roundMoney(totalDeductions + g.totalDeduction);
    totalAdditions = roundMoney(totalAdditions + g.totalAddition);
    operationCount += g.lines.length;
  }

  return {
    from,
    to,
    groups,
    totalDeductions,
    totalAdditions,
    operationCount,
    summaryAr: buildSummaryAr(
      totalDeductions,
      totalAdditions,
      operationCount,
      groups
    ),
  };
}
