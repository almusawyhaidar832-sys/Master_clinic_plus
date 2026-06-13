import { NextRequest, NextResponse } from "next/server";
import { getApiCallerProfile, isApiStaffRole } from "@/lib/auth/api-session";
import { writeAuditLog } from "@/lib/audit/write-audit-log";
import { getAdminClient } from "@/lib/supabase/admin";
import { notifyDoctorSessionPayment } from "@/lib/notifications/server";
import { processSessionCheckout } from "@/lib/services/session-checkout";
/** POST — دفع الحساب النهائي بعد جلسة الطبيب */
export async function POST(req: NextRequest) {
  try {
    const profile = await getApiCallerProfile(req);
    if (!profile?.clinic_id || !isApiStaffRole(String(profile.role))) {
      return NextResponse.json({ error: "غير مصرح" }, { status: 403 });
    }

    const body = await req.json();
    const appointmentId = body.appointment_id as string | undefined;
    const queueEntryId = body.queue_entry_id as string | undefined;
    const paidAmount = Number(body.paid_amount ?? 0);

    if (!appointmentId && !queueEntryId) {
      return NextResponse.json(
        { error: "appointment_id أو queue_entry_id مطلوب" },
        { status: 400 }
      );
    }

    const admin = getAdminClient();
    const result = await processSessionCheckout(
      admin,
      profile.clinic_id as string,
      profile.id as string,
      { appointmentId, queueEntryId, paidAmount }
    );

    if (result.operationId && paidAmount > 0) {
      await writeAuditLog(admin, {
        clinicId: profile.clinic_id as string,
        entityType: "patient_operation",
        entityId: result.operationId,
        action: "create",
        changedBy: profile.id,
        actorName: profile.full_name ?? null,
        financialAmount: paidAmount,
        after: {
          source: "queue_checkout",
          appointment_id: appointmentId ?? null,
          queue_entry_id: queueEntryId ?? null,
          paid_amount: paidAmount,
        },
        note: "دفعة — حساب نهائي (طابور)",
      });

      void notifyDoctorSessionPayment(result.operationId).catch((e) =>
        console.error("[checkout] doctor payment notify", e)
      );
    }

    return NextResponse.json({ success: true, ...result });
  } catch (err) {
    console.error("[checkout]", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "تعذر إتمام الدفع" },
      { status: 500 }
    );
  }
}
