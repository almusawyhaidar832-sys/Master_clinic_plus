import type { SupabaseClient } from "@supabase/supabase-js";
import {
  resolveSalaryEntryPerson,
  SALARY_ENTRY_TYPE_LABELS,
} from "@/lib/services/salary-entry-display";
import type { PayrollEmployeeCategory } from "@/lib/services/payroll-persons";
import type { SalaryEntryType } from "@/types";

const PAYROLL_PAYOUT_TYPES = [
  "staff_salary_paid",
  "doctor_salary_paid",
  "assistant_payroll_doctor",
  "assistant_payroll_clinic",
] as const;

const PAYROLL_REFERENCE_TYPES = [
  "salary_slip_paid",
  "salary_slip_doctor_paid",
  "payroll_record_paid",
  "payroll_record_clinic_paid",
] as const;

export type PayrollHistoryKind = "confirmed_payout" | "salary_entry";

export type PayrollHistoryFilter = "all" | "confirmed" | "daily_wage";

export type PayrollHistoryRow = {
  id: string;
  date: string;
  createdAt: string;
  personName: string;
  personCategory: PayrollEmployeeCategory;
  personKey: string;
  kind: PayrollHistoryKind;
  entryType?: SalaryEntryType;
  amount: number;
  label: string;
  notes: string | null;
  monthYear: string | null;
};

export type PayrollHistoryResult = {
  rows: PayrollHistoryRow[];
  totals: {
    confirmedPayouts: number;
    dailyWageEntries: number;
    entryCount: number;
  };
};

function roundMoney(n: number): number {
  return Math.round(n * 100) / 100;
}

function num(v: unknown): number {
  const n = Number(v ?? 0);
  return Number.isFinite(n) ? n : 0;
}

function parseReferenceParentId(referenceId: string | null | undefined): string | null {
  if (!referenceId) return null;
  const idx = referenceId.indexOf(":from:");
  if (idx > 0) return referenceId.slice(0, idx);
  return referenceId.trim() || null;
}

function personKeyFromParts(input: {
  staffId?: string | null;
  assistantId?: string | null;
  doctorId?: string | null;
  category: PayrollEmployeeCategory;
}): string {
  if (input.category === "doctor_salary" && input.doctorId) {
    return `doctor_salary:${input.doctorId}`;
  }
  if (input.category === "assistant" && input.assistantId) {
    return `assistant:${input.assistantId}`;
  }
  if (input.staffId) {
    return `${input.category}:${input.staffId}`;
  }
  return `unknown:${input.category}`;
}

function categoryFromStaffJob(jobTitle: string): PayrollEmployeeCategory {
  return /محاسب/i.test(jobTitle) ? "accountant" : "general";
}

type TxRow = {
  id: string;
  amount: number;
  type: string;
  transaction_date: string;
  description_ar: string | null;
  reference_type: string | null;
  reference_id: string | null;
  created_at: string;
};

type SlipPerson = {
  id: string;
  staff_id: string | null;
  doctor_id: string | null;
  month_year: string;
  staff?: { full_name_ar: string; job_title_ar?: string | null } | null;
  doctor?: { full_name_ar: string } | null;
};

type RecordPerson = {
  id: string;
  assistant_id: string;
  assistant_name_ar: string;
  month_year: string;
};

function relationOne<T extends { full_name_ar: string }>(
  rel: T | T[] | null | undefined
): T | null {
  if (!rel) return null;
  return Array.isArray(rel) ? rel[0] ?? null : rel;
}

