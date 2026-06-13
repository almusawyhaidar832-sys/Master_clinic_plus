import { NextRequest, NextResponse } from "next/server";
import {
  assertCanManageWithdrawal,
  StaffAccessError,
} from "@/lib/auth/staff-access";
import { writeAuditLog } from "@/lib/audit/write-audit-log";
import { notifyWithdrawalStatus } from "@/lib/notifications/server";
import { applyWithdrawalStatusUpdate } from "@/lib/withdrawals/status-update";

/** POST — accountant approves / pays / rejects a withdrawal request */
export async function POST(req: NextRequest) {
  try {
    const { id, status } = (await req.json()) as {
      id?: string;
      status?: "approved" | "paid" | "rejected";
    };

    if (!id || !status) {
      return NextResponse.json({ error: "id و status مطلوبان" }, { status: 400 });
    }

    const { profile, admin } = await assertCanManageWithdrawal(id, req);

    const { data: beforeRow } = await admin
      .from("doctor_withdrawals")
      .select("id, clinic_id, amount, status, doctor_id, source")
      .eq("id", id)
      .maybeSingle();

    const { error: updateErr } = await applyWithdrawalStatusUpdate(
      admin,
      id,
      status,
      profile.id
    );

    if (updateErr) {
      return NextResponse.json(
        { error: updateErr.message || "تعذر تحديث الطلب" },
        { status: 500 }
      );
    }

    await notifyWithdrawalStatus(id, status).catch((err) => {
      console.error("[withdrawals/update-status] notification failed:", err);
    });

    if (beforeRow?.clinic_id) {
      await writeAuditLog(admin, {
        clinicId: String(beforeRow.clinic_id),
        entityType: "withdrawal",
        entityId: id,
        action: "update",
        changedBy: profile.id,
        actorName: profile.full_name ?? null,
        financialAmount:
          status === "paid"
            ? -Math.abs(Number(beforeRow.amount ?? 0))
            : null,
        before: beforeRow as Record<string, unknown>,
        after: { status },
        note:
          status === "paid"
            ? "صرف طلب سحب"
            : status === "approved"
              ? "الموافقة على طلب سحب"
              : "رفض طلب سحب",
      });
    }

    return NextResponse.json({ success: true });
  } catch (err) {
    if (err instanceof StaffAccessError) {
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    console.error("[withdrawals/update-status]", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "تعذر تحديث الطلب" },
      { status: 500 }
    );
  }
}
