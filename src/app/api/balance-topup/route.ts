import { randomUUID } from "crypto";
import { NextRequest, NextResponse } from "next/server";
import {
  assertCanManageClinicFinance,
  StaffAccessError,
} from "@/lib/auth/staff-access";
import { writeAuditLog } from "@/lib/audit/write-audit-log";
import {
  BALANCE_TOPUP_CLINIC_TYPE,
  BALANCE_TOPUP_DOCTOR_TYPE,
  type BalanceTopUpTarget,
} from "@/lib/services/balance-topup";
import { recordFinancialTransaction } from "@/lib/services/clinic-profit";
import { fetchDoctorWalletStats } from "@/lib/services/doctor-wallet";
import { todayISO } from "@/lib/utils";

export const dynamic = "force-dynamic";

const NO_STORE_HEADERS = {
  "Cache-Control": "no-store, no-cache, must-revalidate",
};

/** POST — شحن رصيد العيادة أو طبيب */
export async function POST(req: NextRequest) {
  try {
    const { profile, admin, clinicId } = await assertCanManageClinicFinance(req);

    const body = (await req.json()) as {
      target?: BalanceTopUpTarget;
      doctor_id?: string;
      amount?: number;
      notes?: string;
      transaction_date?: string;
    };

    const target = body.target;
    const amount = Number(body.amount ?? 0);
    const transactionDate = (body.transaction_date ?? todayISO()).slice(0, 10);
    const notes = body.notes?.trim() ?? "";

    if (target !== "clinic" && target !== "doctor") {
      return NextResponse.json(
        { error: "اختر نوع الشحن: عيادة أو طبيب" },
        { status: 400 }
      );
    }

    if (!Number.isFinite(amount) || amount <= 0) {
      return NextResponse.json(
        { error: "أدخل مبلغاً صحيحاً أكبر من صفر" },
        { status: 400 }
      );
    }

    if (amount > 999_999_999) {
      return NextResponse.json({ error: "المبلغ كبير جداً" }, { status: 400 });
    }

    let doctorId: string | null = null;
    let doctorName = "";

    if (target === "doctor") {
      if (!body.doctor_id) {
        return NextResponse.json(
          { error: "اختر الطبيب" },
          { status: 400 }
        );
      }

      const { data: doctor } = await admin
        .from("doctors")
        .select("id, clinic_id, full_name_ar")
        .eq("id", body.doctor_id)
        .maybeSingle();

      if (!doctor) {
        return NextResponse.json({ error: "الطبيب غير موجود" }, { status: 404 });
      }

      if (String(doctor.clinic_id) !== String(clinicId)) {
        return NextResponse.json(
          { error: "الطبيب لا ينتمي لعيادتك" },
          { status: 403 }
        );
      }

      doctorId = doctor.id as string;
      doctorName = (doctor.full_name_ar as string) || "طبيب";
    }

    const txId = randomUUID();
    const isClinic = target === "clinic";
    const type = isClinic ? BALANCE_TOPUP_CLINIC_TYPE : BALANCE_TOPUP_DOCTOR_TYPE;
    const defaultDesc = isClinic
      ? "شحن رصيد العيادة"
      : `شحن رصيد — ${doctorName}`;
    const descriptionAr = notes || defaultDesc;

    const result = await recordFinancialTransaction(admin, {
      clinicId,
      amount: Math.round(amount * 100) / 100,
      type,
      descriptionAr,
      transactionDate,
      doctorId,
      referenceType: "balance_topup",
      referenceId: txId,
    });

    if (!result.ok) {
      return NextResponse.json(
        { error: result.error ?? "تعذر تسجيل الشحن" },
        { status: 500 }
      );
    }

    await writeAuditLog(admin, {
      clinicId,
      entityType: "financial_transaction",
      entityId: txId,
      action: "create",
      changedBy: profile.id,
      actorName: profile.full_name ?? null,
      financialAmount: amount,
      after: {
        target,
        doctor_id: doctorId,
        amount,
        transaction_date: transactionDate,
        notes: notes || null,
        type,
      },
      note: descriptionAr,
    });

    const doctorWallet =
      target === "doctor" && doctorId
        ? await fetchDoctorWalletStats(admin, doctorId)
        : null;

    return NextResponse.json(
      {
        success: true,
        id: txId,
        target,
        amount,
        doctor_id: doctorId,
        doctor_wallet: doctorWallet
          ? {
              availableBalance: doctorWallet.availableBalance,
              withdrawableLimit: doctorWallet.withdrawableLimit,
            }
          : null,
      },
      { headers: NO_STORE_HEADERS }
    );
  } catch (err) {
    if (err instanceof StaffAccessError) {
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    console.error("[balance-topup]", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "تعذر شحن الرصيد" },
      { status: 500 }
    );
  }
}
