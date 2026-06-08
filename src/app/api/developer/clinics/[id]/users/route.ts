import { NextRequest, NextResponse } from "next/server";
import { requireDeveloperSession } from "@/lib/auth/developer-gate";
import { getAdminClient } from "@/lib/supabase/admin";
import {
  createClinicUserForDeveloper,
  fetchClinicUsersForDeveloper,
} from "@/lib/services/developer-clinic-users";
import type { UserRole } from "@/types";

type Params = { params: Promise<{ id: string }> };

export async function GET(request: NextRequest, { params }: Params) {
  const session = await requireDeveloperSession(request);
  if ("error" in session) {
    return NextResponse.json(
      { error: session.error },
      { status: session.status }
    );
  }

  const { id } = await params;
  const admin = getAdminClient();

  const { data: clinic } = await admin
    .from("clinics")
    .select("id")
    .eq("id", id)
    .maybeSingle();

  if (!clinic) {
    return NextResponse.json({ error: "العيادة غير موجودة" }, { status: 404 });
  }

  const users = await fetchClinicUsersForDeveloper(admin, id);
  return NextResponse.json({ users });
}

export async function POST(request: NextRequest, { params }: Params) {
  const session = await requireDeveloperSession(request);
  if ("error" in session) {
    return NextResponse.json(
      { error: session.error },
      { status: session.status }
    );
  }

  const { id } = await params;
  const body = await request.json();
  const admin = getAdminClient();

  const result = await createClinicUserForDeveloper(admin, id, {
    full_name: String(body.full_name ?? "").trim(),
    username: String(body.username ?? "").trim(),
    password: String(body.password ?? ""),
    role: String(body.role ?? "accountant") as UserRole,
  });

  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: 400 });
  }

  return NextResponse.json({ ok: true, userId: result.userId });
}
