import { NextRequest, NextResponse } from "next/server";
import {
  assertCanRecordCashWithdrawal,
  StaffAccessError,
} from "@/lib/auth/staff-access";
import {
  computeDoctorWithdrawableLimit,
  insertWithdrawal,
} from "@/lib/withdrawals/server";
import { notifyWithdrawalStatus } from "@/lib/notifications/server";
import { translateDbError } from "@/lib/db-errors";

/** POST — accountant records direct cash payment to doctor */
export async function POST(req: NextRequest) {
  try {
    const { doctor_id, amount, notes } = (await req.json()) as {
      doctor_id?: string;
      amount?: number;
      notes?: string;
    };

    if (!doctor_id || !amount || amount <= 0) {
      return NextResponse.json(
        { error: "اختر الطبيب والمبلغ" },
        { status: 400 }
      );
    }

    const { profile, doctor, admin } =
      await assertCanRecordCashWithdrawal(doctor_id);

    const limit = await computeDoctorWithdrawableLimit(admin, doctor.id);
    if (amount > limit + 0.001) {
      return NextResponse.json(
        { error: "المبلغ أكبر من رصيد الطبيب المتاح" },
        { status: 400 }
      );
    }

    const { id } = await insertWithdrawal(admin, {
      clinic_id: doctor.clinic_id,
      doctor_id: doctor.id,
      amount,
      status: "paid",
      source: "accountant_cash",
      processed_at: new Date().toISOString(),
      processed_by: profile.id,
      notes: notes?.trim() || "دفع نقدي — محاسب",
    });

    await notifyWithdrawalStatus(id, "paid").catch((err) => {
      console.error("[withdrawals/record-cash] notification failed:", err);
    });

    return NextResponse.json({ success: true, id });
  } catch (err) {
    if (err instanceof StaffAccessError) {
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    console.error("[withdrawals/record-cash]", err);
    const msg = err instanceof Error ? err.message : "تعذر تسجيل السحب";
    return NextResponse.json(
      { error: translateDbError(msg) },
      { status: 500 }
    );
  }
}
