import type { SupabaseClient } from "@supabase/supabase-js";

interface AccountantProfile {
  id: string;
  full_name: string;
  base_salary: number;
  job_title: string | null;
  clinic_id: string;
  is_active: boolean;
}

/** يضمن وجود سجل staff_members مرتبط بكل محاسب نشط (لقائمة الرواتب والقسائم) */
export async function ensureAccountantStaffRows(
  admin: SupabaseClient,
  clinicId: string
): Promise<void> {
  const { data: accountants, error } = await admin
    .from("profiles")
    .select("id, full_name, base_salary, job_title, clinic_id, is_active")
    .eq("clinic_id", clinicId)
    .eq("role", "accountant")
    .eq("is_active", true);

  if (error || !accountants?.length) return;

  const { data: existingStaff } = await admin
    .from("staff_members")
    .select("id, profile_id")
    .eq("clinic_id", clinicId)
    .not("profile_id", "is", null);

  const linked = new Set(
    (existingStaff ?? []).map((s) => s.profile_id as string)
  );

  const { data: slotRows } = await admin
    .from("staff_members")
    .select("slot_number")
    .eq("clinic_id", clinicId);

  let nextSlot =
    (slotRows ?? []).reduce(
      (max, s) => Math.max(max, s.slot_number ?? 0),
      0
    ) + 1;

  for (const acc of accountants as AccountantProfile[]) {
    const job = (acc.job_title || "محاسب").trim();
    const salary = Number(acc.base_salary ?? 0);

    if (linked.has(acc.id)) {
      await admin
        .from("staff_members")
        .update({
          full_name_ar: acc.full_name,
          job_title_ar: job,
          base_salary: salary,
          is_active: true,
        })
        .eq("clinic_id", clinicId)
        .eq("profile_id", acc.id);
      continue;
    }

    await admin.from("staff_members").insert({
      clinic_id: clinicId,
      profile_id: acc.id,
      full_name_ar: acc.full_name,
      job_title_ar: job,
      base_salary: salary,
      slot_number: nextSlot++,
      is_active: true,
    });
  }
}

/** إنشاء/تحديث سجل staff_members لمحاسب واحد عند إنشاء الحساب */
export async function upsertAccountantStaffRow(
  admin: SupabaseClient,
  params: {
    clinicId: string;
    profileId: string;
    fullName: string;
    baseSalary: number;
    jobTitle?: string;
  }
): Promise<{ staffId: string } | { error: string }> {
  const job = (params.jobTitle || "محاسب").trim();

  const { data: existing } = await admin
    .from("staff_members")
    .select("id")
    .eq("profile_id", params.profileId)
    .maybeSingle();

  if (existing?.id) {
    const { error } = await admin
      .from("staff_members")
      .update({
        full_name_ar: params.fullName,
        job_title_ar: job,
        base_salary: params.baseSalary,
        is_active: true,
      })
      .eq("id", existing.id);

    if (error) return { error: error.message };
    return { staffId: existing.id as string };
  }

  const { data: slotRows } = await admin
    .from("staff_members")
    .select("slot_number")
    .eq("clinic_id", params.clinicId);

  const nextSlot =
    (slotRows ?? []).reduce(
      (max, s) => Math.max(max, s.slot_number ?? 0),
      0
    ) + 1;

  const { data: inserted, error } = await admin
    .from("staff_members")
    .insert({
      clinic_id: params.clinicId,
      profile_id: params.profileId,
      full_name_ar: params.fullName,
      job_title_ar: job,
      base_salary: params.baseSalary,
      slot_number: nextSlot,
      is_active: true,
    })
    .select("id")
    .single();

  if (error) return { error: error.message };
  return { staffId: inserted.id as string };
}
