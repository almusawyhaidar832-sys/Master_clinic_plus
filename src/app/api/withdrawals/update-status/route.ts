import { NextRequest, NextResponse } from "next/server";
import {
  assertCanManageWithdrawal,
  StaffAccessError,
} from "@/lib/auth/staff-access";
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

    const { profile, admin } = await assertCanManageWithdrawal(id);

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
