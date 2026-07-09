import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import { isDailyWageAssistant } from "@/lib/services/assistant-compensation";
import {
  assistantIsFullyPaid,
  assistantPaidClinicShare,
  assistantPaidDoctorShare,
  assistantPaidTotalSalary,
  slipIsFullyPaid,
  slipPaidNet,
} from "@/lib/services/payroll-paid-portions";
import { listSalaryEntriesForPersonMonth } from "@/lib/services/salary-entries-server";
import type { PayrollRecord, SalarySlip } from "@/types";

function roundMoney(n: number): number {
  return Math.round(n * 100) / 100;
}

type AssistantTxRow = {
  type: string;
  amount: number;
  reference_id: string | null;
};

function sumAssistantPaidFromTransactions(
  recordId: string,
  entryIds: Set<string>,
  rows: AssistantTxRow[]
): { doctor: number; clinic: number } {
  let doctor = 0;
  let clinic = 0;
  const recordPrefix = `${recordId}:`;

  for (const tx of rows) {
    const ref = String(tx.reference_id ?? "");
    const matchesRecord = ref === recordId || ref.startsWith(recordPrefix);
    const matchesEntry = entryIds.has(ref);
    if (!matchesRecord && !matchesEntry) continue;

    const amt = roundMoney(Math.abs(Number(tx.amount ?? 0)));
    if (tx.type === "assistant_payroll_doctor") doctor += amt;
    else if (tx.type === "assistant_payroll_clinic") clinic += amt;
  }

  return {
    doctor: roundMoney(doctor),
    clinic: roundMoney(clinic),
  };
}

async function syncAssistantPayrollRecordPaid(
  admin: SupabaseClient,
  clinicId: string,
  record: PayrollRecord,
  assistantTxRows: AssistantTxRow[],
  compensationMode: string | null | undefined
): Promise<PayrollRecord> {
  const assistantId = String(record.assistant_id ?? "");
  const monthYear = String(record.month_year ?? "");
  const dailyWage = isDailyWageAssistant(compensationMode);

  const { entries } = await listSalaryEntriesForPersonMonth(
    admin,
    clinicId,
    monthYear,
    { assistantId }
  );
  const dailyEntryIds = new Set(
    entries.filter((e) => e.entry_type === "daily_wage").map((e) => e.id)
  );

  const fromTx = sumAssistantPaidFromTransactions(
    record.id,
    dailyEntryIds,
    assistantTxRows
  );

  let paidDoctor = roundMoney(
    Math.max(assistantPaidDoctorShare(record), fromTx.doctor)
  );
  let paidClinic = roundMoney(
    Math.max(assistantPaidClinicShare(record), fromTx.clinic)
  );
  let paidTotal = roundMoney(
    Math.max(
      assistantPaidTotalSalary(record),
      paidDoctor + paidClinic,
      fromTx.doctor + fromTx.clinic
    )
  );

  if (record.status === "paid" && paidTotal <= 0) {
    paidDoctor = roundMoney(Number(record.doctor_share_amount ?? 0));
    paidClinic = roundMoney(Number(record.clinic_share_amount ?? 0));
    paidTotal = roundMoney(
      Math.max(Number(record.total_salary ?? 0), paidDoctor + paidClinic)
    );
  }

  if (
    paidClinic <= 0 &&
    paidDoctor <= 0 &&
    paidTotal <= 0 &&
    record.paid_at &&
    record.status === "paid"
  ) {
    paidDoctor = roundMoney(Number(record.doctor_share_amount ?? 0));
    paidClinic = roundMoney(Number(record.clinic_share_amount ?? 0));
    paidTotal = roundMoney(
      Math.max(Number(record.total_salary ?? 0), paidDoctor + paidClinic)
    );
  }

  const accruedDoctor = roundMoney(Number(record.doctor_share_amount ?? 0));
  const accruedClinic = roundMoney(Number(record.clinic_share_amount ?? 0));
  const accruedTotal = roundMoney(Number(record.total_salary ?? 0));

  if (
    paidClinic > 0 &&
    accruedClinic > 0 &&
    paidClinic >= accruedClinic - 0.01 &&
    paidDoctor >= accruedDoctor - 0.01 &&
    !dailyWage
  ) {
    paidDoctor = Math.max(paidDoctor, accruedDoctor);
    paidClinic = Math.max(paidClinic, accruedClinic);
    paidTotal = Math.max(paidTotal, accruedTotal, paidDoctor + paidClinic);
  }

  const resolvedForStatus = {
    ...record,
    paid_doctor_share_amount: paidDoctor,
    paid_clinic_share_amount: paidClinic,
    paid_total_salary: paidTotal,
  } as PayrollRecord;

  const amountsFullyMatch =
    accruedClinic > 0 &&
    paidClinic >= accruedClinic - 0.01 &&
    paidDoctor >= accruedDoctor - 0.01;

  const status: "paid" | "generated" =
    assistantIsFullyPaid(resolvedForStatus, { dailyWage }) || amountsFullyMatch
      ? "paid"
      : "generated";

  const needsUpdate =
    roundMoney(Number(record.paid_doctor_share_amount ?? 0)) !== paidDoctor ||
    roundMoney(Number(record.paid_clinic_share_amount ?? 0)) !== paidClinic ||
    roundMoney(Number(record.paid_total_salary ?? 0)) !== paidTotal ||
    record.status !== status;

  if (!needsUpdate) {
    return record;
  }

  const paidAt =
    status === "paid" || paidTotal > 0
      ? record.paid_at ?? new Date().toISOString()
      : record.paid_at;

  const { data, error } = await admin
    .from("payroll_records")
    .update({
      paid_doctor_share_amount: paidDoctor,
      paid_clinic_share_amount: paidClinic,
      paid_total_salary: paidTotal,
      status,
      paid_at: paidAt,
    })
    .eq("id", record.id)
    .select("*")
    .single();

  if (error || !data) {
    return record;
  }

  return data as PayrollRecord;
}

