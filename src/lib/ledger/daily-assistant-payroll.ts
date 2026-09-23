import type { SupabaseClient } from "@supabase/supabase-js";
import { breakdownAssistantSalary } from "@/lib/services/assistant-payroll";
import {
  isDailyWageAssistant,
  normalizeAssistantCompensationMode,
} from "@/lib/services/assistant-compensation";
import { FINANCIAL_EPSILON } from "@/lib/services/patient-financial-plan";
import { assistantPendingClinicShare } from "@/lib/services/payroll-paid-portions";
import { todayISO } from "@/lib/utils";
import {
  fetchAllRows,
  fetchAllRowsInChunks,
} from "@/lib/supabase/fetch-all-rows";
import type { PayrollRecord } from "@/types";

export type DailyAssistantPayrollLine = {
  id: string;
  doctorId: string;
  assistantId: string | null;
  assistantName: string;
  /** تاريخ الحركة — للعرض في الكشف المالي */
  lineDate: string;
  /** إجمالي أجر المساعد */
  totalSalary: number;
  /** ما يُخصم من الطبيب */
  doctorDeduction: number;
  /** ما تتحمله العيادة */
  clinicShare: number;
  doctorSharePct: number;
  statusLabel: "صرف مؤكّد" | "أجر مسجّل";
  /** حركة تصحيح بعد حذف/تعديل أجر — المبالغ سالبة (ترجع للطبيب والعيادة) */
  isCorrection?: boolean;
};

function num(v: unknown): number {
  const n = Number(v ?? 0);
  return Number.isFinite(n) ? n : 0;
}

function roundMoney(n: number): number {
  return Math.round(n * 100) / 100;
}

function parseReferenceParentId(referenceId: string | null | undefined): string | null {
  if (!referenceId) return null;
  const idx = referenceId.indexOf(":from:");
  if (idx > 0) return referenceId.slice(0, idx);
  return referenceId.trim() || null;
}

type TxRow = {
  id: string;
  doctor_id: string | null;
  amount: number;
  type: string;
  reference_type: string | null;
  reference_id: string | null;
  description_ar: string | null;
  transaction_date: string;
};

/** نفس ASSISTANT_ENTRY_*_REF في payroll-financial — مرجع الحركة = معرّف الأجر اليومي */
const DAILY_ENTRY_CONFIRM_REFS = [
  "salary_entry_assistant_doctor",
  "salary_entry_assistant_clinic",
];

const ENTRY_ID_CHUNK = 150;

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

async function fetchDailyConfirmedEntryIds(
  supabase: SupabaseClient,
  clinicId: string,
  entryIds: string[]
): Promise<Set<string>> {
  const confirmed = new Set<string>();
  for (let i = 0; i < entryIds.length; i += ENTRY_ID_CHUNK) {
    const chunk = entryIds.slice(i, i + ENTRY_ID_CHUNK);
    const { data } = await fetchAllRows<{ reference_id: string | null }>(() =>
      supabase
        .from("transactions")
        .select("reference_id")
        .eq("clinic_id", clinicId)
        .in("reference_type", DAILY_ENTRY_CONFIRM_REFS)
        .in("reference_id", chunk)
        .order("id", { ascending: true })
    );
    for (const row of data ?? []) {
      if (row.reference_id) confirmed.add(String(row.reference_id));
    }
  }
  return confirmed;
}

