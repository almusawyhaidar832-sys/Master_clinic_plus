import { randomUUID } from "crypto";
import { NextRequest, NextResponse } from "next/server";
import { getApiCallerProfile, isApiStaffRole } from "@/lib/auth/api-session";
import {
  verifyStaffClinicAccess,
  resolveStaffApiClinicId,
} from "@/lib/auth/resolve-staff-clinic";
import { writeAuditLog } from "@/lib/audit/write-audit-log";
import { getAdminClient } from "@/lib/supabase/admin";
import { clearClinicBalanceTopups } from "@/lib/services/balance-topup-cleanup";
import { defaultClinicProfitPeriod } from "@/lib/services/clinic-profit-loader";

export const dynamic = "force-dynamic";

const NO_STORE_HEADERS = {
  "Cache-Control": "no-store, no-cache, must-revalidate",
};

/** POST — حذف كل شحنات رصيد العيادة وإرجاع الربح للأساس */
export async function POST(req: NextRequest) {
  try {
    const caller = await getApiCallerProfile(req);
    if (!caller) {
      return NextResponse.json({ error: "يجب تسجيل الدخول أولاً" }, { status: 401 });
    }
    if (!isApiStaffRole(caller.role)) {
      return NextResponse.json({ error: "صلاحيات غير كافية" }, { status: 403 });
    }

    const body = (await req.json().catch(() => ({}))) as {
      clinic_id?: string;
      scope?: "month" | "all";
    };

    const fromQuery = body.clinic_id?.trim() || null;
    let clinicId: string | null = null;

    if (fromQuery && (await verifyStaffClinicAccess(req, caller, fromQuery))) {
      clinicId = fromQuery;
    } else {
      clinicId = await resolveStaffApiClinicId(req, caller);
    }

    if (!clinicId) {
      return NextResponse.json(
        { error: "حسابك غير مربوط بعيادة أو العيادة المطلوبة غير مصرح بها" },
        { status: 400 }
      );
    }

    const scope = body.scope === "all" ? "all" : "month";
    const period = defaultClinicProfitPeriod();
    const range =
      scope === "all" ? undefined : { from: period.from, to: period.to };

    const admin = getAdminClient();
    const result = await clearClinicBalanceTopups(admin, clinicId, range);

    if (!result.ok) {
      return NextResponse.json(
        { error: result.error ?? "تعذر حذف شحنات الرصيد" },
        { status: 500 }
      );
    }

    if (result.deletedTransactions > 0 || result.deletedAuditLogs > 0) {
      await writeAuditLog(admin, {
        clinicId,
        entityType: "financial_transaction",
        entityId: randomUUID(),
        action: "delete",
        changedBy: caller.id,
        actorName: caller.full_name ?? null,
        note: `حذف ${result.deletedTransactions} شحن رصيد عيادة من موجز العمليات`,
        after: {
          deleted_transactions: result.deletedTransactions,
          deleted_audit_logs: result.deletedAuditLogs,
          scope,
        },
      });
    }

    return NextResponse.json(
      {
        ok: true,
        deletedTransactions: result.deletedTransactions,
        deletedAuditLogs: result.deletedAuditLogs,
        message:
          result.deletedTransactions > 0
            ? `تم حذف ${result.deletedTransactions} شحن — صافي الربح رجع للأساس (بدون شحن)`
            : "لا توجد شحنات لحذفها",
      },
      { headers: NO_STORE_HEADERS }
    );
  } catch (e) {
    const msg = e instanceof Error ? e.message : "خطأ غير متوقع";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
