import { NextResponse } from "next/server";
import { listBookableClinics } from "@/lib/booking/server";

/** GET /api/booking/clinics — public list for clinic picker */
export async function GET() {
  try {
    const clinics = await listBookableClinics();
    return NextResponse.json({ clinics });
  } catch (err) {
    console.error("[api/booking/clinics]", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "تعذر تحميل العيادات" },
      { status: 500 }
    );
  }
}
