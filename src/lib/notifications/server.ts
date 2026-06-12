import { isSalaryReasonRequired } from "@/lib/services/salary-entry-reason";
import { formatCurrency } from "@/lib/utils";
import { getAdminClient } from "@/lib/supabase/admin";

function adminClient() {
  return getAdminClient();
}

/** Resolve doctor login profile even if doctors.profile_id is missing */
export async function resolveDoctorProfileId(
  admin: ReturnType<typeof adminClient>,
  doctorId: string,
  clinicId: string
): Promise<string | null> {
  const { data: doc } = await admin
    .from("doctors")
    .select("profile_id, full_name_ar")
    .eq("id", doctorId)
    .maybeSingle();

  if (doc?.profile_id) return doc.profile_id;

  if (!doc?.full_name_ar) return null;

  const { data: profiles } = await admin
    .from("profiles")
    .select("id, full_name")
    .eq("clinic_id", clinicId)
    .eq("role", "doctor");

  const name = doc.full_name_ar.trim();
  const match = profiles?.find((p) => p.full_name?.trim() === name);
  if (match?.id) {
    await admin
      .from("doctors")
      .update({ profile_id: match.id })
      .eq("id", doctorId)
      .is("profile_id", null);
    return match.id;
  }

  return null;
}

/** ربط حساب موظف الخدمات / المحاسب بالإشعارات */
export async function resolveStaffProfileId(
  admin: ReturnType<typeof adminClient>,
  staffId: string,
  clinicId: string
): Promise<string | null> {
  const { data: staff } = await admin
    .from("staff_members")
    .select("profile_id, full_name_ar, job_title_ar")
    .eq("id", staffId)
    .maybeSingle();

  if (staff?.profile_id) return staff.profile_id;
  if (!staff?.full_name_ar) return null;

  const isAccountant = /محاسب/i.test(staff.job_title_ar ?? "");
  const roles = isAccountant
    ? (["accountant", "super_admin"] as const)
    : (["accountant", "super_admin"] as const);

  const { data: profiles } = await admin
    .from("profiles")
    .select("id, full_name")
    .eq("clinic_id", clinicId)
    .in("role", [...roles]);

  const name = staff.full_name_ar.trim();
  const match = profiles?.find((p) => p.full_name?.trim() === name);
  if (match?.id) {
    await admin
      .from("staff_members")
      .update({ profile_id: match.id })
      .eq("id", staffId)
      .is("profile_id", null);
    return match.id;
  }

  return null;
}

/** ربط حساب المساعد بالإشعارات */
export async function resolveAssistantProfileId(
  admin: ReturnType<typeof adminClient>,
  assistantId: string,
  clinicId: string
): Promise<string | null> {
  const { data: assistant } = await admin
    .from("assistants")
    .select("profile_id, full_name_ar")
    .eq("id", assistantId)
    .maybeSingle();

  if (assistant?.profile_id) return assistant.profile_id;
  if (!assistant?.full_name_ar) return null;

  const { data: profiles } = await admin
    .from("profiles")
    .select("id, full_name")
    .eq("clinic_id", clinicId)
    .eq("role", "assistant");

  const name = assistant.full_name_ar.trim();
  const match = profiles?.find((p) => p.full_name?.trim() === name);
  if (match?.id) {
    await admin
      .from("assistants")
      .update({ profile_id: match.id })
      .eq("id", assistantId)
      .is("profile_id", null);
    return match.id;
  }

  return null;
}

export async function insertNotifications(
  rows: {
    clinic_id: string;
    recipient_profile_id: string;
    title_ar: string;
    body_ar: string;
    link_path?: string;
  }[]
) {
  if (!rows.length) return;
  const admin = adminClient();

  let { error } = await admin.from("notifications").insert(rows);

  if (
    error &&
    rows.some((r) => r.link_path) &&
    (error.message.includes("link_path") ||
      error.message.includes("schema cache"))
  ) {
    const withoutLinks = rows.map(({ link_path: _lp, ...rest }) => rest);
    ({ error } = await admin.from("notifications").insert(withoutLinks));
  }

  if (error) throw new Error(error.message);
}

function formatAppointmentTimeRange(startTime: string, endTime: string): string {
  const start = startTime.slice(0, 5);
  const end = endTime.slice(0, 5);
  return `${start} – ${end}`;
}

