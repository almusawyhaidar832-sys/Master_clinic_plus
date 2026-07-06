import { NextRequest, NextResponse } from "next/server";
import { getApiCallerProfile } from "@/lib/auth/api-session";
import { isApiStaffRole } from "@/lib/auth/api-portal";
import { getAdminClient } from "@/lib/supabase/admin";
import { repairDoctorOperationShares } from "@/lib/services/operation-amount-edit";

/** POST — إصلاح حصص الطبيب المخزّنة خطأ (مثلاً 81500 بدل 40% من المدفوع) */
export async function POST(req: NextRequest) {
  try {
    const profile = await getApiCallerProfile(req);
    if (!profile?.clinic_id) {
      return NextResponse.json({ error: "غير مصرح" }, { status: 401 });
    }
    if (!isApiStaffRole(profile.role)) {
      return NextResponse.json({ error: "غير مصرح" }, { status: 403 });
    }

    const body = (await req.json()) as {
      doctorId?: string;
      date?: string;
    };

    const admin = getAdminClient();
    const result = await repairDoctorOperationShares(admin, profile.clinic_id, {
      doctorId: body.doctorId?.trim() || undefined,
      date: body.date?.trim() || undefined,
    });

    if (!result.ok) {
      return NextResponse.json(
        { error: result.error ?? "تعذر الإصلاح" },
        { status: 500 }
      );
    }

    return NextResponse.json({
      ok: true,
      repaired: result.repaired,
      message:
        result.repaired > 0
          ? `تم تصحيح ${result.repaired} جلسة`
          : "لا توجد جلسات تحتاج تصحيحاً",
    });
  } catch (err) {
    console.error("[api/admin/repair-doctor-shares]", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "خطأ" },
      { status: 500 }
    );
  }
}
