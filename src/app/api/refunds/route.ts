import { NextRequest, NextResponse } from "next/server";
import { getApiCallerProfile } from "@/lib/auth/api-session";
import { isApiStaffRole } from "@/lib/auth/api-portal";
import { writeAuditLog } from "@/lib/audit/write-audit-log";
import { notifyDoctorRefund } from "@/lib/notifications/server";
import { getAdminClient } from "@/lib/supabase/admin";
import { createSessionRefund } from "@/lib/services/session-refunds";
import { translateDbError } from "@/lib/db-errors";

/** POST — تسجيل إرجاع مبلغ مرتبط بجلسة */
export async function POST(req: NextRequest) {
  try {
    const profile = await getApiCallerProfile(req);
    if (!profile?.clinic_id) {
      return NextResponse.json(
        { error: "غير مصرح — سجّل الدخول من بوابة المحاسب" },
        { status: 401 }
      );
    }

    if (!isApiStaffRole(profile.role)) {
      return NextResponse.json(
        { error: "صلاحية المرتجعات للمحاسب فقط" },
        { status: 403 }
      );
    }

    const body = (await req.json()) as {
      sessionId?: string;
      amount?: number;
      reason?: string;
    };

    const sessionId = String(body.sessionId ?? "").trim();
    const amount = Number(body.amount ?? 0);
    const reason = String(body.reason ?? "").trim();

    if (!sessionId) {
      return NextResponse.json({ error: "معرّف الجلسة مطلوب" }, { status: 400 });
    }

    const admin = getAdminClient();
    const result = await createSessionRefund(admin, {
      clinicId: profile.clinic_id,
      sessionId,
      amount,
      reason,
      createdBy: profile.id,
    });

    if (result.error) {
      return NextResponse.json(
        { error: translateDbError(result.error) },
        { status: 400 }
      );
    }

    const refund = result.refund;

    await writeAuditLog(admin, {
      clinicId: profile.clinic_id,
      entityType: "session_refund",
      entityId: refund.id,
      action: "refund",
      changedBy: profile.id,
      actorName: profile.full_name ?? null,
      financialAmount: -Math.abs(amount),
      after: {
        session_id: sessionId,
        amount,
        reason,
        patient_id: refund.patient_id,
        doctor_id: refund.doctor_id,
      },
      note: reason,
    });

    void notifyDoctorRefund(refund.id).catch((e) =>
      console.error("[api/refunds] doctor notification", e)
    );

    return NextResponse.json({ success: true, refund });
  } catch (err) {
    console.error("[api/refunds]", err);
    const msg = err instanceof Error ? err.message : "تعذر تسجيل الإرجاع";
    return NextResponse.json({ error: translateDbError(msg) }, { status: 500 });
  }
}
