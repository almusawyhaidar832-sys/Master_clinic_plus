import type { SupabaseClient } from "@supabase/supabase-js";
import { breakdownAssistantSalary } from "@/lib/services/assistant-payroll";
import { FINANCIAL_EPSILON } from "@/lib/services/patient-financial-plan";

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

/** أجور مساعدي الأطباء في فترة محددة — صرف مؤكّد + تسجيل أجر يومي */
export async function fetchDailyAssistantPayrollLines(
  supabase: SupabaseClient,
  clinicId: string,
  input: { dateFrom: string; dateTo: string },
  doctorId?: string
): Promise<DailyAssistantPayrollLine[]> {
  const txQuery = supabase
    .from("transactions")
    .select(
      "id, doctor_id, amount, type, reference_type, reference_id, description_ar, transaction_date"
    )
    .eq("clinic_id", clinicId)
    .gte("transaction_date", input.dateFrom)
    .lte("transaction_date", input.dateTo)
    .in("type", ["assistant_payroll_doctor", "assistant_payroll_clinic"]);

  const entriesQuery = supabase
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
    .not("assistant_id", "is", null);

  const [txRes, entriesRes] = await Promise.all([txQuery, entriesQuery]);

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
    if (parentId) recordIds.add(parentId);
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
    const { data: records } = await supabase
      .from("payroll_records")
      .select(
        "id, assistant_id, assistant_name_ar, doctor_id, doctor_share_percentage"
      )
      .eq("clinic_id", clinicId)
      .in("id", [...recordIds]);

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
    const doctorDeduction = roundMoney(
      Math.abs(num(batch.doctor?.amount))
    );
    const clinicShare = roundMoney(Math.abs(num(batch.clinic?.amount)));
    const totalSalary = roundMoney(doctorDeduction + clinicShare);
    if (totalSalary <= FINANCIAL_EPSILON) continue;

    const parentId = parseReferenceParentId(
      batch.doctor?.reference_id ?? batch.clinic?.reference_id
    );
    const record = parentId ? recordById.get(parentId) : undefined;
    const resolvedDoctorId =
      record?.doctor_id ?? batch.doctorId ?? batch.doctor?.doctor_id ?? "";
    if (!resolvedDoctorId) continue;
    if (doctorId && resolvedDoctorId !== doctorId) continue;

    const assistantId = record?.assistant_id ?? null;
    if (assistantId) {
      confirmedTotalsByAssistant.set(
        assistantId,
        roundMoney(
          (confirmedTotalsByAssistant.get(assistantId) ?? 0) + totalSalary
        )
      );
    }

    const pct =
      record?.doctor_share_percentage ??
      (totalSalary > 0
        ? roundMoney((doctorDeduction / totalSalary) * 100)
        : 0);

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
    });
  }

  const coveredByAssistant = new Map(confirmedTotalsByAssistant);
  const entryRows = [...(entriesRes.data ?? [])].sort((a, b) => {
    const dateCmp = String(a.entry_date ?? "").localeCompare(
      String(b.entry_date ?? "")
    );
    if (dateCmp !== 0) return dateCmp;
    return String(a.id ?? "").localeCompare(String(b.id ?? ""));
  });

  for (const raw of entryRows) {
    const row = raw as Record<string, unknown>;
    const assistantId = row.assistant_id ? String(row.assistant_id) : null;
    if (!assistantId) continue;

    const assistantRaw = row.assistant;
    const assistant = Array.isArray(assistantRaw)
      ? (assistantRaw[0] as Record<string, unknown> | undefined)
      : (assistantRaw as Record<string, unknown> | null);
    if (!assistant) continue;

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

/** حصة العيادة من أجور مساعدين مسجّلة ولم تُؤكَّد صرفها بعد */
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
  return sumAssistantPayrollClinicShare(lines, "registered");
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
