import { NextRequest, NextResponse } from "next/server";
import { requireDeveloperSession } from "@/lib/auth/developer-gate";
import { getAdminClient } from "@/lib/supabase/admin";
import { updateClinicUserForDeveloper } from "@/lib/services/developer-clinic-users";
import type { UserRole } from "@/types";

type Params = { params: Promise<{ id: string; userId: string }> };

export async function PATCH(request: NextRequest, { params }: Params) {
  const session = await requireDeveloperSession(request);
  if ("error" in session) {
    return NextResponse.json(
      { error: session.error },
      { status: session.status }
    );
  }

  const { id, userId } = await params;
  const body = await request.json();
  const admin = getAdminClient();

  const result = await updateClinicUserForDeveloper(admin, id, userId, {
    role: body.role !== undefined ? (String(body.role) as UserRole) : undefined,
    is_active:
      body.is_active !== undefined ? Boolean(body.is_active) : undefined,
    full_name:
      body.full_name !== undefined ? String(body.full_name) : undefined,
    new_password:
      body.new_password !== undefined
        ? String(body.new_password)
        : undefined,
  });

  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: 400 });
  }

  return NextResponse.json({ ok: true });
}
