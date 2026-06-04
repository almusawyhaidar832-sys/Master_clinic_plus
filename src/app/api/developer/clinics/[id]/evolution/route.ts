import { NextRequest, NextResponse } from "next/server";
import { requireDeveloperSession } from "@/lib/auth/developer-gate";
import { getAdminClient } from "@/lib/supabase/admin";
import {
  buildClinicInstanceName,
} from "@/lib/services/platform-clinic";
import { ensureEvolutionInstanceNamed } from "@/lib/whatsapp/evolution-client";

type Params = { params: Promise<{ id: string }> };

export async function POST(request: NextRequest, { params }: Params) {
  const session = await requireDeveloperSession(request);
  if ("error" in session) {
    return NextResponse.json({ error: session.error }, { status: session.status });
  }

  const { id } = await params;
  const admin = getAdminClient();

  const { data: clinic } = await admin
    .from("clinics")
    .select("id, name, name_ar, whatsapp_session_id")
    .eq("id", id)
    .maybeSingle();

  if (!clinic) {
    return NextResponse.json({ error: "العيادة غير موجودة" }, { status: 404 });
  }

  const c = clinic as {
    id: string;
    name?: string;
    name_ar?: string | null;
    whatsapp_session_id?: string | null;
  };

  const instanceName =
    c.whatsapp_session_id?.trim() ||
    buildClinicInstanceName(c.id, c.name_ar || c.name);

  const evo = await ensureEvolutionInstanceNamed(instanceName);

  await admin
    .from("clinics")
    .update({ whatsapp_session_id: instanceName })
    .eq("id", id);

  return NextResponse.json({
    ok: evo.ok,
    instance_name: instanceName,
    created: evo.created,
    error: evo.error,
    message: evo.ok
      ? `تم تجهيز instance «${instanceName}» على Evolution`
      : "فشل الاتصال بـ Evolution — تحقق من WHATSAPP_API_URL",
  });
}
