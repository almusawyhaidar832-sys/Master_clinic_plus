import type { SupabaseClient } from "@supabase/supabase-js";
import { breakdownAssistantSalary } from "@/lib/services/assistant-payroll";
import { FINANCIAL_EPSILON } from "@/lib/services/patient-financial-plan";

export type DailyAssistantPayrollLine = {
  id: string;
  doctorId: string;
  assistantId: string | null;
  assistantName: string;
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

/** أجور مساعدي الأطباء في يوم محدد — صرف مؤكّد + تسجيل أجر يومي */
export async function fetchDailyAssistantPayrollLines(
  supabase: SupabaseClient,
  clinicId: string,
  date: string,
  doctorId?: string
): Promise<DailyAssistantPayrollLine[]> {
  const txQuery = supabase
    .from("transactions")
    .select(
      "id, doctor_id, amount, type, reference_type, reference_id, description_ar, transaction_date"
    )
    .eq("clinic_id", clinicId)
    .eq("transaction_date", date)
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
    .eq("entry_date", date)
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
  const confirmedAssistantIds = new Set<string>();

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
    if (assistantId) confirmedAssistantIds.add(assistantId);

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
      totalSalary,
      doctorDeduction,
      clinicShare,
      doctorSharePct: pct,
      statusLabel: "صرف مؤكّد",
    });
  }

  for (const raw of entriesRes.data ?? []) {
    const row = raw as Record<string, unknown>;
    const assistantId = row.assistant_id ? String(row.assistant_id) : null;
    if (!assistantId || confirmedAssistantIds.has(assistantId)) continue;

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

    const pct = num(assistant.doctor_share_percentage);
    const breakdown = breakdownAssistantSalary({
      total_salary: amount,
      doctor_share_percentage: pct,
    });

    lines.push({
      id: `entry-${String(row.id)}`,
      doctorId: resolvedDoctorId,
      assistantId,
      assistantName: String(assistant.full_name_ar ?? "مساعد"),
      totalSalary: breakdown.totalSalary,
      doctorDeduction: breakdown.doctorShare,
      clinicShare: breakdown.clinicShare,
      doctorSharePct: breakdown.doctorSharePercentage,
      statusLabel: "أجر مسجّل",
    });
  }

  return lines.sort((a, b) =>
    a.assistantName.localeCompare(b.assistantName, "ar")
  );
}

function extractAssistantNameFromDesc(desc: string | null | undefined): string {
  const text = String(desc ?? "").trim();
  const m = text.match(/مساعد\s+(.+?)\s+—/);
  if (m?.[1]) return m[1].trim();
  return "مساعد";
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
