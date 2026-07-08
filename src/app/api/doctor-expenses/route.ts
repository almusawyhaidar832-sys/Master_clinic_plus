import { NextRequest, NextResponse } from "next/server";
import {
  getApiCallerProfile,
  isApiStaffRole,
} from "@/lib/auth/api-session";
import { getAdminClient } from "@/lib/supabase/admin";
import { doctorShareFromExpense } from "@/lib/services/assistant-payroll";
import {
  applyDoctorExpenseFinancialDeductions,
  rollbackDoctorExpenseInsert,
} from "@/lib/services/doctor-expense-deduction";
import { archiveDoctorExpenseToHistory } from "@/lib/services/invoice-archive";
import { writeAuditLog } from "@/lib/audit/write-audit-log";

const BUCKET = "doctor-expense-invoices";
const MAX_BYTES = 10 * 1024 * 1024;

async function uploadInvoiceFile(
  admin: ReturnType<typeof getAdminClient>,
  clinicId: string,
  doctorId: string,
  file: File
): Promise<{ storagePath: string; fileName: string; mimeType: string | null }> {
  if (file.size > MAX_BYTES) {
    throw new Error("FILE_TOO_LARGE");
  }

  const ext = file.name.split(".").pop()?.toLowerCase() || "jpg";
  const storagePath = `${clinicId}/${doctorId}/${crypto.randomUUID()}.${ext}`;
  const buffer = Buffer.from(await file.arrayBuffer());

  const { error: uploadErr } = await admin.storage.from(BUCKET).upload(storagePath, buffer, {
    contentType: file.type || "image/jpeg",
    upsert: false,
  });

  if (uploadErr) {
    throw new Error(
      uploadErr.message.includes("Bucket not found")
        ? "أنشئ bucket باسم doctor-expense-invoices في Storage"
        : uploadErr.message
    );
  }

  return {
    storagePath,
    fileName: file.name,
    mimeType: file.type || null,
  };
}

/**
 * POST /api/doctor-expenses
 * تسجيل فاتورة صرفية طبيب + حركات مالية (خصم من رصيد الطبيب + حصة العيادة)
 */