/** أجور مساعدي الأطباء في فترة محددة — صرف مؤكّد + تسجيل أجر يومي */
export async function fetchDailyAssistantPayrollLines(
  supabase: SupabaseClient,
  clinicId: string,
  input: { dateFrom: string; dateTo: string },
  doctorId?: string
): Promise<DailyAssistantPayrollLine[]> {
  const buildTxQuery = () =>
    supabase
      .from("transactions")
      .select(
        "id, doctor_id, amount, type, reference_type, reference_id, description_ar, transaction_date"
      )
      .eq("clinic_id", clinicId)
      .gte("transaction_date", input.dateFrom)
      .lte("transaction_date", input.dateTo)
      .in("type", ["assistant_payroll_doctor", "assistant_payroll_clinic"])
      .order("id", { ascending: true });

  const buildEntriesQuery = () =>
    supabase
      .from("salary_entries")
      .select(
        `
      id, assistant_id, amount, entry_type, entry_date, notes_ar,
      assistant:assistants!assistant_id(
        id, full_name_ar, doctor_id, doctor_share_percentage
      )
    `
      )
      .eq("clinic_id", clinicId)
      .gte("entry_date", input.dateFrom)
      .lte("entry_date", input.dateTo)
      .eq("entry_type", "daily_wage")
      .not("assistant_id", "is", null)
      .order("id", { ascending: true });

  const [txRes, entriesRes] = await Promise.all([
    fetchAllRows<TxRow>(buildTxQuery),
    fetchAllRows<Record<string, unknown>>(buildEntriesQuery),
  ]);

  const confirmedEntryIds = await fetchDailyConfirmedEntryIds(
    supabase,
    clinicId,
    (entriesRes.data ?? []).map((row) => String(row.id ?? "")).filter(Boolean)
  );

  const entryRows = [...(entriesRes.data ?? [])].sort((a, b) => {
    const dateCmp = String(a.entry_date ?? "").localeCompare(
      String(b.entry_date ?? "")
    );
    if (dateCmp !== 0) return dateCmp;
    return String(a.id ?? "").localeCompare(String(b.id ?? ""));
  });

  const assistantFallback = new Map<
    string,
    {
      doctor_id: string;
      full_name_ar: string;
      doctor_share_percentage: number;
    }
  >();
  const missingAssistantIds = new Set<string>();
  for (const raw of entryRows) {
    const row = raw as Record<string, unknown>;
    const assistantId = row.assistant_id ? String(row.assistant_id) : "";
    if (!assistantId) continue;
    const assistantRaw = row.assistant;
    const assistant = Array.isArray(assistantRaw)
      ? (assistantRaw[0] as Record<string, unknown> | undefined)
      : (assistantRaw as Record<string, unknown> | null);
    if (!assistant) missingAssistantIds.add(assistantId);
  }
  if (missingAssistantIds.size > 0) {
    const { data: assistants } = await supabase
      .from("assistants")
      .select("id, full_name_ar, doctor_id, doctor_share_percentage")
      .eq("clinic_id", clinicId)
      .in("id", [...missingAssistantIds]);
    for (const a of assistants ?? []) {
      assistantFallback.set(String(a.id), {
        doctor_id: String(a.doctor_id ?? ""),
        full_name_ar: String(a.full_name_ar ?? "مساعد"),
        doctor_share_percentage: num(a.doctor_share_percentage),
      });
    }
  }

  const batches = new Map<
    string,
    { doctor?: TxRow; clinic?: TxRow; doctorId?: string }
  >();

  for (const raw of txRes.data ?? []) {
    const tx = raw as TxRow;
    const key = tx.reference_id ?? tx.id;
    const batch = batches.get(key) ?? {};
    if (tx.type === "assistant_payroll_doctor") {
      batch.doctor = tx;
      if (tx.doctor_id) batch.doctorId = tx.doctor_id;
    } else if (tx.type === "assistant_payroll_clinic") {
      batch.clinic = tx;
    }
    batches.set(key, batch);
  }

  const recordIds = new Set<string>();
  for (const batch of batches.values()) {
    const parentId = parseReferenceParentId(
      batch.doctor?.reference_id ?? batch.clinic?.reference_id
    );
    // مراجع التصحيح مثل "salary-entry:<id>" ليست UUID — لو دخلت في .in("id")
    // يرفض Postgres الاستعلام كله ولا يُطابَق أي سجل راتب شهري.
    if (parentId && UUID_RE.test(parentId)) recordIds.add(parentId);
  }

  const recordById = new Map<
    string,
    {
      assistant_id: string;
      assistant_name_ar: string;
      doctor_id: string;
      doctor_share_percentage: number;
    }
  >();

  if (recordIds.size > 0) {
    const { data: records } = await fetchAllRowsInChunks<{
      id: string;
      assistant_id: string | null;
      assistant_name_ar: string | null;
      doctor_id: string | null;
      doctor_share_percentage: number | string | null;
    }>([...recordIds], (chunk) =>
      supabase
        .from("payroll_records")
        .select(
          "id, assistant_id, assistant_name_ar, doctor_id, doctor_share_percentage"
        )
        .eq("clinic_id", clinicId)
        .in("id", chunk)
        .order("id", { ascending: true })
    );

    for (const r of records ?? []) {
      recordById.set(String(r.id), {
        assistant_id: String(r.assistant_id),
        assistant_name_ar: String(r.assistant_name_ar ?? "مساعد"),
        doctor_id: String(r.doctor_id),
        doctor_share_percentage: num(r.doctor_share_percentage),
      });
    }
  }

  const lines: DailyAssistantPayrollLine[] = [];
  const confirmedTotalsByAssistant = new Map<string, number>();

  for (const [batchKey, batch] of batches) {
    // الحركات موقّعة: سالب = خصم، موجب = تصحيح يرجّع جزء من خصم سابق
    const doctorDeduction = roundMoney(-num(batch.doctor?.amount));
    const clinicShare = roundMoney(-num(batch.clinic?.amount));
    const totalSalary = roundMoney(doctorDeduction + clinicShare);
    if (Math.abs(totalSalary) <= FINANCIAL_EPSILON) continue;

    const parentId = parseReferenceParentId(
      batch.doctor?.reference_id ?? batch.clinic?.reference_id
    );
    const record = parentId ? recordById.get(parentId) : undefined;
    const resolvedDoctorId =
      record?.doctor_id ?? batch.doctorId ?? batch.doctor?.doctor_id ?? "";
    if (!resolvedDoctorId) continue;
    if (doctorId && resolvedDoctorId !== doctorId) continue;

    const assistantId = record?.assistant_id ?? null;
    if (assistantId && totalSalary > 0) {
      confirmedTotalsByAssistant.set(
        assistantId,
        roundMoney(
          (confirmedTotalsByAssistant.get(assistantId) ?? 0) + totalSalary
        )
      );
    }

    const pct =
      record?.doctor_share_percentage ??
      roundMoney((doctorDeduction / totalSalary) * 100);

    lines.push({
      id: `tx-${batchKey}`,
      doctorId: resolvedDoctorId,
      assistantId,
      assistantName: record?.assistant_name_ar ?? extractAssistantNameFromDesc(
        batch.doctor?.description_ar ?? batch.clinic?.description_ar
      ),
      lineDate: String(
        batch.doctor?.transaction_date ??
          batch.clinic?.transaction_date ??
          input.dateTo
      ),
      totalSalary,
      doctorDeduction,
      clinicShare,
      doctorSharePct: pct,
      statusLabel: "صرف مؤكّد",
      isCorrection: totalSalary < 0,
    });
  }

  const coveredByAssistant = new Map(confirmedTotalsByAssistant);

  for (const raw of entryRows) {
    const row = raw as Record<string, unknown>;
    const assistantId = row.assistant_id ? String(row.assistant_id) : null;
    if (!assistantId) continue;
    // أجر يومي مؤكَّد صرفه بحركة خاصة به — يظهر أعلاه كـ «صرف مؤكّد»
    if (confirmedEntryIds.has(String(row.id ?? ""))) continue;

    const assistantRaw = row.assistant;
    let assistant = Array.isArray(assistantRaw)
      ? (assistantRaw[0] as Record<string, unknown> | undefined)
      : (assistantRaw as Record<string, unknown> | null);
    if (!assistant) {
      const fallback = assistantFallback.get(assistantId);
      if (!fallback?.doctor_id) continue;
      assistant = {
        doctor_id: fallback.doctor_id,
        full_name_ar: fallback.full_name_ar,
        doctor_share_percentage: fallback.doctor_share_percentage,
      };
    }

    const resolvedDoctorId = String(assistant.doctor_id ?? "");
    if (!resolvedDoctorId) continue;
    if (doctorId && resolvedDoctorId !== doctorId) continue;

    const amount = roundMoney(num(row.amount));
    if (amount <= FINANCIAL_EPSILON) continue;

    const covered = roundMoney(coveredByAssistant.get(assistantId) ?? 0);
    if (covered >= amount - FINANCIAL_EPSILON) {
      coveredByAssistant.set(assistantId, roundMoney(covered - amount));
      continue;
    }
    if (covered > FINANCIAL_EPSILON) {
      coveredByAssistant.set(assistantId, 0);
    }
    const pendingAmount = roundMoney(amount - Math.max(0, covered));
    if (pendingAmount <= FINANCIAL_EPSILON) continue;

    const pct = num(assistant.doctor_share_percentage);
    const breakdown = breakdownAssistantSalary({
      total_salary: pendingAmount,
      doctor_share_percentage: pct,
    });

    lines.push({
      id: `entry-${String(row.id)}`,
      doctorId: resolvedDoctorId,
      assistantId,
      assistantName: String(assistant.full_name_ar ?? "مساعد"),
      lineDate: String(row.entry_date ?? input.dateTo),
      totalSalary: breakdown.totalSalary,
      doctorDeduction: breakdown.doctorShare,
      clinicShare: breakdown.clinicShare,
      doctorSharePct: breakdown.doctorSharePercentage,
      statusLabel: "أجر مسجّل",
    });
  }

  return lines.sort((a, b) => {
    const dateCmp = b.lineDate.localeCompare(a.lineDate);
    if (dateCmp !== 0) return dateCmp;
    return a.assistantName.localeCompare(b.assistantName, "ar");
  });
}

