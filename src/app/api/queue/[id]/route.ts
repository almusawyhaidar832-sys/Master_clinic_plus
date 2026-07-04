import { NextRequest, NextResponse } from "next/server";
import {
  getApiCallerProfile,
  isApiAssistantRole,
  isApiDoctorRole,
  isApiStaffRole,
} from "@/lib/auth/api-session";
import { getAdminClient } from "@/lib/supabase/admin";
import {
  accountantTransferAfterCancellation,
  transferQueueByAccountant,
  confirmQueueTransferByAccountant,
  dismissQueueTransferRequest,
  emitQueueScreenCall,
  finalizeQueueCancellationByAccountant,
  getDoctorByProfileId,
  notifyAccountantsReadyForBilling,
  notifyAccountantsReadyForPayment,
  rejectQueueEntryByDoctor,
  requestQueueTransferByStaff,
  requestQueueCancellationByStaff,
  updateQueueStatus,
  type QueueStatus,
} from "@/lib/queue/server";
import { buildLedgerPayUrl } from "@/lib/ledger/navigation";
import {
  completeSessionForAccounting,
  markQueueReadyForBilling,
} from "@/lib/services/session-checkout";
import { syncAppointmentFromQueueStatus } from "@/lib/services/appointment-queue-sync";
import { ensureQueueEntryPatient } from "@/lib/services/ensure-queue-entry-patient";
import { ensureVisitSessionOperation } from "@/lib/services/visit-session";
import {
  assertAssistantOwnsQueueEntry,
  resolveAssistantApiContext,
} from "@/lib/auth/resolve-assistant-api";

const NEXT_STATUS: Partial<Record<QueueStatus, QueueStatus>> = {
  waiting: "called",
  called: "in_progress",
};

function staffRolesOk(role: string) {
  return isApiStaffRole(role) || isApiAssistantRole(role);
}

async function updateQueueAndSync(
  admin: ReturnType<typeof getAdminClient>,
  queueEntryId: string,
  status: QueueStatus,
  opts?: { clinicId?: string; doctorId?: string; fromStatus?: QueueStatus }
) {
  await updateQueueStatus(queueEntryId, status, opts);
  await syncAppointmentFromQueueStatus(admin, queueEntryId, status).catch((err) => {
    console.error("[api/queue] appointment sync failed:", err);
  });
}