/** طلب حجز باركود pending → إشعار المحاسب ومساعد الطبيب */
export async function notifyStaffBarcodeBooking(input: {
  clinicId: string;
  doctorId: string;
  patientName: string;
  appointmentDate: string;
  startTime: string;
  endTime: string;
}) {
  const admin = adminClient();

  const { data: doctor } = await admin
    .from("doctors")
    .select("full_name_ar")
    .eq("id", input.doctorId)
    .maybeSingle();

  const doctorName = doctor?.full_name_ar ?? "طبيب";
  const timeRange = formatAppointmentTimeRange(input.startTime, input.endTime);
  const title = "حجز عبر الباركود";
  const body = `المراجع ${input.patientName} — د. ${doctorName} — ${input.appointmentDate} ${timeRange} — بانتظار الموافقة`;

  const rows: {
    clinic_id: string;
    recipient_profile_id: string;
    title_ar: string;
    body_ar: string;
    link_path?: string;
  }[] = [];

  const seen = new Set<string>();

  function pushRow(
    profileId: string,
    linkPath: string
  ) {
    if (seen.has(profileId)) return;
    seen.add(profileId);
    rows.push({
      clinic_id: input.clinicId,
      recipient_profile_id: profileId,
      title_ar: title,
      body_ar: body,
      link_path: linkPath,
    });
  }

  const { data: accountants } = await admin
    .from("profiles")
    .select("id")
    .eq("clinic_id", input.clinicId)
    .in("role", ["accountant", "super_admin"]);

  for (const profile of accountants ?? []) {
    pushRow(profile.id as string, "/dashboard/queue");
  }

  const { data: assistants } = await admin
    .from("assistants")
    .select("id, profile_id")
    .eq("clinic_id", input.clinicId)
    .eq("doctor_id", input.doctorId)
    .eq("is_active", true);

  for (const assistant of assistants ?? []) {
    let profileId = assistant.profile_id as string | null;
    if (!profileId) {
      profileId = await resolveAssistantProfileId(
        admin,
        assistant.id as string,
        input.clinicId
      );
    }
    if (profileId) {
      pushRow(profileId, "/assistant/dashboard");
    }
  }

  if (!rows.length) return;
  await insertNotifications(rows);
}

/** Doctor requested withdrawal → notify accountants + clinic owner */
export async function notifyWithdrawalRequest(withdrawalId: string) {
  const admin = adminClient();

  const { data: w, error } = await admin
    .from("doctor_withdrawals")
    .select("id, clinic_id, amount, doctor_id")
    .eq("id", withdrawalId)
    .maybeSingle();

  if (error || !w) throw new Error("withdrawal not found");

  const { data: doctor } = await admin
    .from("doctors")
    .select("full_name_ar, profile_id")
    .eq("id", w.doctor_id)
    .maybeSingle();

  const doctorName = doctor?.full_name_ar ?? "طبيب";
  const amount = Number(w.amount);

  const { data: staff } = await admin
    .from("profiles")
    .select("id")
    .eq("clinic_id", w.clinic_id)
    .in("role", ["accountant", "super_admin"]);

  if (!staff?.length) return;

  await insertNotifications(
    staff.map((s) => ({
      clinic_id: w.clinic_id,
      recipient_profile_id: s.id,
      title_ar: "طلب سحب من طبيب",
      body_ar: `طلب ${doctorName} سحب مبلغ ${formatCurrency(amount)}`,
      link_path: "/dashboard/withdrawals",
    }))
  );
}

/** Accountant approved/paid/rejected → notify doctor */
export async function notifyWithdrawalStatus(withdrawalId: string, status: string) {
  const admin = adminClient();

  const { data: w, error } = await admin
    .from("doctor_withdrawals")
    .select("clinic_id, amount, doctor_id")
    .eq("id", withdrawalId)
    .maybeSingle();

  if (error || !w) throw new Error("withdrawal not found");

  const { data: doctor } = await admin
    .from("doctors")
    .select("full_name_ar, profile_id")
    .eq("id", w.doctor_id)
    .maybeSingle();

  const profileId =
    doctor?.profile_id ??
    (await resolveDoctorProfileId(admin, w.doctor_id, w.clinic_id));

  if (!profileId) return;

  const amount = Number(w.amount);
  const statusText: Record<string, string> = {
    approved: "تمت الموافقة على طلب السحب",
    paid:     "تم صرف مبلغ السحب",
    rejected: "تم رفض طلب السحب",
  };

  const title = statusText[status] ?? "تحديث طلب السحب";
  let body = `${title} — ${formatCurrency(amount)}`;
  if (status === "paid") {
    body = `تم صرف ${formatCurrency(amount)} نقداً — خُصم من محفظتك`;
  } else if (status === "approved") {
    body = `وافق المحاسب على سحب ${formatCurrency(amount)} — بانتظار الصرف النقدي`;
  } else if (status === "rejected") {
    body = `رُفض طلب سحب ${formatCurrency(amount)}`;
  }

  await insertNotifications([{
    clinic_id: w.clinic_id,
    recipient_profile_id: profileId,
    title_ar: title,
    body_ar: body,
    link_path: "/doctor/wallet",
  }]);
}