function extractAssistantNameFromDesc(desc: string | null | undefined): string {
  const text = String(desc ?? "").trim();
  const m = text.match(/مساعد\s+(.+?)\s+—/);
  if (m?.[1]) return m[1].trim();
  return "مساعد";
}

export function sumAssistantPayrollClinicShare(
  lines: DailyAssistantPayrollLine[],
  mode: "all" | "registered" | "confirmed" = "all"
): number {
  return roundMoney(
    lines
      .filter((line) => {
        if (mode === "registered") return line.statusLabel === "أجر مسجّل";
        if (mode === "confirmed") return line.statusLabel === "صرف مؤكّد";
        return true;
      })
      .reduce((sum, line) => sum + line.clinicShare, 0)
  );
}

/** حصة العيادة من أجور مساعدين مسجّلة ولم تُؤكَّد صرفها بعد — نفس الكشف المالي */
export async function fetchRegisteredAssistantPayrollClinicDeduction(
  supabase: SupabaseClient,
  clinicId: string,
  from: string,
  to: string
): Promise<number> {
  const lines = await fetchDailyAssistantPayrollLines(supabase, clinicId, {
    dateFrom: from,
    dateTo: to,
  });
  let total = sumAssistantPayrollClinicShare(lines, "registered");

  const handledAssistantIds = new Set<string>();
  for (const line of lines) {
    if (
      line.statusLabel === "أجر مسجّل" &&
      line.assistantId &&
      line.clinicShare > FINANCIAL_EPSILON
    ) {
      handledAssistantIds.add(line.assistantId);
    }
  }

  const { data: records, error } = await fetchAllRows<{
    assistant_id: string | null;
    clinic_share_amount: number | string | null;
    paid_clinic_share_amount: number | string | null;
    doctor_share_percentage: number | null;
    assistant: unknown;
  }>(() =>
    supabase
      .from("payroll_records")
      .select(
        `
      id,
      assistant_id,
      clinic_share_amount,
      paid_clinic_share_amount,
      doctor_share_percentage,
      assistant:assistants!assistant_id(compensation_mode, doctor_share_percentage)
    `
      )
      .eq("clinic_id", clinicId)
      .neq("status", "paid")
      .order("id", { ascending: true })
  );

  if (!error && records?.length) {
    for (const row of records) {
      const assistantId = row.assistant_id ? String(row.assistant_id) : "";
      if (assistantId && handledAssistantIds.has(assistantId)) continue;

      const assistantRaw = row.assistant;
      const assistant = Array.isArray(assistantRaw)
        ? assistantRaw[0]
        : assistantRaw;
      const dailyWage = isDailyWageAssistant(
        normalizeAssistantCompensationMode(
          (assistant as { compensation_mode?: string } | null)
            ?.compensation_mode
        )
      );
      // الأجر اليومي من السطور فقط — تجنّب خصم شهر كامل من payroll_records
      if (dailyWage) continue;

      const doctorSharePct = Number(
        (assistant as { doctor_share_percentage?: number } | null)
          ?.doctor_share_percentage ?? row.doctor_share_percentage ?? 0
      );
      const pendingClinic = assistantPendingClinicShare(
        row as PayrollRecordPendingRow,
        { dailyWage: false, doctorSharePercentage: doctorSharePct }
      );
      if (pendingClinic <= FINANCIAL_EPSILON) continue;
      total = roundMoney(total + pendingClinic);
    }
  }

  return roundMoney(total);
}

