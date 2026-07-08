import { NextRequest, NextResponse } from "next/server";
import { getApiCallerProfile } from "@/lib/auth/api-session";
import { isApiStaffRole } from "@/lib/auth/api-portal";
import { getAdminClient } from "@/lib/supabase/admin";
import { createAppointmentInvoice } from "@/lib/services/appointment-invoice";

const BUCKET = "invoice-xrays";
const MAX_BYTES = 10 * 1024 * 1024;

/** POST multipart — إصدار فاتورة + جلسة مالية + رفع أشعة */
export async function POST(req: NextRequest) {
  try {
    const profile = await getApiCallerProfile(req);
    if (!profile?.clinic_id) {
      return NextResponse.json({ error: "غير مصرح" }, { status: 401 });
    }
    if (!isApiStaffRole(profile.role)) {
      return NextResponse.json({ error: "غير مصرح" }, { status: 403 });
    }

    const form = await req.formData();
    const appointmentId = form.get("appointment_id") as string | null;
    const procedureName = form.get("procedure_name") as string | null;
    const operationTypeId = form.get("operation_type_id") as string | null;
    const totalRaw = form.get("total_amount") as string | null;
    const paidRaw = form.get("paid_amount") as string | null;
    const materialsRaw = form.get("materials_cost") as string | null;
    const labNotes = form.get("lab_notes") as string | null;
    const notes = form.get("notes") as string | null;
    const file = form.get("file") as File | null;

    if (!appointmentId || !procedureName?.trim()) {
      return NextResponse.json(
        { error: "appointment_id و procedure_name مطلوبان" },
        { status: 400 }
      );
    }

    const totalAmount = Number(totalRaw);
    const paidAmount = Number(paidRaw ?? 0);
    const materialsCost = Number(materialsRaw ?? 0);

    if (!Number.isFinite(totalAmount) || totalAmount < 0) {
      return NextResponse.json({ error: "المبلغ الكلي غير صالح" }, { status: 400 });
    }
    if (!Number.isFinite(paidAmount) || paidAmount < 0) {
      return NextResponse.json({ error: "المبلغ المدفوع غير صالح" }, { status: 400 });
    }

    const admin = getAdminClient();

    const { data: appointment } = await admin
      .from("appointments")
      .select("id, clinic_id")
      .eq("id", appointmentId)
      .maybeSingle();

    if (!appointment || appointment.clinic_id !== profile.clinic_id) {
      return NextResponse.json({ error: "الموعد غير موجود" }, { status: 404 });
    }

    let xrayStoragePath: string | null = null;
    let xrayFileName: string | null = null;
    let xrayMimeType: string | null = null;

    if (file && file.size > 0) {
      if (file.size > MAX_BYTES) {
        return NextResponse.json(
          { error: "حجم الملف أكبر من 10 ميجابايت" },
          { status: 400 }
        );
      }

      const ext = file.name.split(".").pop()?.toLowerCase() || "jpg";
      const safeName = `${crypto.randomUUID()}.${ext}`;
      xrayStoragePath = `${profile.clinic_id}/${appointmentId}/${safeName}`;
      xrayFileName = file.name;
      xrayMimeType = file.type || null;

      const buffer = Buffer.from(await file.arrayBuffer());
      const { error: uploadErr } = await admin.storage
        .from(BUCKET)
        .upload(xrayStoragePath, buffer, {
          contentType: file.type || "image/jpeg",
          upsert: false,
        });

      if (uploadErr) {
        return NextResponse.json(
          {
            error: uploadErr.message.includes("Bucket not found")
              ? "أنشئ bucket باسم invoice-xrays في Supabase Storage"
              : uploadErr.message,
          },
          { status: 500 }
        );
      }
    }

    try {
      const result = await createAppointmentInvoice(admin, {
        appointmentId,
        procedureName: procedureName.trim(),
        operationTypeId: operationTypeId || null,
        totalAmount,
        paidAmount,
        materialsCost,
        labNotes,
        notes,
        xrayStoragePath,
        xrayFileName,
        xrayMimeType,
        createdBy: profile.id,
      });

      return NextResponse.json({
        success: true,
        ...result,
        message: `تم إصدار الفاتورة — حصة الطبيب: ${result.doctorShare} د.ع · حصة العيادة: ${result.clinicShare} د.ع`,
      });
    } catch (invoiceErr) {
      if (xrayStoragePath) {
        await admin.storage.from(BUCKET).remove([xrayStoragePath]);
      }
      throw invoiceErr;
    }
  } catch (err) {
    console.error("[operations/appointment-invoice]", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "خطأ" },
      { status: 500 }
    );
  }
}