async function syncStaffSlipPaid(
  admin: SupabaseClient,
  slip: SalarySlip,
  dailyWage = false
): Promise<SalarySlip> {
  let paidNet = slipPaidNet(slip);
  let status = slip.status;

  if (status === "paid" && paidNet <= 0) {
    paidNet = roundMoney(Number(slip.net_payout ?? 0));
  }

  const fullyPaid = slipIsFullyPaid(
    { ...slip, paid_net_payout: paidNet },
    { dailyWage }
  );

  if (fullyPaid) {
    status = "paid";
    paidNet = roundMoney(Math.max(paidNet, Number(slip.net_payout ?? 0)));
  } else if (paidNet > 0) {
    status = slip.status === "paid" ? "paid" : "draft";
  }

  const needsUpdate =
    roundMoney(Number(slip.paid_net_payout ?? 0)) !== paidNet ||
    slip.status !== status;

  if (!needsUpdate) {
    return slip;
  }

  const { data, error } = await admin
    .from("salary_slips")
    .update({
      paid_net_payout: paidNet,
      status,
      paid_at:
        status === "paid" || paidNet > 0
          ? slip.paid_at ?? new Date().toISOString()
          : slip.paid_at,
    })
    .eq("id", slip.id)
    .select(
      "*, staff:staff_members!staff_id(full_name_ar, job_title_ar, profile_id), doctor:doctors!doctor_id(full_name_ar)"
    )
    .single();

  if (error || !data) {
    return slip;
  }

  return data as SalarySlip;
}

/** مزامنة حالة الصرف من الحركات المالية + paid_* — يمنع عرض «غير مؤكَّد» لما دُفع فعلياً */
export async function syncPayrollMonthPaidStatus(
  admin: SupabaseClient,
  clinicId: string,
  monthYear: string,
  records: PayrollRecord[],
  slips: SalarySlip[]
): Promise<{ records: PayrollRecord[]; slips: SalarySlip[] }> {
  if (records.length === 0 && slips.length === 0) {
    return { records, slips };
  }

  const assistantIds = records
    .map((r) => String(r.assistant_id ?? ""))
    .filter(Boolean);

  const [txRes, assistantsRes, staffRes] = await Promise.all([
    admin
      .from("transactions")
      .select("type, amount, reference_id, reference_type")
      .eq("clinic_id", clinicId)
      .in("type", [
        "assistant_payroll_doctor",
        "assistant_payroll_clinic",
      ]),
    assistantIds.length
      ? admin
          .from("assistants")
          .select("id, compensation_mode")
          .eq("clinic_id", clinicId)
          .in("id", assistantIds)
      : Promise.resolve({ data: [], error: null }),
    slips.some((s) => s.staff_id)
      ? admin
          .from("staff_members")
          .select("id, compensation_mode")
          .eq("clinic_id", clinicId)
          .in(
            "id",
            slips
              .map((s) => String(s.staff_id ?? ""))
              .filter(Boolean)
          )
      : Promise.resolve({ data: [], error: null }),
  ]);

  const assistantTxRows = (txRes.data ?? []) as AssistantTxRow[];
  const compensationByAssistant = new Map(
    (assistantsRes.data ?? []).map((row) => [
      String(row.id),
      row.compensation_mode as string | null,
    ])
  );
  const compensationByStaff = new Map(
    (staffRes.data ?? []).map((row) => [
      String(row.id),
      row.compensation_mode as string | null,
    ])
  );

  const syncedRecords: PayrollRecord[] = [];
  for (const record of records) {
    const mode = compensationByAssistant.get(String(record.assistant_id ?? ""));
    syncedRecords.push(
      await syncAssistantPayrollRecordPaid(
        admin,
        clinicId,
        record,
        assistantTxRows,
        mode
      )
    );
  }

  const syncedSlips: SalarySlip[] = [];
  for (const slip of slips) {
    const dailyWage = isDailyWageAssistant(
      compensationByStaff.get(String(slip.staff_id ?? ""))
    );
    syncedSlips.push(await syncStaffSlipPaid(admin, slip, dailyWage));
  }

  return { records: syncedRecords, slips: syncedSlips };
}