export function sumAssistantPayrollDoctorDeduction(
  lines: DailyAssistantPayrollLine[],
  mode: "all" | "registered" | "confirmed" = "all"
): number {
  return roundMoney(
    lines
      .filter((line) => {
        if (mode === "registered") return line.statusLabel === "أجر مسجّل";
        if (mode === "confirmed") return line.statusLabel === "صرف مؤكّد";
        return true;
      })
      .reduce((sum, line) => sum + line.doctorDeduction, 0)
  );
}

/** حصة الطبيب من أجور مساعدين — مجمّعة حسب الطبيب (نفس منطق الكشف المالي) */
export async function fetchRegisteredAssistantPayrollDoctorDeductionMap(
  supabase: SupabaseClient,
  clinicId: string,
  input: { dateFrom: string; dateTo: string },
  doctorIds?: string[]
): Promise<Map<string, number>> {
  const lines = await fetchDailyAssistantPayrollLines(supabase, clinicId, input);
  const registered = lines.filter((line) => line.statusLabel === "أجر مسجّل");
  const byDoctor = sumAssistantPayrollByDoctor(registered);
  const map = new Map<string, number>();

  for (const [doctorId, totals] of byDoctor) {
    if (doctorIds?.length && !doctorIds.includes(doctorId)) continue;
    if (totals.doctorDeduction <= FINANCIAL_EPSILON) continue;
    map.set(doctorId, totals.doctorDeduction);
  }

  return map;
}

