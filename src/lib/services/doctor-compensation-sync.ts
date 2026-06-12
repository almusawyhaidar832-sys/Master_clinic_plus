import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import { previewTreatmentSplit } from "@/lib/services/patient-financial-plan";
import type { Doctor, DoctorPercentage, MaterialsCostShare } from "@/types";

const MISSING_PAYMENT_SQL =
  "شغّل في Supabase: supabase/scripts/add-doctor-payment-type.sql";

export function doctorPaymentMigrationHint(): string {
  return MISSING_PAYMENT_SQL;
}

/** تحديث حصص الحالات الجديدة فقط (بدون أي دفعة سابقة) بعد تغيير اتفاق الطبيب المالي */
export async function refreshActiveTreatmentCaseSharesForDoctor(
  admin: SupabaseClient,
  clinicId: string,
  doctorId: string,
  doctor: Doctor
): Promise<{ updated: number; error?: string }> {
  const { data: byPrimary, error: primaryErr } = await admin
    .from("patient_treatment_cases")
    .select("id, final_price, total_paid, status")
    .eq("clinic_id", clinicId)
    .eq("primary_doctor_id", doctorId)
    .eq("status", "active");

  if (primaryErr) {
    return { updated: 0, error: primaryErr.message };
  }

  const { data: opLinks, error: opErr } = await admin
    .from("patient_operations")
    .select("treatment_case_id")
    .eq("doctor_id", doctorId)
    .not("treatment_case_id", "is", null);

  if (opErr) {
    return { updated: 0, error: opErr.message };
  }

  const caseIds = new Set<string>();
  for (const row of byPrimary ?? []) {
    caseIds.add(row.id as string);
  }
  for (const row of opLinks ?? []) {
    const id = row.treatment_case_id as string | null;
    if (id) caseIds.add(id);
  }

  if (!caseIds.size) {
    return { updated: 0 };
  }

  const { data: cases, error: casesErr } = await admin
    .from("patient_treatment_cases")
    .select("id, final_price, total_paid, status")
    .eq("clinic_id", clinicId)
    .in("id", [...caseIds])
    .eq("status", "active");

  if (casesErr) {
    return { updated: 0, error: casesErr.message };
  }

  let updated = 0;
  for (const row of cases ?? []) {
    const finalPrice = Number(row.final_price ?? 0);
    const totalPaid = Number(row.total_paid ?? 0);
    if (finalPrice <= 0) continue;
    if (totalPaid >= finalPrice - 0.01) continue;
    if (totalPaid > 0.01) continue;

    const split = previewTreatmentSplit(finalPrice, 0, doctor);
    const doctorShare = split?.doctorShare ?? 0;
    const clinicShare =
      split?.clinicShare ?? Math.max(0, Math.round(finalPrice * 100) / 100);

    const { error: updateErr } = await admin
      .from("patient_treatment_cases")
      .update({
        doctor_share_total: doctorShare,
        clinic_share_total: clinicShare,
        updated_at: new Date().toISOString(),
      })
      .eq("id", row.id);

    if (updateErr) {
      return { updated, error: updateErr.message };
    }
    updated += 1;
  }

  return { updated };
}

export function mapDoctorRowForShareCalc(
  row: Record<string, unknown>
): Doctor {
  return {
    id: String(row.id),
    clinic_id: String(row.clinic_id),
    profile_id: (row.profile_id as string | null) ?? null,
    full_name_ar: String(row.full_name_ar ?? ""),
    specialty_ar: (row.specialty_ar as string | null) ?? null,
    phone: (row.phone as string | null) ?? null,
    percentage: String(row.percentage ?? "50") as DoctorPercentage,
    materials_share: String(row.materials_share ?? "0") as MaterialsCostShare,
    payment_type:
      row.payment_type === "salary" ? "salary" : "percentage",
    salary_amount: Number(row.salary_amount ?? 0),
    is_active: Boolean(row.is_active ?? true),
  };
}