/** New patient session → notify assigned doctor */
export async function notifyDoctorNewOperation(operationId: string) {
  const admin = adminClient();

  const { data: op, error } = await admin
    .from("patient_operations")
    .select("id, clinic_id, doctor_id, total_amount, paid_amount, operation_name_ar, operation_type, patient_id")
    .eq("id", operationId)
    .maybeSingle();

  if (error || !op) throw new Error("operation not found");

  const [{ data: doctor }, { data: patient }] = await Promise.all([
    admin
      .from("doctors")
      .select("full_name_ar, profile_id")
      .eq("id", op.doctor_id)
      .maybeSingle(),
    admin
      .from("patients")
      .select("full_name_ar")
      .eq("id", op.patient_id)
      .maybeSingle(),
  ]);

  const profileId =
    doctor?.profile_id ??
    (await resolveDoctorProfileId(admin, op.doctor_id, op.clinic_id));
  if (!profileId) return;

  const opName =
    op.operation_name_ar ?? op.operation_type ?? "جلسة";

  const patientName = patient?.full_name_ar ?? "مريض";
  const total = Number(op.total_amount ?? 0);

  await insertNotifications([{
    clinic_id: op.clinic_id,
    recipient_profile_id: profileId,
    title_ar: "مراجع / جلسة جديدة",
    body_ar: `${patientName} — ${opName} — ${formatCurrency(total)}`,
    link_path: "/doctor/patients",
  }]);
}

/** دفعة أو جلسة من المحاسب — إشعار فوري للطبيب مع التفاصيل */
export async function notifyDoctorSessionPayment(
  operationId: string,
  extra?: { teethSummary?: string; remainingBalance?: number }
) {
  const admin = adminClient();

  const { data: op, error } = await admin
    .from("patient_operations")
    .select(
      "id, clinic_id, doctor_id, paid_amount, remaining_debt, total_amount, operation_name_ar, operation_type, patient_id, session_kind"
    )
    .eq("id", operationId)
    .maybeSingle();

  if (error || !op) throw new Error("operation not found");

  const [{ data: doctor }, { data: patient }] = await Promise.all([
    admin
      .from("doctors")
      .select("full_name_ar, profile_id")
      .eq("id", op.doctor_id)
      .maybeSingle(),
    admin
      .from("patients")
      .select("full_name_ar, agreed_total, total_paid")
      .eq("id", op.patient_id)
      .maybeSingle(),
  ]);

  const profileId =
    doctor?.profile_id ??
    (await resolveDoctorProfileId(admin, op.doctor_id, op.clinic_id));
  if (!profileId) return;

  const patientName = patient?.full_name_ar ?? "مراجع";
  const opLabel = op.operation_name_ar ?? op.operation_type ?? "جلسة";
  const paid = Number(op.paid_amount ?? 0);
  const agreed = Number(patient?.agreed_total ?? 0);
  const totalPaid = Number(patient?.total_paid ?? 0);
  const remaining =
    extra?.remainingBalance ??
    (agreed > 0
      ? Math.max(0, agreed - totalPaid)
      : Math.max(0, Number(op.remaining_debt ?? 0)));

  const teethLine = extra?.teethSummary?.trim()
    ? `\n🦷 ${extra.teethSummary.trim()}`
    : "";

  const bodyParts = [
    patientName,
    paid > 0 ? `دفع ${formatCurrency(paid)}` : null,
    `متبقي ${formatCurrency(remaining)}`,
    opLabel,
  ].filter(Boolean);

  await insertNotifications([
    {
      clinic_id: op.clinic_id,
      recipient_profile_id: profileId,
      title_ar: "دفعة / جلسة مراجع",
      body_ar: `${bodyParts.join(" — ")}${teethLine}`,
      link_path: `/doctor/patients/${op.patient_id}`,
    },
  ]);
}