/** حصة طبيب واحد من أجور مساعده المسجّلة في شهر */
export async function fetchRegisteredAssistantPayrollDoctorDeductionForAssistant(
  supabase: SupabaseClient,
  clinicId: string,
  assistantId: string,
  from: string,
  to: string
): Promise<number> {
  const lines = await fetchDailyAssistantPayrollLines(supabase, clinicId, {
    dateFrom: from,
    dateTo: to,
  });
  return roundMoney(
    lines
      .filter(
        (line) =>
          line.assistantId === assistantId && line.statusLabel === "أجر مسجّل"
      )
      .reduce((sum, line) => sum + line.doctorDeduction, 0)
  );
}

type PayrollRecordPendingRow = Pick<
  PayrollRecord,
  | "doctor_id"
  | "assistant_id"
  | "doctor_share_amount"
  | "paid_doctor_share_amount"
  | "clinic_share_amount"
  | "paid_clinic_share_amount"
  | "total_salary"
  | "paid_total_salary"
  | "status"
  | "doctor_share_percentage"
> & {
  assistant?:
    | { compensation_mode?: string; doctor_share_percentage?: number }
    | { compensation_mode?: string; doctor_share_percentage?: number }[]
    | null;
};

/**
 * خصم أجور مساعدين من محفظة الطبيب — صرف مؤكَّد فقط (بعد «تأكيد الدفع»).
 * التسجيل وحده لا يخصم؛ يخصم عند إنشاء حركة assistant_payroll_doctor.
 */