export async function fetchPayrollPaymentHistory(
  supabase: SupabaseClient,
  clinicId: string,
  input: {
    from: string;
    to: string;
    personKey?: string;
    category?: PayrollEmployeeCategory | "all";
    kindFilter?: PayrollHistoryFilter;
  }
): Promise<PayrollHistoryResult> {
  const kindFilter = input.kindFilter ?? "all";

  const [txRes, entriesRes] = await Promise.all([
    supabase
      .from("transactions")
      .select(
        "id, amount, type, transaction_date, description_ar, reference_type, reference_id, created_at"
      )
      .eq("clinic_id", clinicId)
      .gte("transaction_date", input.from)
      .lte("transaction_date", input.to)
      .in("type", [...PAYROLL_PAYOUT_TYPES])
      .order("transaction_date", { ascending: false })
      .order("created_at", { ascending: false })
      .limit(500),
    kindFilter === "confirmed"
      ? Promise.resolve({ data: [] as Record<string, unknown>[] })
      : supabase
          .from("salary_entries")
          .select(
            `
            id, staff_id, assistant_id, doctor_id, entry_type, amount, entry_date, notes_ar, created_at,
            staff:staff_members(full_name_ar, job_title_ar),
            assistant:assistants(full_name_ar),
            doctor:doctors(full_name_ar)
          `
          )
          .eq("clinic_id", clinicId)
          .gte("entry_date", input.from)
          .lte("entry_date", input.to)
          .order("entry_date", { ascending: false })
          .order("created_at", { ascending: false })
          .limit(500),
  ]);

  const transactions = (txRes.data ?? []) as TxRow[];

  const slipIds = new Set<string>();
  const recordIds = new Set<string>();

  for (const tx of transactions) {
    const refType = tx.reference_type ?? "";
    if (!PAYROLL_REFERENCE_TYPES.includes(refType as (typeof PAYROLL_REFERENCE_TYPES)[number])) {
      continue;
    }
    const parentId = parseReferenceParentId(tx.reference_id);
    if (!parentId) continue;
    if (refType.startsWith("salary_slip")) {
      slipIds.add(parentId);
    } else if (refType.startsWith("payroll_record")) {
      recordIds.add(parentId);
    }
  }

  const [slipsRes, recordsRes] = await Promise.all([
    slipIds.size
      ? supabase
          .from("salary_slips")
          .select(
            "id, staff_id, doctor_id, month_year, staff:staff_members(full_name_ar, job_title_ar), doctor:doctors(full_name_ar)"
          )
          .eq("clinic_id", clinicId)
          .in("id", [...slipIds])
      : Promise.resolve({ data: [] as SlipPerson[] }),
    recordIds.size
      ? supabase
          .from("payroll_records")
          .select("id, assistant_id, assistant_name_ar, month_year")
          .eq("clinic_id", clinicId)
          .in("id", [...recordIds])
      : Promise.resolve({ data: [] as RecordPerson[] }),
  ]);

  const slipById = new Map(
    ((slipsRes.data ?? []) as SlipPerson[]).map((s) => [s.id, s])
  );
  const recordById = new Map(
    ((recordsRes.data ?? []) as RecordPerson[]).map((r) => [r.id, r])
  );

  const assistantBatch = new Map<
    string,
    {
      amount: number;
      date: string;
      createdAt: string;
      record: RecordPerson;
      description: string;
    }
  >();

  const payoutRows: PayrollHistoryRow[] = [];

  for (const tx of transactions) {
    const refType = tx.reference_type ?? "";
    const parentId = parseReferenceParentId(tx.reference_id);
    const amount = roundMoney(Math.abs(num(tx.amount)));
    if (amount <= 0) continue;

    if (
      refType === "payroll_record_paid" ||
      refType === "payroll_record_clinic_paid"
    ) {
      const batchKey = tx.reference_id ?? tx.id;
      const record = parentId ? recordById.get(parentId) : undefined;
      if (!record) continue;

      const existing = assistantBatch.get(batchKey);
      if (existing) {
        existing.amount = roundMoney(existing.amount + amount);
      } else {
        assistantBatch.set(batchKey, {
          amount,
          date: tx.transaction_date,
          createdAt: tx.created_at,
          record,
          description: String(tx.description_ar ?? "").trim(),
        });
      }
      continue;
    }

    if (refType === "salary_slip_paid" && parentId) {
      const slip = slipById.get(parentId);
      const staff = relationOne(slip?.staff ?? null);
      const job = staff?.job_title_ar?.trim() || "موظف";
      const category = categoryFromStaffJob(job);
      const name = staff?.full_name_ar ?? "موظف";
      payoutRows.push({
        id: `tx-${tx.id}`,
        date: tx.transaction_date,
        createdAt: tx.created_at,
        personName: name,
        personCategory: category,
        personKey: personKeyFromParts({
          staffId: slip?.staff_id,
          category,
        }),
        kind: "confirmed_payout",
        amount,
        label: "صرف راتب / أجر",
        notes: tx.description_ar,
        monthYear: slip?.month_year ?? null,
      });
      continue;
    }

    if (refType === "salary_slip_doctor_paid" && parentId) {
      const slip = slipById.get(parentId);
      const doctor = relationOne(slip?.doctor ?? null);
      payoutRows.push({
        id: `tx-${tx.id}`,
        date: tx.transaction_date,
        createdAt: tx.created_at,
        personName: doctor?.full_name_ar ?? "طبيب",
        personCategory: "doctor_salary",
        personKey: personKeyFromParts({
          doctorId: slip?.doctor_id,
          category: "doctor_salary",
        }),
        kind: "confirmed_payout",
        amount,
        label: "صرف راتب طبيب",
        notes: tx.description_ar,
        monthYear: slip?.month_year ?? null,
      });
    }
  }

  for (const [batchKey, batch] of assistantBatch) {
    payoutRows.push({
      id: `batch-${batchKey}`,
      date: batch.date,
      createdAt: batch.createdAt,
      personName: batch.record.assistant_name_ar,
      personCategory: "assistant",
      personKey: personKeyFromParts({
        assistantId: batch.record.assistant_id,
        category: "assistant",
      }),
      kind: "confirmed_payout",
      amount: batch.amount,
      label: "صرف راتب مساعد",
      notes: batch.description || null,
      monthYear: batch.record.month_year,
    });
  }

  const entryRows: PayrollHistoryRow[] = [];
  for (const raw of entriesRes.data ?? []) {
    const row = raw as Record<string, unknown>;
    const display = resolveSalaryEntryPerson({
      staff_id: row.staff_id as string | null,
      assistant_id: row.assistant_id as string | null,
      doctor_id: row.doctor_id as string | null,
      staff: row.staff as Parameters<typeof resolveSalaryEntryPerson>[0]["staff"],
      assistant: row.assistant as Parameters<
        typeof resolveSalaryEntryPerson
      >[0]["assistant"],
      doctor: row.doctor as Parameters<typeof resolveSalaryEntryPerson>[0]["doctor"],
    });

    const entryType = row.entry_type as SalaryEntryType;
    let category: PayrollEmployeeCategory = "general";
    if (row.doctor_id) category = "doctor_salary";
    else if (row.assistant_id) category = "assistant";
    else if (row.staff_id) {
      category =
        display.category === "محاسب"
          ? "accountant"
          : "general";
    }

    entryRows.push({
      id: `entry-${String(row.id)}`,
      date: String(row.entry_date),
      createdAt: String(row.created_at),
      personName: display.name,
      personCategory: category,
      personKey: personKeyFromParts({
        staffId: row.staff_id as string | null,
        assistantId: row.assistant_id as string | null,
        doctorId: row.doctor_id as string | null,
        category,
      }),
      kind: "salary_entry",
      entryType,
      amount: roundMoney(num(row.amount)),
      label:
        entryType === "daily_wage"
          ? "تسجيل أجر يومي"
          : SALARY_ENTRY_TYPE_LABELS[entryType] ?? "حركة راتب",
      notes: (row.notes_ar as string | null) ?? null,
      monthYear: String(row.entry_date).slice(0, 7),
    });
  }

  let rows = [...payoutRows, ...entryRows];

  if (kindFilter === "confirmed") {
    rows = rows.filter((r) => r.kind === "confirmed_payout");
  } else if (kindFilter === "daily_wage") {
    rows = rows.filter(
      (r) =>
        r.entryType === "daily_wage" ||
        (r.kind === "confirmed_payout" &&
          (r.label.includes("أجر") || r.notes?.includes("أجر") === true))
    );
  }

  if (input.category && input.category !== "all") {
    rows = rows.filter((r) => r.personCategory === input.category);
  }

  if (input.personKey?.trim()) {
    rows = rows.filter((r) => r.personKey === input.personKey);
  }

  rows.sort((a, b) => {
    const dateCmp = b.date.localeCompare(a.date);
    if (dateCmp !== 0) return dateCmp;
    return b.createdAt.localeCompare(a.createdAt);
  });

  const totals = {
    confirmedPayouts: roundMoney(
      rows
        .filter((r) => r.kind === "confirmed_payout")
        .reduce((s, r) => s + r.amount, 0)
    ),
    dailyWageEntries: roundMoney(
      rows
        .filter((r) => r.entryType === "daily_wage")
        .reduce((s, r) => s + r.amount, 0)
    ),
    entryCount: rows.length,
  };

  return { rows, totals };
}

export function payrollHistoryCategoryLabel(
  category: PayrollEmployeeCategory
): string {
  switch (category) {
    case "assistant":
      return "مساعد";
    case "accountant":
      return "محاسب";
    case "doctor_salary":
      return "طبيب — راتب";
    default:
      return "موظف";
  }
}

export function payrollHistoryKindBadge(row: PayrollHistoryRow): {
  label: string;
  className: string;
} {
  if (row.kind === "confirmed_payout") {
    return {
      label: "صرف مؤكّد",
      className: "bg-emerald-100 text-emerald-800 ring-1 ring-emerald-200",
    };
  }
  if (row.entryType === "daily_wage") {
    return {
      label: "أجر يومي",
      className: "bg-sky-100 text-sky-800 ring-1 ring-sky-200",
    };
  }
  return {
    label: "حركة مسجّلة",
    className: "bg-slate-100 text-slate-700 ring-1 ring-slate-200",
  };
}
