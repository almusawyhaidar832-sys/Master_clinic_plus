import type { SupabaseClient } from "@supabase/supabase-js";
import {
  isValidSanitizedUsername,
  sanitizeUsername,
  usernameToAuthEmail,
} from "@/lib/auth/credentials";
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

  const safeUsername = sanitizeUsername(admin_username);
  if (!isValidSanitizedUsername(safeUsername)) {
    return {
      ok: false,
      error:
        "اسم مستخدم المدير: 3–32 حرفاً إنجليزياً (a-z، أرقام، . _ -) — مثل owner1 أو clinic_admin",
      status: 400,
    };
  }

  const { data: existing } = await admin
    .from("profiles")
    .select("id")
    .eq("username", safeUsername)
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

  const authEmail = usernameToAuthEmail(safeUsername);
  const { data: authData, error: authErr } = await getAuthAdmin(admin).createUser(
    {
      email: authEmail,
      password: admin_password,
      email_confirm: true,
      user_metadata: { full_name: admin_full_name, username: safeUsername },
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
    username: safeUsername,
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

export type DeletePlatformClinicResult = {
  clinic_name?: string;
  auth_users_deleted?: number;
  storage_files_deleted?: number;
  message?: string;
};

/** حذف عيادة نهائياً — كل البيانات + حسابات الدخول + ملفات الأشعة */
export async function deletePlatformClinic(
  admin: SupabaseClient,
  clinicId: string
): Promise<
  | { ok: true; details: DeletePlatformClinicResult }
  | { ok: false; error: string }
> {
  const { data: rpcData, error: rpcError } = await admin.rpc(
    "platform_delete_clinic_completely",
    { p_clinic_id: clinicId }
  );

  if (rpcError) {
    const fnMissing =
      rpcError.message.includes("platform_delete_clinic_completely") ||
      rpcError.message.includes("Could not find the function") ||
      rpcError.code === "PGRST202";
    if (!fnMissing) {
      return { ok: false, error: rpcError.message };
    }
    console.warn("[deletePlatformClinic] RPC missing, fallback:", rpcError.message);
  } else if (rpcData && typeof rpcData === "object") {
    const row = rpcData as Record<string, unknown>;
    if (row.error) {
      return { ok: false, error: String(row.error) };
    }
    if (row.ok) {
      return {
        ok: true,
        details: {
          clinic_name: String(row.clinic_name ?? ""),
          auth_users_deleted: Number(row.auth_users_deleted ?? 0),
          storage_files_deleted: Number(row.storage_files_deleted ?? 0),
          message: String(row.message ?? "تم حذف العيادة وجميع بياناتها"),
        },
      };
    }
  }

  // وضع احتياطي — فقط إذا RPC غير موجود على Supabase

  const { data: profiles } = await admin
    .from("profiles")
    .select("id")
    .eq("clinic_id", clinicId);

  await admin.from("session_refunds").delete().eq("clinic_id", clinicId);

  const { data: clinicDoctors } = await admin
    .from("doctors")
    .select("id")
    .eq("clinic_id", clinicId);
  const { data: clinicPatients } = await admin
    .from("patients")
    .select("id")
    .eq("clinic_id", clinicId);

  const doctorIds = (clinicDoctors ?? []).map((d) => d.id);
  const patientIds = (clinicPatients ?? []).map((p) => p.id);

  if (doctorIds.length > 0) {
    await admin.from("patient_operations").delete().in("doctor_id", doctorIds);
  }
  if (patientIds.length > 0) {
    await admin.from("patient_operations").delete().in("patient_id", patientIds);
  }
  await admin.from("patient_operations").delete().eq("clinic_id", clinicId);

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

  return {
    ok: true,
    details: {
      message: "تم حذف العيادة وجميع بياناتها (وضع احتياطي)",
      auth_users_deleted: profiles?.length ?? 0,
    },
  };
}
