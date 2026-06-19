import { NextRequest, NextResponse } from "next/server";
import { getApiCallerProfile, createApiSessionClient } from "@/lib/auth/api-session";
import { getActiveClinicIdServer } from "@/lib/clinic-context.server";
import { normalizeTopPerformersPayload } from "@/lib/services/doctor-performance";

/** GET /api/admin/doctor-performance?from=&to= — أداء الأطباء لعيادة المستخدم فقط (من السيرفر) */
export async function GET(req: NextRequest) {
  try {
    const caller = await getApiCallerProfile(req);
    if (!caller) {
      return NextResponse.json({ error: "يجب تسجيل الدخول أولاً" }, { status: 401 });
    }
    if (caller.role !== "super_admin") {
      return NextResponse.json({ error: "صلاحيات غير كافية" }, { status: 403 });
    }

    const supabase = await createApiSessionClient(req);
    const active = await getActiveClinicIdServer(supabase);
    if (!active?.clinicId) {
      return NextResponse.json(
        { error: "حسابك غير مربوط بعيادة نشطة" },
        { status: 400 }
      );
    }

    const from = req.nextUrl.searchParams.get("from")?.trim() ?? "";
    const to = req.nextUrl.searchParams.get("to")?.trim() ?? "";
    if (!from || !to) {
      return NextResponse.json({ error: "from و to مطلوبان" }, { status: 400 });
    }

    const { data, error } = await supabase.rpc("get_top_performers", {
      p_clinic_id: active.clinicId,
      p_from: from,
      p_to: to,
    });

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }

    return NextResponse.json({
      clinicId: active.clinicId,
      clinicName: active.clinicName,
      payload: normalizeTopPerformersPayload(data),
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "خطأ غير متوقع";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
