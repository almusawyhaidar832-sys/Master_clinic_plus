import { randomUUID } from "crypto";
import { NextRequest, NextResponse } from "next/server";
import {
  assertCanManageClinicFinance,
  StaffAccessError,
} from "@/lib/auth/staff-access";
import { writeAuditLog } from "@/lib/audit/write-audit-log";
import {
  fetchClinicBalanceTopUpList,
  fetchDoctorBalanceTopUpList,
  type BalanceTopUpTarget,
} from "@/lib/services/balance-topup";
import { deleteBalanceTopUpTransaction } from "@/lib/services/balance-topup-cleanup";
import { defaultClinicProfitPeriod } from "@/lib/services/clinic-profit-loader";
import { fetchClinicProfitStatsForPeriod } from "@/lib/services/clinic-stats";
import { fetchDoctorWalletStats } from "@/lib/services/doctor-wallet";

export const dynamic = "force-dynamic";

const NO_STORE_HEADERS = {
  "Cache-Control": "no-store, no-cache, must-revalidate",
};

/** GET — قائمة شحنات الرصيد (عيادة أو طبيب محدد) */
export async function GET(req: NextRequest) {
  try {
    const { admin, clinicId } = await assertCanManageClinicFinance(req);

    const target = req.nextUrl.searchParams.get("target") as BalanceTopUpTarget | null;
    const doctorId = req.nextUrl.searchParams.get("doctor_id")?.trim() ?? "";

    if (target !== "clinic" && target !== "doctor") {
      return NextResponse.json(
        { error: "حدّد نوع الرصيد: clinic أو doctor" },
        { status: 400 }
      );
    }

    if (target === "doctor") {
      if (!doctorId) {
        return NextResponse.json(
          { error: "اختر الطبيب لعرض الشحنات" },
          { status: 400 }
        );
      }
      const items = await fetchDoctorBalanceTopUpList(admin, clinicId, doctorId);
      return NextResponse.json({ items }, { headers: NO_STORE_HEADERS });
    }

    const items = await fetchClinicBalanceTopUpList(admin, clinicId);
    return NextResponse.json({ items }, { headers: NO_STORE_HEADERS });
  } catch (err) {
    if (err instanceof StaffAccessError) {
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    const msg = err instanceof Error ? err.message : "خطأ غير متوقع";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

/** DELETE — حذف شحنة رصيد واحدة */
export async function DELETE(req: NextRequest) {
  try {
    const { profile, admin, clinicId } = await assertCanManageClinicFinance(req);

    const body = (await req.json().catch(() => ({}))) as {
      transaction_id?: string;
    };

    const transactionId = body.transaction_id?.trim();
    if (!transactionId) {
      return NextResponse.json(
        { error: "اختر الشحنة المراد حذفها" },
        { status: 400 }
      );
    }

    const result = await deleteBalanceTopUpTransaction(
      admin,
      clinicId,
      transactionId
    );

    if (!result.ok) {
      return NextResponse.json(
        { error: result.error ?? "تعذر الحذف" },
        { status: 500 }
      );
    }

    const period = defaultClinicProfitPeriod();
    let netProfit: number | undefined;
    let balanceTopupsTotal: number | undefined;
    let doctorWallet: { availableBalance: number; withdrawableLimit: number } | null =
      null;

    if (result.target === "clinic") {
      const profitStats = await fetchClinicProfitStatsForPeriod(
        admin,
        clinicId,
        period.from,
        period.to
      );
      netProfit = profitStats.netProfit;
      balanceTopupsTotal = profitStats.balanceTopupsTotal;
    } else if (result.doctorId) {
      const wallet = await fetchDoctorWalletStats(admin, result.doctorId);
      doctorWallet = {
        availableBalance: wallet.availableBalance,
        withdrawableLimit: wallet.withdrawableLimit,
      };
    }

    await writeAuditLog(admin, {
      clinicId,
      entityType: "financial_transaction",
      entityId: randomUUID(),
      action: "delete",
      changedBy: profile.id,
      actorName: profile.full_name ?? null,
      financialAmount: result.amount ?? 0,
      note: `حذف شحن رصيد ${result.target === "clinic" ? "العيادة" : "طبيب"}`,
      after: {
        deleted_transaction_id: transactionId,
        target: result.target,
        doctor_id: result.doctorId ?? null,
        amount: result.amount ?? 0,
      },
    });

    return NextResponse.json(
      {
        ok: true,
        target: result.target,
        amount: result.amount,
        doctor_id: result.doctorId ?? null,
        netProfit,
        balanceTopupsTotal,
        period: result.target === "clinic" ? period : null,
        doctor_wallet: doctorWallet,
        message: "تم حذف الشحنة",
      },
      { headers: NO_STORE_HEADERS }
    );
  } catch (err) {
    if (err instanceof StaffAccessError) {
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    const msg = err instanceof Error ? err.message : "خطأ غير متوقع";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