export async function fetchDoctorAssistantPayrollDeductionByDoctor(
  supabase: SupabaseClient,
  doctorIds: string[],
  dateRange?: { from: string; to: string }
): Promise<Map<string, number>> {
  const map = new Map<string, number>();
  if (!doctorIds.length) return map;

  const range = dateRange ?? { from: "2000-01-01", to: todayISO() };

  // نحسب من صافي حركات transactions مباشرة (موقّع، بلا فلترة amount < 0)
  // وليس من تجميع الأسطر — لأن حركات "تصحيح" الموجبة (استرجاع جزء من خصم
  // سابق بعد حذف/تعديل يوم عمل مساعد) كانت تُحسب كخصم إضافي بالخطأ بدل أن
  // تُطرح من الخصم الكلي. هذا يطابق get_doctor_wallet_stats في القاعدة تماماً.
  const { data } = await fetchAllRows<{
    doctor_id: string | null;
    amount: number | string | null;
  }>(() =>
    supabase
      .from("transactions")
      .select("doctor_id, amount")
      .in("doctor_id", doctorIds)
      .eq("type", "assistant_payroll_doctor")
      .gte("transaction_date", range.from)
      .lte("transaction_date", range.to)
      .order("id", { ascending: true })
  );

  const netByDoctor = new Map<string, number>();
  for (const row of data ?? []) {
    const doctorId = String(row.doctor_id ?? "");
    if (!doctorId) continue;
    netByDoctor.set(
      doctorId,
      roundMoney((netByDoctor.get(doctorId) ?? 0) + Number(row.amount ?? 0))
    );
  }

  for (const doctorId of doctorIds) {
    const net = netByDoctor.get(doctorId) ?? 0;
    const deduction = Math.max(0, roundMoney(-net));
    if (deduction <= FINANCIAL_EPSILON) continue;
    map.set(doctorId, roundMoney((map.get(doctorId) ?? 0) + deduction));
  }

  return map;
}

/** أجور مساعدين المسجّلة فقط (قبل تأكيد الصرف) — للعرض والإشعارات */
export async function fetchWalletAssistantPayrollPendingByDoctor(
  supabase: SupabaseClient,
  doctorIds: string[],
  dateRange?: { from: string; to: string }
): Promise<Map<string, number>> {
  const map = new Map<string, number>();
  if (!doctorIds.length) return map;

  const range = dateRange ?? { from: "2000-01-01", to: todayISO() };

  const { data: doctors } = await supabase
    .from("doctors")
    .select("id, clinic_id")
    .in("id", doctorIds);

  const byClinic = new Map<string, Set<string>>();
  for (const row of doctors ?? []) {
    const clinicId = String(row.clinic_id ?? "");
    const doctorId = String(row.id ?? "");
    if (!clinicId || !doctorId) continue;
    const scoped = byClinic.get(clinicId) ?? new Set<string>();
    scoped.add(doctorId);
    byClinic.set(clinicId, scoped);
  }

  for (const [clinicId, clinicDoctorIds] of byClinic) {
    const lines = await fetchDailyAssistantPayrollLines(supabase, clinicId, {
      dateFrom: range.from,
      dateTo: range.to,
    });
    for (const line of lines) {
      if (line.statusLabel !== "أجر مسجّل") continue;
      if (!clinicDoctorIds.has(line.doctorId)) continue;
      if (line.doctorDeduction <= FINANCIAL_EPSILON) continue;
      map.set(
        line.doctorId,
        roundMoney((map.get(line.doctorId) ?? 0) + line.doctorDeduction)
      );
    }
  }

  return map;
}

export function sumAssistantPayrollByDoctor(
  lines: DailyAssistantPayrollLine[]
): Map<
  string,
  { doctorDeduction: number; clinicShare: number; totalSalary: number; count: number }
> {
  const map = new Map<
    string,
    { doctorDeduction: number; clinicShare: number; totalSalary: number; count: number }
  >();
  for (const line of lines) {
    const prev = map.get(line.doctorId) ?? {
      doctorDeduction: 0,
      clinicShare: 0,
      totalSalary: 0,
      count: 0,
    };
    map.set(line.doctorId, {
      doctorDeduction: roundMoney(prev.doctorDeduction + line.doctorDeduction),
      clinicShare: roundMoney(prev.clinicShare + line.clinicShare),
      totalSalary: roundMoney(prev.totalSalary + line.totalSalary),
      count: prev.count + 1,
    });
  }
  return map;
}
