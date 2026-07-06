import { NextRequest, NextResponse } from "next/server";
import { getApiCallerProfile, isApiStaffRole } from "@/lib/auth/api-session";
import { getAdminClient } from "@/lib/supabase/admin";
import { deletePatientCompletely } from "@/lib/services/delete-patient";
import { translateDbError } from "@/lib/db-errors";

/** DELETE — حذف المريض نهائياً من العيادة */
export async function DELETE(
  req: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  try {
    const profile = await getApiCallerProfile(req);
    if (!profile?.clinic_id) {
      return NextResponse.json(
        { error: "غير مصرح — سجّل الدخول من بوابة المحاسب" },
        { status: 401 }
      );
    }

    if (!process.env.SUPABASE_SERVICE_ROLE_KEY) {
      return NextResponse.json(
        {
          error:
            "SUPABASE_SERVICE_ROLE_KEY غير مضبوط في .env.local — لا يمكن تنفيذ الحذف",
        },
        { status: 500 }
      );
    }

    const role = String(profile.role ?? "");
    if (!isApiStaffRole(role)) {
      return NextResponse.json(
        { error: `غير مصرح — دورك «${role || "?"}» لا يسمح بحذف المرضى` },
        { status: 403 }
      );
    }

    const { id: patientId } = await context.params;
    const admin = getAdminClient();

    const result = await deletePatientCompletely(admin, {
      clinicId: profile.clinic_id as string,
      patientId,
      deletedBy: profile.id,
      actorName: profile.full_name ?? null,
    });

    if (!result.ok) {
      return NextResponse.json(
        { error: result.error ?? "تعذر حذف المريض" },
        { status: 400 }
      );
    }

    return NextResponse.json({
      success: true,
      deletedStorageFiles: result.deletedStorageFiles ?? 0,
    });
  } catch (err) {
    console.error("[api/patients/delete]", err);
    const msg = err instanceof Error ? err.message : "تعذر حذف المريض";
    return NextResponse.json({ error: translateDbError(msg) }, { status: 500 });
  }
}
