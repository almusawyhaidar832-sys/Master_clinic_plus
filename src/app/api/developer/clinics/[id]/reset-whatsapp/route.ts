import { NextRequest, NextResponse } from "next/server";
import { requireDeveloperSession } from "@/lib/auth/developer-gate";
import { getAdminClient } from "@/lib/supabase/admin";
import { buildClinicInstanceName } from "@/lib/services/platform-clinic";
import { restartEvolutionInstanceNamed } from "@/lib/whatsapp/evolution-client";

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

  const reset = await restartEvolutionInstanceNamed(instanceName);

  await admin
    .from("clinics")
    .update({
      whatsapp_linked: false,
      whatsapp_session_id: instanceName,
    })
    .eq("id", id);

  return NextResponse.json({
    ok: reset.ok,
    instance_name: instanceName,
    message: reset.ok
      ? "تم إعادة تهيئة instance الواتساب — امسح QR من لوحة العيادة"
      : "فشل الاتصال بـ Evolution",
    error: reset.error,
  });
}
