import { NextRequest, NextResponse } from "next/server";
import {
  DEVELOPER_COOKIE,
  developerCookieOptions,
  requireDeveloperSession,
  signDeveloperToken,
} from "@/lib/auth/developer-gate";
import { getAdminClient } from "@/lib/supabase/admin";
import { deletePlatformClinic } from "@/lib/services/platform-clinic";

type Params = { params: Promise<{ id: string }> };

export async function GET(request: NextRequest, { params }: Params) {
  const session = await requireDeveloperSession(request);
  if ("error" in session) {
    return NextResponse.json({ error: session.error }, { status: session.status });
  }

  const { id } = await params;
  const admin = getAdminClient();

  const { data: clinic, error } = await admin
    .from("clinics")
    .select(
      "id, name, name_ar, phone, address, created_at, whatsapp_linked, whatsapp_session_id, is_active"
    )
    .eq("id", id)
    .maybeSingle();

  if (error || !clinic) {
    return NextResponse.json({ error: "العيادة غير موجودة" }, { status: 404 });
  }

  const { count: patientCount } = await admin
    .from("patients")
    .select("id", { count: "exact", head: true })
    .eq("clinic_id", id);

  const { data: staff } = await admin
    .from("profiles")
    .select("id, full_name, username, role, is_active")
    .eq("clinic_id", id)
    .order("created_at", { ascending: true });

  return NextResponse.json({
    clinic,
    patientCount: patientCount ?? 0,
    staff: staff ?? [],
  });
}

export async function PATCH(request: NextRequest, { params }: Params) {
  const session = await requireDeveloperSession(request);
  if ("error" in session) {
    return NextResponse.json({ error: session.error }, { status: session.status });
  }

  const { id } = await params;
  const body = await request.json();
  const admin = getAdminClient();

  const updates: Record<string, unknown> = {};
  if (body.name !== undefined) updates.name = body.name;
  if (body.name_ar !== undefined) updates.name_ar = body.name_ar;
  if (body.phone !== undefined) updates.phone = body.phone;
  if (body.address !== undefined) updates.address = body.address;
  if (body.whatsapp_session_id !== undefined) {
    updates.whatsapp_session_id = body.whatsapp_session_id;
  }
  if (body.is_active !== undefined) {
    updates.is_active = Boolean(body.is_active);
  }

  if (Object.keys(updates).length === 0) {
    return NextResponse.json({ error: "لا توجد حقول للتحديث" }, { status: 400 });
  }

  const { data, error } = await admin
    .from("clinics")
    .update(updates)
    .eq("id", id)
    .select()
    .maybeSingle();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ clinic: data });
}

export async function DELETE(request: NextRequest, { params }: Params) {
  const session = await requireDeveloperSession(request);
  if ("error" in session) {
    return NextResponse.json({ error: session.error }, { status: session.status });
  }

  const { id } = await params;
  const admin = getAdminClient();

  const { data: exists } = await admin
    .from("clinics")
    .select("id, name_ar, name")
    .eq("id", id)
    .maybeSingle();

  if (!exists) {
    return NextResponse.json({ error: "العيادة غير موجودة" }, { status: 404 });
  }

  const result = await deletePlatformClinic(admin, id);
  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: 500 });
  }

  if (session.actingClinicId === id) {
    const token = await signDeveloperToken({
      email: session.email,
      actingClinicId: null,
    });
    const res = NextResponse.json({
      ok: true,
      message: `تم حذف العيادة «${(exists as { name_ar?: string; name?: string }).name_ar || exists.name}»`,
    });
    if (token) {
      res.cookies.set(DEVELOPER_COOKIE, token, developerCookieOptions());
    }
    return res;
  }

  return NextResponse.json({
    ok: true,
    message: `تم حذف العيادة وجميع بياناتها`,
  });
}