/** PATCH — advance status or cancel */
export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const profile = await getApiCallerProfile(req);
    if (!profile?.clinic_id) {
      return NextResponse.json({ error: "يجب تسجيل الدخول" }, { status: 401 });
    }

    const role = String(profile.role ?? "").toLowerCase();
    const body = (await req.json()) as {
      action?:
        | "advance"
        | "cancel"
        | "enter"
        | "ready_for_billing"
        | "ready_for_payment"
        | "reject"
        | "request_transfer"
        | "confirm_transfer"
        | "dismiss_transfer"
        | "finalize_cancel"
        | "transfer_after_cancel"
        | "accountant_transfer";
      target_doctor_id?: string;
    };

    const admin = getAdminClient();

    if (body.action === "cancel") {
      if (isApiDoctorRole(role)) {
        const doctor = await getDoctorByProfileId(profile.id);
        if (!doctor) {
          return NextResponse.json({ error: "حساب الطبيب غير مربوط" }, { status: 403 });
        }
        await requestQueueCancellationByStaff(id, {
          profileId: profile.id,
          role: "doctor",
          doctorId: doctor.id,
        });
        return NextResponse.json({ success: true, pending_accountant: true });
      }

      if (isApiAssistantRole(role)) {
        const ctx = await resolveAssistantApiContext(profile);
        if (!ctx) {
          return NextResponse.json({ error: "حساب المساعد غير مربوط" }, { status: 403 });
        }
        const owned = await assertAssistantOwnsQueueEntry(id, ctx);
        if (!owned.ok) {
          return NextResponse.json({ error: owned.error }, { status: owned.status });
        }
        await requestQueueCancellationByStaff(id, {
          profileId: profile.id,
          role: "assistant",
          doctorId: ctx.doctorId,
        });
        return NextResponse.json({ success: true, pending_accountant: true });
      }

      if (!staffRolesOk(role)) {
        return NextResponse.json({ error: "غير مصرح" }, { status: 403 });
      }

      await updateQueueAndSync(admin, id, "cancelled", { clinicId: profile.clinic_id });
      return NextResponse.json({ success: true });
    }

    if (body.action === "finalize_cancel") {
      if (!staffRolesOk(role) || isApiAssistantRole(role)) {
        return NextResponse.json({ error: "غير مصرح" }, { status: 403 });
      }
      await finalizeQueueCancellationByAccountant(id, profile.clinic_id as string);
      await syncAppointmentFromQueueStatus(admin, id, "cancelled").catch(console.error);
      return NextResponse.json({ success: true, status: "cancelled" });
    }

    if (body.action === "transfer_after_cancel") {
      if (!staffRolesOk(role) || isApiAssistantRole(role)) {
        return NextResponse.json({ error: "غير مصرح" }, { status: 403 });
      }
      const targetDoctorId = String(body.target_doctor_id ?? "").trim();
      if (!targetDoctorId) {
        return NextResponse.json({ error: "اختر الطبيب المستهدف" }, { status: 400 });
      }
      await accountantTransferAfterCancellation(
        id,
        profile.clinic_id as string,
        targetDoctorId
      );
      return NextResponse.json({ success: true });
    }

    if (body.action === "accountant_transfer") {
      if (!staffRolesOk(role) || isApiAssistantRole(role)) {
        return NextResponse.json({ error: "غير مصرح" }, { status: 403 });
      }
      const targetDoctorId = String(body.target_doctor_id ?? "").trim();
      if (!targetDoctorId) {
        return NextResponse.json({ error: "اختر الطبيب المستهدف" }, { status: 400 });
      }
      await transferQueueByAccountant(
        id,
        profile.clinic_id as string,
        targetDoctorId
      );
      return NextResponse.json({ success: true });
    }

    if (body.action === "reject") {
      if (!isApiDoctorRole(role)) {
        return NextResponse.json({ error: "غير مصرح" }, { status: 403 });
      }
      const doctor = await getDoctorByProfileId(profile.id);
      if (!doctor) {
        return NextResponse.json({ error: "حساب الطبيب غير مربوط" }, { status: 403 });
      }
      await rejectQueueEntryByDoctor(id, doctor.id, profile.id);
      return NextResponse.json({ success: true, pending_accountant: true });
    }

    if (body.action === "request_transfer") {
      const targetDoctorId = String(body.target_doctor_id ?? "").trim();
      if (!targetDoctorId) {
        return NextResponse.json({ error: "اختر الطبيب المستهدف" }, { status: 400 });
      }

      if (isApiDoctorRole(role)) {
        const doctor = await getDoctorByProfileId(profile.id);
        if (!doctor) {
          return NextResponse.json({ error: "حساب الطبيب غير مربوط" }, { status: 403 });
        }
        await requestQueueTransferByStaff(
          id,
          { profileId: profile.id, role: "doctor", doctorId: doctor.id },
          targetDoctorId
        );
        return NextResponse.json({ success: true });
      }

      if (isApiAssistantRole(role)) {
        const ctx = await resolveAssistantApiContext(profile);
        if (!ctx) {
          return NextResponse.json({ error: "حساب المساعد غير مربوط" }, { status: 403 });
        }
        const owned = await assertAssistantOwnsQueueEntry(id, ctx);
        if (!owned.ok) {
          return NextResponse.json({ error: owned.error }, { status: owned.status });
        }
        await requestQueueTransferByStaff(
          id,
          { profileId: profile.id, role: "assistant", doctorId: ctx.doctorId },
          targetDoctorId
        );
        return NextResponse.json({ success: true });
      }

      return NextResponse.json({ error: "غير مصرح" }, { status: 403 });
    }

    if (body.action === "confirm_transfer") {
      if (!staffRolesOk(role)) {
        return NextResponse.json({ error: "غير مصرح" }, { status: 403 });
      }
      await confirmQueueTransferByAccountant(id, profile.clinic_id as string);
      return NextResponse.json({ success: true });
    }

    if (body.action === "dismiss_transfer") {
      if (!staffRolesOk(role)) {
        return NextResponse.json({ error: "غير مصرح" }, { status: 403 });
      }
      await dismissQueueTransferRequest(id, profile.clinic_id as string);
      return NextResponse.json({ success: true });
    }

    if (body.action === "enter") {
      let doctorId: string;

      if (isApiDoctorRole(role)) {
        const doctor = await getDoctorByProfileId(profile.id);
        if (!doctor) {
          return NextResponse.json({ error: "حساب الطبيب غير مربوط" }, { status: 403 });
        }
        doctorId = doctor.id;
      } else if (isApiAssistantRole(role)) {
        const ctx = await resolveAssistantApiContext(profile);
        if (!ctx) {
          return NextResponse.json({ error: "حساب المساعد غير مربوط" }, { status: 403 });
        }
        const owned = await assertAssistantOwnsQueueEntry(id, ctx);
        if (!owned.ok) {
          return NextResponse.json({ error: owned.error }, { status: owned.status });
        }
        doctorId = ctx.doctorId;
      } else {
        return NextResponse.json({ error: "غير مصرح" }, { status: 403 });
      }

      const { data: entryCheck } = await admin
        .from("patient_queue")
        .select("doctor_id, status")
        .eq("id", id)
        .maybeSingle();

      if (!entryCheck || entryCheck.doctor_id !== doctorId) {
        return NextResponse.json({ error: "غير مصرح" }, { status: 403 });
      }
      if (entryCheck.status !== "called") {
        return NextResponse.json(
          { error: "لا يمكن الدخول — الحالة الحالية لا تسمح بذلك" },
          { status: 400 }
        );
      }

      await updateQueueAndSync(admin, id, "in_progress", {
        doctorId,
        fromStatus: "called",
      });

      let visitSession: Awaited<ReturnType<typeof ensureVisitSessionOperation>> | null =
        null;

      try {
        const patientCtx = await ensureQueueEntryPatient(
          admin,
          id,
          profile.clinic_id as string
        );
        visitSession = await ensureVisitSessionOperation(admin, {
          clinicId: patientCtx.clinicId,
          doctorId,
          patientId: patientCtx.patientId,
          queueEntryId: id,
          createdBy: profile.id,
          allowWithoutQueue: true,
        });
      } catch (err) {
        console.error("[api/queue] visit session on enter failed:", err);
      }

      return NextResponse.json({
        success: true,
        status: "in_progress",
        visit_session: visitSession,
      });
    }

    if (body.action === "ready_for_billing") {
      const isDoctor = isApiDoctorRole(role);
      const isAssistant = isApiAssistantRole(role);

      if (isAssistant) {
        const ctx = await resolveAssistantApiContext(profile);
        if (!ctx) {
          return NextResponse.json(
            { error: "حساب المساعد غير مربوط بطبيب" },
            { status: 403 }
          );
        }
        const check = await assertAssistantOwnsQueueEntry(id, ctx);
        if (!check.ok) {
          return NextResponse.json({ error: check.error }, { status: check.status });
        }

        const status = await markQueueReadyForBilling(admin, id, {
          doctorId: ctx.doctorId,
        });
        void notifyAccountantsReadyForBilling(id).catch((err) => {
          console.error("[api/queue] billing notify failed:", err);
        });

        const { data: entryRow } = await admin
          .from("patient_queue")
          .select(
            "patient_id, appointment_id, doctor_id, patient_name, patient_phone"
          )
          .eq("id", id)
          .maybeSingle();

        const ledgerUrl = buildLedgerPayUrl({
          queueEntryId: id,
          patientId: entryRow?.patient_id as string | null,
          appointmentId: entryRow?.appointment_id as string | null,
          doctorId: entryRow?.doctor_id as string | null,
          patientName: entryRow?.patient_name as string | null,
          patientPhone: entryRow?.patient_phone as string | null,
        });

        return NextResponse.json({ success: true, status, ledger_url: ledgerUrl });
      }

      if (!isDoctor && !staffRolesOk(role)) {
        return NextResponse.json({ error: "غير مصرح" }, { status: 403 });
      }

      const opts = isDoctor
        ? await (async () => {
            const doctor = await getDoctorByProfileId(profile.id);
            if (!doctor) {
              throw new Error("حساب الطبيب غير مربوط");
            }
            return { doctorId: doctor.id };
          })()
        : { clinicId: profile.clinic_id as string };

      const status = await markQueueReadyForBilling(admin, id, opts);
      void notifyAccountantsReadyForBilling(id).catch((err) => {
        console.error("[api/queue] billing notify failed:", err);
      });

      const { data: entryRow } = await admin
        .from("patient_queue")
        .select(
          "patient_id, appointment_id, doctor_id, patient_name, patient_phone"
        )
        .eq("id", id)
        .maybeSingle();

      const ledgerUrl = buildLedgerPayUrl({
        queueEntryId: id,
        patientId: entryRow?.patient_id as string | null,
        appointmentId: entryRow?.appointment_id as string | null,
        doctorId: entryRow?.doctor_id as string | null,
        patientName: entryRow?.patient_name as string | null,
        patientPhone: entryRow?.patient_phone as string | null,
      });

      return NextResponse.json({ success: true, status, ledger_url: ledgerUrl });
    }

    if (body.action === "ready_for_payment") {
      if (isApiAssistantRole(role)) {
        return NextResponse.json({ error: "غير مصرح" }, { status: 403 });
      }
      const isDoctor = isApiDoctorRole(role);
      if (isDoctor) {
        return NextResponse.json(
          { error: "استخدم «إرسال للمحاسبة» — إنهاء الدفع من المحاسب" },
          { status: 400 }
        );
      }
      if (!staffRolesOk(role)) {
        return NextResponse.json({ error: "غير مصرح" }, { status: 403 });
      }

      const status = await completeSessionForAccounting(admin, id, {
        clinicId: profile.clinic_id as string,
      });
      await notifyAccountantsReadyForPayment(id).catch((err) => {
        console.error("[api/queue] checkout notify failed:", err);
      });

      const { data: entryRow } = await admin
        .from("patient_queue")
        .select(
          "patient_id, appointment_id, doctor_id, patient_name, patient_phone"
        )
        .eq("id", id)
        .maybeSingle();

      const ledgerUrl = buildLedgerPayUrl({
        queueEntryId: id,
        patientId: entryRow?.patient_id as string | null,
        appointmentId: entryRow?.appointment_id as string | null,
        doctorId: entryRow?.doctor_id as string | null,
        patientName: entryRow?.patient_name as string | null,
        patientPhone: entryRow?.patient_phone as string | null,
      });

      return NextResponse.json({ success: true, status, ledger_url: ledgerUrl });
    }

    // advance (staff or doctor)
    const { data: entry } = await admin
      .from("patient_queue")
      .select("status, doctor_id")
      .eq("id", id)
      .eq("clinic_id", profile.clinic_id)
      .maybeSingle();

    if (!entry) {
      return NextResponse.json({ error: "الدور غير موجود" }, { status: 404 });
    }

    if (role === "doctor" || isApiDoctorRole(role)) {
      const doctor = await getDoctorByProfileId(profile.id);
      if (!doctor || doctor.id !== entry.doctor_id) {
        return NextResponse.json({ error: "غير مصرح" }, { status: 403 });
      }
    } else if (isApiAssistantRole(role)) {
      const ctx = await resolveAssistantApiContext(profile);
      if (!ctx || ctx.doctorId !== entry.doctor_id) {
        return NextResponse.json({ error: "غير مصرح" }, { status: 403 });
      }
    } else if (!staffRolesOk(role)) {
      return NextResponse.json({ error: "غير مصرح" }, { status: 403 });
    }

    const current = entry.status as QueueStatus;
    const next = NEXT_STATUS[current];
    if (!next) {
      return NextResponse.json({ error: "لا يمكن تقديم هذا الدور" }, { status: 400 });
    }

    await updateQueueAndSync(admin, id, next, {
      clinicId: profile.clinic_id,
      doctorId: role === "doctor" ? entry.doctor_id : undefined,
      fromStatus: current,
    });

    if (next === "called") {
      void emitQueueScreenCall(id).catch(console.error);
    }

    return NextResponse.json({ success: true, status: next });
  } catch (err) {
    console.error("[api/queue PATCH]", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "تعذر تحديث الدور" },
      { status: 500 }
    );
  }
}