/** Refund on doctor's session → notify doctor with amount + reason */
export async function notifyDoctorRefund(refundId: string) {
  const admin = adminClient();

  const { data: refund, error } = await admin
    .from("session_refunds")
    .select(
      "id, clinic_id, amount, reason, doctor_id, patient_id, session_id, treatment_case_id"
    )
    .eq("id", refundId)
    .maybeSingle();

  if (error || !refund) throw new Error("refund not found");

  const [{ data: doctor }, { data: patient }] = await Promise.all([
    admin
      .from("doctors")
      .select("full_name_ar, profile_id")
      .eq("id", refund.doctor_id)
      .maybeSingle(),
    admin
      .from("patients")
      .select("full_name_ar")
      .eq("id", refund.patient_id)
      .maybeSingle(),
  ]);

  const profileId =
    doctor?.profile_id ??
    (await resolveDoctorProfileId(admin, refund.doctor_id, refund.clinic_id));

  if (!profileId) return;

  const amount = Number(refund.amount ?? 0);
  const patientName = patient?.full_name_ar ?? "مراجع";
  const reason = String(refund.reason ?? "").trim() || "بدون سبب";

  await insertNotifications([
    {
      clinic_id: refund.clinic_id,
      recipient_profile_id: profileId,
      title_ar: "مرتجع على إحدى حالاتك",
      body_ar: `${patientName} — تم إرجاع ${formatCurrency(amount)} — السبب: ${reason}`,
      link_path: `/doctor/patients/${refund.patient_id}`,
    },
  ]);
}

const SALARY_ENTRY_NOTIFY_LABELS: Record<string, string> = {
  advance: "سلفة على راتبك",
  deduction: "خصم من راتبك",
  absence: "خصم غياب من راتبك",
  bonus: "مكافأة على راتبك",
};

function buildSalaryEntryNotifyBody(input: {
  monthYear: string;
  amount: number;
  entryType: string;
  notesAr?: string | null;
  netPayout?: number;
}): string {
  const netLine =
    input.netPayout != null
      ? ` — صافي الراتب الآن ${formatCurrency(input.netPayout)}`
      : "";
  const reason = input.notesAr?.trim();
  if (reason) {
    const reasonPart = isSalaryReasonRequired(input.entryType)
      ? ` — السبب: ${reason}`
      : ` (${reason})`;
    return `شهر ${input.monthYear}: ${formatCurrency(input.amount)}${reasonPart}${netLine}`;
  }
  return `شهر ${input.monthYear}: ${formatCurrency(input.amount)}${netLine}`;
}

async function notifySalaryEntryProfile(input: {
  clinicId: string;
  recipientProfileId: string;
  entryType: string;
  amount: number;
  monthYear: string;
  netPayout?: number;
  notesAr?: string | null;
  linkPath: string;
}) {
  const typeLabel =
    SALARY_ENTRY_NOTIFY_LABELS[input.entryType] ?? "تعديل على راتبك";

  await insertNotifications([
    {
      clinic_id: input.clinicId,
      recipient_profile_id: input.recipientProfileId,
      title_ar: typeLabel,
      body_ar: buildSalaryEntryNotifyBody(input),
      link_path: input.linkPath,
    },
  ]);
}

/** حركة راتب (خصم/مكافأة/سلفة) لطبيب راتب ثابت */
export async function notifyDoctorSalaryEntry(input: {
  clinicId: string;
  doctorId: string;
  entryType: string;
  amount: number;
  monthYear: string;
  netPayout?: number;
  notesAr?: string | null;
}) {
  const admin = adminClient();
  const profileId = await resolveDoctorProfileId(
    admin,
    input.doctorId,
    input.clinicId
  );
  if (!profileId) return;

  await notifySalaryEntryProfile({
    ...input,
    recipientProfileId: profileId,
    linkPath: "/doctor/wallet",
  });
}

/** إشعار موظف خدمات / محاسب */
export async function notifyStaffSalaryEntry(input: {
  clinicId: string;
  staffId: string;
  entryType: string;
  amount: number;
  monthYear: string;
  netPayout?: number;
  notesAr?: string | null;
}) {
  const admin = adminClient();
  const profileId = await resolveStaffProfileId(
    admin,
    input.staffId,
    input.clinicId
  );
  if (!profileId) return;

  await notifySalaryEntryProfile({
    ...input,
    recipientProfileId: profileId,
    linkPath: "/dashboard/salary",
  });
}

/** إشعار مساعد طبيب */
export async function notifyAssistantSalaryEntry(input: {
  clinicId: string;
  assistantId: string;
  entryType: string;
  amount: number;
  monthYear: string;
  netPayout?: number;
  notesAr?: string | null;
}) {
  const admin = adminClient();
  const profileId = await resolveAssistantProfileId(
    admin,
    input.assistantId,
    input.clinicId
  );
  if (!profileId) return;

  await notifySalaryEntryProfile({
    ...input,
    recipientProfileId: profileId,
    linkPath: "/assistant/dashboard",
  });
}
