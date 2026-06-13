import { getAdminClient } from "@/lib/supabase/admin";

export interface AssistantApiContext {
  profileId: string;
  assistantId: string;
  doctorId: string;
  clinicId: string;
}

type ProfileRow = {
  id: string;
  role?: string | null;
  clinic_id?: string | null;
};

/** Resolve linked doctor for assistant API routes — returns null if not linked */
export async function resolveAssistantApiContext(
  profile: ProfileRow | null | undefined
): Promise<AssistantApiContext | null> {
  if (!profile?.id || !profile.clinic_id) return null;
  if (String(profile.role ?? "").toLowerCase() !== "assistant") return null;

  const admin = getAdminClient();
  const { data: assistant } = await admin
    .from("assistants")
    .select("id, doctor_id, clinic_id, is_active")
    .eq("profile_id", profile.id)
    .eq("clinic_id", profile.clinic_id)
    .eq("is_active", true)
    .maybeSingle();

  if (!assistant?.doctor_id) return null;

  return {
    profileId: profile.id,
    assistantId: assistant.id as string,
    doctorId: assistant.doctor_id as string,
    clinicId: assistant.clinic_id as string,
  };
}

/** Verify queue entry belongs to assistant's linked doctor */
export async function assertAssistantOwnsQueueEntry(
  entryId: string,
  ctx: AssistantApiContext
): Promise<{ ok: true } | { ok: false; error: string; status: number }> {
  const admin = getAdminClient();
  const { data: entry } = await admin
    .from("patient_queue")
    .select("id, doctor_id, clinic_id")
    .eq("id", entryId)
    .maybeSingle();

  if (!entry) {
    return { ok: false, error: "الدور غير موجود", status: 404 };
  }
  if (
    entry.doctor_id !== ctx.doctorId ||
    entry.clinic_id !== ctx.clinicId
  ) {
    return { ok: false, error: "غير مصرح", status: 403 };
  }
  return { ok: true };
}
