import { NextRequest, NextResponse } from "next/server";
import { getApiSessionUser } from "@/lib/auth/api-session";
import {
  notifyWithdrawalRequest,
  notifyWithdrawalStatus,
  notifyDoctorNewOperation,
} from "@/lib/notifications/server";

/**
 * POST /api/notifications/dispatch
 * Body: { event: "withdrawal_request" | "withdrawal_status" | "new_operation", id: string, status?: string }
 */
export async function POST(req: NextRequest) {
  try {
    const user = await getApiSessionUser(req);
    if (!user) {
      return NextResponse.json({ error: "غير مصرح" }, { status: 401 });
    }

    const body = await req.json();
    const { event, id, status } = body as {
      event: string;
      id: string;
      status?: string;
    };

    if (!event || !id) {
      return NextResponse.json({ error: "event و id مطلوبان" }, { status: 400 });
    }

    switch (event) {
      case "withdrawal_request":
        await notifyWithdrawalRequest(id);
        break;
      case "withdrawal_status":
        if (!status) {
          return NextResponse.json({ error: "status مطلوب" }, { status: 400 });
        }
        await notifyWithdrawalStatus(id, status);
        break;
      case "new_operation":
        await notifyDoctorNewOperation(id);
        break;
      default:
        return NextResponse.json({ error: "حدث غير معروف" }, { status: 400 });
    }

    return NextResponse.json({ success: true });
  } catch (err) {
    console.error("[notifications/dispatch]", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "خطأ في الإشعار" },
      { status: 500 }
    );
  }
}
