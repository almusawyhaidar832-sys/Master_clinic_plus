import type { SupabaseClient } from "@supabase/supabase-js";
import { getAuthAdmin } from "@/lib/supabase/auth-helpers";
import { ensureEvolutionInstanceNamed } from "@/lib/whatsapp/evolution-client";

export function buildClinicInstanceName(
  clinicId: string,
  clinicName?: string | null
): string {
  const slug = (clinicName || "clinic")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_|_$/g, "")
    .slice(0, 24);
  const short = clinicId.replace(/-/g, "").slice(0, 8);
  const raw = `mc_${slug || "clinic"}_${short}`;
  return raw.slice(0, 48);
}

export type CreatePlatformClinicInput = {
  clinic_name: string;
  clinic_name_ar?: string;
  clinic_phone?: string;
  specialty?: string;
  admin_full_name: string;
  admin_username: string;
  admin_password: string;
  provision_evolution?: boolean;
};

export type CreatePlatformClinicResult = {
  clinic_id: string;
  clinic_name: string;
  instance_name: string | null;
  evolution_ok: boolean;
  evolution_error?: string;
};

export async function createPlatformClinic(
  admin: SupabaseClient,
  input: CreatePlatformClinicInput
): Promise<
  | { ok: true; data: CreatePlatformClinicResult }
  | { ok: false; error: string; status: number }
> {
  const {
    clinic_name,
    clinic_name_ar,
    clinic_phone,
    specialty,
    admin_full_name,
    admin_username,
    admin_password,
    provision_evolution = true,
  } = input;

  if (!clinic_name?.trim() || !admin_username?.trim() || !admin_password) {
    return { ok: false, error: "جميع الحقول الأساسية مطلوبة", status: 400 };
  }
  if (admin_password.length < 6) {
    return { ok: false, error: "كلمة المرور 6 أحرف على الأقل", status: 400 };
  }

  const { data: existing } = await admin
    .from("profiles")
    .select("id")
    .eq("username", admin_username)
    .maybeSingle();

  if (existing) {
    return { ok: false, error: "اسم المستخدم محجوز", status: 409 };
  }

  const { data: clinic, error: clinicErr } = await admin
    .from("clinics")
    .insert({
      name: clinic_name.trim(),
      name_ar: (clinic_name_ar || clinic_name).trim(),
      phone: clinic_phone?.trim() || null,
    })
    .select("id, name, name_ar")
    .single();

  if (clinicErr || !clinic) {
    return {
      ok: false,
      error: `فشل إنشاء العيادة: ${clinicErr?.message ?? "unknown"}`,
      status: 500,
    };
  }

  const instanceName = buildClinicInstanceName(
    clinic.id,
    clinic.name_ar || clinic.name
  );

  await admin.rpc("seed_clinic_settings", {
    p_clinic_id: clinic.id,
    p_specialty: specialty || "dental",
  });

  let evolutionOk = false;
  let evolutionError: string | undefined;

  if (provision_evolution) {
    const evo = await ensureEvolutionInstanceNamed(instanceName);
    evolutionOk = evo.ok;
    evolutionError = evo.error;
    await admin
      .from("clinics")
      .update({ whatsapp_session_id: instanceName })
      .eq("id", clinic.id);
  }

  const fakeEmail = `${admin_username}@clinic.internal`;
  const { data: authData, error: authErr } = await getAuthAdmin(admin).createUser(
    {
      email: fakeEmail,
      password: admin_password,
      email_confirm: true,
      user_metadata: { full_name: admin_full_name, username: admin_username },
    }
  );

  if (authErr || !authData.user) {
    await admin.from("clinics").delete().eq("id", clinic.id);
    return {
      ok: false,
      error: authErr?.message ?? "فشل إنشاء حساب المدير",
      status: 500,
    };
  }

  const { error: profileErr } = await admin.from("profiles").insert({
    id: authData.user.id,
    clinic_id: clinic.id,
    role: "super_admin",
    full_name: admin_full_name,
    username: admin_username,
    is_active: true,
  });

  if (profileErr) {
    await getAuthAdmin(admin).deleteUser(authData.user.id);
    await admin.from("clinics").delete().eq("id", clinic.id);
    return { ok: false, error: profileErr.message, status: 500 };
  }

  return {
    ok: true,
    data: {
      clinic_id: clinic.id,
      clinic_name: (clinic.name_ar || clinic.name) as string,
      instance_name: provision_evolution ? instanceName : null,
      evolution_ok: evolutionOk,
      evolution_error: evolutionError,
    },
  };
}

/** حذف عيادة وبياناتها (CASCADE) + حسابات Auth للطاقم */
export async function deletePlatformClinic(
  admin: SupabaseClient,
  clinicId: string
): Promise<{ ok: true } | { ok: false; error: string }> {
  const { data: profiles } = await admin
    .from("profiles")
    .select("id")
    .eq("clinic_id", clinicId);

  for (const row of profiles ?? []) {
    try {
      await getAuthAdmin(admin).deleteUser(row.id);
    } catch (e) {
      console.error("[deletePlatformClinic] auth_delete", row.id, e);
    }
  }

  const { error } = await admin.from("clinics").delete().eq("id", clinicId);

  if (error) {
    return { ok: false, error: error.message };
  }

  return { ok: true };
}
