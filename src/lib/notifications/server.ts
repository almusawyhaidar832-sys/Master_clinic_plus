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
    body = `تم سحب ${formatCurrency(amount)} من محفظتك`;
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