export async function POST(req: NextRequest) {
  let uploadedPath: string | null = null;

  try {
    const caller = await getApiCallerProfile(req);
    if (!caller) {
      return NextResponse.json({ error: "يجب تسجيل الدخول أولاً" }, { status: 401 });
    }

    if (!isApiStaffRole(String(caller.role ?? ""))) {
      return NextResponse.json({ error: "صلاحيات غير كافية" }, { status: 403 });
    }

    const clinicId = caller.clinic_id;
    if (!clinicId) {
      return NextResponse.json({ error: "حسابك غير مربوط بعيادة" }, { status: 400 });
    }

    const contentType = req.headers.get("content-type") ?? "";
    const isMultipart = contentType.includes("multipart/form-data");

    let doctorId: string;
    let amount: number;
    let percentageSplit: number;
    let descriptionAr: string | null;
    let expenseDate: string;
    let invoiceStoragePath: string | null = null;
    let invoiceFileName: string | null = null;
    let invoiceMimeType: string | null = null;

    const admin = getAdminClient();

    if (isMultipart) {
      const form = await req.formData();
      const file = form.get("file");
      doctorId = String(form.get("doctor_id") ?? "");
      amount = Number(form.get("amount"));
      percentageSplit = Number(form.get("percentage_split") ?? 50);
      descriptionAr = String(form.get("description_ar") ?? "").trim() || null;
      expenseDate =
        String(form.get("expense_date") ?? "") || new Date().toISOString().slice(0, 10);

      if (file instanceof File && file.size > 0) {
        try {
          const uploaded = await uploadInvoiceFile(admin, clinicId, doctorId, file);
          uploadedPath = uploaded.storagePath;
          invoiceStoragePath = uploaded.storagePath;
          invoiceFileName = uploaded.fileName;
          invoiceMimeType = uploaded.mimeType;
        } catch (uploadErr) {
          const msg =
            uploadErr instanceof Error ? uploadErr.message : "تعذر رفع صورة الفاتورة";
          if (msg === "FILE_TOO_LARGE") {
            return NextResponse.json(
              { error: "حجم الملف أكبر من 10 ميجابايت" },
              { status: 400 }
            );
          }
          return NextResponse.json({ error: msg }, { status: 500 });
        }
      }
    } else {
      const body = await req.json();
      doctorId = String(body.doctor_id ?? "");
      amount = Number(body.amount);
      percentageSplit = Number(body.percentage_split ?? 50);
      descriptionAr = String(body.description_ar ?? "").trim() || null;
      expenseDate =
        String(body.expense_date ?? "") || new Date().toISOString().slice(0, 10);
      invoiceStoragePath = body.invoice_storage_path ?? null;
      invoiceFileName = body.invoice_file_name ?? null;
      invoiceMimeType = body.invoice_mime_type ?? null;
    }

    if (!doctorId) {
      return NextResponse.json({ error: "الطبيب مطلوب" }, { status: 400 });
    }
    if (!Number.isFinite(amount) || amount <= 0) {
      return NextResponse.json({ error: "المبلغ غير صالح" }, { status: 400 });
    }
    if (
      !Number.isFinite(percentageSplit) ||
      percentageSplit < 0 ||
      percentageSplit > 100
    ) {
      return NextResponse.json({ error: "نسبة الطبيب بين 0 و 100" }, { status: 400 });
    }

    const { data: doctor } = await admin
      .from("doctors")
      .select("id, full_name_ar")
      .eq("id", doctorId)
      .eq("clinic_id", clinicId)
      .maybeSingle();

    if (!doctor) {
      if (uploadedPath) {
        await admin.storage.from(BUCKET).remove([uploadedPath]);
      }
      return NextResponse.json({ error: "الطبيب غير موجود في العيادة" }, { status: 404 });
    }

    const doctorShare = doctorShareFromExpense(amount, percentageSplit);
    const clinicShare = Math.round((amount - doctorShare) * 100) / 100;

    const { data: expense, error: insertErr } = await admin
      .from("doctor_expenses")
      .insert({
        clinic_id: clinicId,
        doctor_id: doctorId,
        amount,
        percentage_split: percentageSplit,
        description_ar: descriptionAr,
        expense_date: expenseDate,
        invoice_storage_path: invoiceStoragePath,
        invoice_file_name: invoiceFileName,
        invoice_mime_type: invoiceMimeType,
        created_by: caller.id,
      })
      .select("id")
      .single();

    if (insertErr || !expense?.id) {
      if (uploadedPath) {
        await admin.storage.from(BUCKET).remove([uploadedPath]);
      }
      return NextResponse.json(
        { error: insertErr?.message ?? "تعذر حفظ الفاتورة" },
        { status: 500 }
      );
    }

    const deduction = await applyDoctorExpenseFinancialDeductions(admin, {
      clinicId,
      expenseId: expense.id,
      doctorId,
      doctorName: doctor.full_name_ar as string,
      amount,
      percentageSplit,
      descriptionAr,
      expenseDate,
    });

    if (!deduction.ok) {
      await rollbackDoctorExpenseInsert(admin, expense.id);
      if (uploadedPath) {
        await admin.storage.from(BUCKET).remove([uploadedPath]);
      }
      return NextResponse.json(
        {
          error: `تعذر حفظ الفاتورة: فشل خصم الطبيب — ${deduction.error}`,
        },
        { status: 500 }
      );
    }

    const archive = await archiveDoctorExpenseToHistory(admin, {
      clinicId,
      expenseId: expense.id,
      finalizedBy: caller.id,
    });

    if (!archive.ok) {
      return NextResponse.json(
        {
          error: `تم حفظ الصرفية لكن فشل نقلها للسجل التاريخي: ${archive.error}`,
          expense_id: expense.id,
        },
        { status: 500 }
      );
    }

    await writeAuditLog(admin, {
      clinicId,
      entityType: "expense",
      entityId: expense.id,
      action: "create",
      changedBy: caller.id,
      actorName: caller.full_name ?? null,
      financialAmount: -clinicShare,
      after: {
        kind: "doctor_expense",
        doctor_id: doctorId,
        doctor_name: doctor.full_name_ar,
        amount,
        clinic_share: clinicShare,
        doctor_share: doctorShare,
        expense_date: expenseDate,
        description_ar: descriptionAr,
      },
      note: `فاتورة صرفية طبيب — ${doctor.full_name_ar as string}`,
    });

    return NextResponse.json({
      success: true,
      expense_id: expense.id,
      history_id: archive.historyId,
      doctor_share: doctorShare,
      clinic_share: clinicShare,
      profit_updated: true,
      archived_to_history: true,
    });
  } catch (e) {
    if (uploadedPath) {
      try {
        const admin = getAdminClient();
        await admin.storage.from(BUCKET).remove([uploadedPath]);
      } catch {
        /* ignore cleanup errors */
      }
    }
    const msg = e instanceof Error ? e.message : "خطأ غير متوقع";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
