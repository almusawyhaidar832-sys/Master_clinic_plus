import { isSalaryReasonRequired } from "@/lib/services/salary-entry-reason";
import { FINANCIAL_EPSILON } from "@/lib/services/patient-financial-plan";
import { formatCurrency } from "@/lib/utils";
import { getAdminClient } from "@/lib/supabase/admin";
import { sendWebPushToProfile } from "@/lib/push/server";

function adminClient() {
  return getAdminClient();
}

function normalizePersonName(value: string): string {
  return value.trim().replace(/\s+/g, " ").toLocaleLowerCase("ar");
}

async function linkDoctorProfileId(
  admin: ReturnType<typeof adminClient>,
  doctorId: string,
  profileId: string
): Promise<string> {
  await admin
    .from("doctors")
    .update({ profile_id: profileId })
    .eq("id", doctorId)
    .is("profile_id", null);
  return profileId;
}

/** Resolve doctor login profile even if doctors.profile_id is missing */
export async function resolveDoctorProfileId(
  admin: ReturnType<typeof adminClient>,
  doctorId: string,
  clinicId: string
): Promise<string | null> {
  const { data: doc } = await admin
    .from("doctors")
    .select("profile_id, full_name_ar, phone")
    .eq("id", doctorId)
    .maybeSingle();

  if (doc?.profile_id) return doc.profile_id;

  const { data: profiles } = await admin
    .from("profiles")
    .select("id, full_name, phone")
    .eq("clinic_id", clinicId)
    .eq("role", "doctor");

  if (!profiles?.length) return null;

  const doctorName = doc?.full_name_ar?.trim() ?? "";
  const normalizedDoctorName = doctorName
    ? normalizePersonName(doctorName)
    : "";

  if (normalizedDoctorName) {
    const exact = profiles.find(
      (p) => p.full_name?.trim() === doctorName
    );
    if (exact?.id) {
      return linkDoctorProfileId(admin, doctorId, exact.id);
    }

    const fuzzy = profiles.find(
      (p) => normalizePersonName(p.full_name ?? "") === normalizedDoctorName
    );
    if (fuzzy?.id) {
      return linkDoctorProfileId(admin, doctorId, fuzzy.id);
    }
  }

  const doctorPhone = doc?.phone?.replace(/\D/g, "") ?? "";
  if (doctorPhone.length >= 8) {
    const byPhone = profiles.find((p) => {
      const profilePhone = String(p.phone ?? "").replace(/\D/g, "");
      return profilePhone.length >= 8 && profilePhone.endsWith(doctorPhone.slice(-10));
    });
    if (byPhone?.id) {
      return linkDoctorProfileId(admin, doctorId, byPhone.id);
    }
  }

  const { count: activeDoctorCount } = await admin
    .from("doctors")
    .select("id", { count: "exact", head: true })
    .eq("clinic_id", clinicId)
    .eq("is_active", true);

  if (profiles.length === 1 && activeDoctorCount === 1) {
    return linkDoctorProfileId(admin, doctorId, profiles[0]!.id);
  }

  if (!doctorName) return null;

  console.warn(
    "[notifications] doctor profile not linked:",
    doctorId,
    "clinic:",
    clinicId
  );
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

/** طلب حجز باركود pending → إشعار المحاسب ومساعد الطبيب والطبيب */
export async function notifyStaffBarcodeBooking(input: {
  clinicId: string;
  doctorId: string;
  appointmentId?: string;
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

  const doctorProfileId = await resolveDoctorProfileId(
    admin,
    input.doctorId,
    input.clinicId
  );
  if (doctorProfileId) {
    pushRow(doctorProfileId, "/doctor/schedule");
  }

  if (!rows.length) return;
  await insertNotifications(rows);

  if (doctorProfileId) {
    const doctorBody = `المراجع ${input.patientName} يريد حجزاً بتاريخ ${input.appointmentDate} ${timeRange} — بانتظار الموافقة`;
    await sendWebPushToProfile(doctorProfileId, {
      title: "حجز عبر الباركود 📅",
      body: doctorBody,
      url: "/doctor/schedule",
      tag: `doctor-barcode-${input.appointmentId ?? input.doctorId}`,
      kind: "barcode_booking",
    }).catch((err) => {
      console.error("[notifications] doctor barcode push failed:", err);
    });
  }
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

  const paid = Number(op.paid_amount ?? 0);
  if (paid <= FINANCIAL_EPSILON) return;

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

  const linkPath = `/doctor/patients/${op.patient_id}#patient-sessions`;
  const titleAr = "تم تسديد مبلغ";
  const bodyAr = [
    patientName,
    formatCurrency(paid),
    remaining > FINANCIAL_EPSILON
      ? `المتبقي ${formatCurrency(remaining)}`
      : "تم إكمال الذمة",
    opLabel !== "جلسة" ? opLabel : null,
  ]
    .filter(Boolean)
    .join(" — ")
    .concat(teethLine);

  await insertNotifications([
    {
      clinic_id: op.clinic_id,
      recipient_profile_id: profileId,
      title_ar: titleAr,
      body_ar: bodyAr,
      link_path: linkPath,
    },
  ]);

  await sendWebPushToProfile(profileId, {
    title: titleAr,
    body: bodyAr,
    url: linkPath,
    tag: `doctor-payment-${operationId}`,
    kind: "patient_payment",
  }).catch((err) => {
    console.error("[notifications] doctor payment push failed:", err);
  });
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

/** إشعار الطبيب عند تأكيد صرف راتب مساعد (خصم حصته) */
export async function notifyDoctorAssistantPayrollConfirmed(input: {
  clinicId: string;
  doctorId: string;
  assistantName: string;
  monthYear: string;
  doctorDeducted: number;
  clinicDeducted: number;
}) {
  if (input.doctorDeducted <= 0 && input.clinicDeducted <= 0) return;

  const admin = adminClient();
  const profileId = await resolveDoctorProfileId(
    admin,
    input.doctorId,
    input.clinicId
  );
  if (!profileId) return;

  const parts: string[] = [];
  if (input.doctorDeducted > 0) {
    parts.push(`خصم ${formatCurrency(input.doctorDeducted)} من حصتك`);
  }
  if (input.clinicDeducted > 0) {
    parts.push(`${formatCurrency(input.clinicDeducted)} من ربح العيادة`);
  }

  await insertNotifications([
    {
      clinic_id: input.clinicId,
      recipient_profile_id: profileId,
      title_ar: "تأكيد صرف راتب مساعد",
      body_ar: `${input.assistantName} — ${input.monthYear}: ${parts.join(" — ")}`,
      link_path: "/doctor/ledger",
    },
  ]);
}

const NOTIFICATION_INBOX_BASE =
  "id, title_ar, body_ar, is_read, created_at";

export type NotificationInboxRow = {
  id: string;
  title_ar: string;
  body_ar: string;
  is_read: boolean;
  created_at: string;
  link_path?: string | null;
};

function isMissingLinkPathColumn(message: string): boolean {
  const m = message.toLowerCase();
  return m.includes("link_path") || m.includes("schema cache");
}

/** قائمة إشعارات المستخدم — يتجاوز RLS ويدعم DB بدون عمود link_path */
export async function fetchNotificationsForRecipient(
  profileId: string,
  limit = 50
): Promise<NotificationInboxRow[]> {
  const admin = adminClient();

  const withLinkPath = await admin
    .from("notifications")
    .select(`${NOTIFICATION_INBOX_BASE}, link_path`)
    .eq("recipient_profile_id", profileId)
    .order("created_at", { ascending: false })
    .limit(limit);

  let data: NotificationInboxRow[] | null = withLinkPath.data;
  let error = withLinkPath.error;

  if (error && isMissingLinkPathColumn(error.message)) {
    const fallback = await admin
      .from("notifications")
      .select(NOTIFICATION_INBOX_BASE)
      .eq("recipient_profile_id", profileId)
      .order("created_at", { ascending: false })
      .limit(limit);
    data = fallback.data;
    error = fallback.error;
  }

  if (error) throw new Error(error.message);
  return (data ?? []) as NotificationInboxRow[];
}

export async function fetchUnreadNotificationCountForRecipient(
  profileId: string
): Promise<number> {
  const admin = adminClient();
  const { count, error } = await admin
    .from("notifications")
    .select("*", { count: "exact", head: true })
    .eq("recipient_profile_id", profileId)
    .eq("is_read", false);

  if (error) throw new Error(error.message);
  return count ?? 0;
}
