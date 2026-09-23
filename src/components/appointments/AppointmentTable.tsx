"use client";

import { useState } from "react";
import {
  useCentralizedAppointments,
  type AppointmentTableRole,
  type AppointmentWithDoctor,
} from "@/hooks/useCentralizedAppointments";
import {
  APPOINTMENT_STATUS_COLORS,
} from "@/components/appointments/appointment-constants";
import { useAppointmentStatusLabels } from "@/i18n/localized-labels";
import { AddAppointmentModal } from "@/components/assistant/AddAppointmentModal";
import { EditAppointmentModal } from "@/components/assistant/EditAppointmentModal";
import { RejectAppointmentModal } from "@/components/assistant/RejectAppointmentModal";
import { CancelAppointmentModal } from "@/components/assistant/CancelAppointmentModal";
import {
  deleteAssistantAppointmentViaApi,
  setAssistantAppointmentStatusViaApi,
} from "@/lib/services/assistant-appointments-client";
import {
  deleteAccountantAppointmentViaApi,
  setAccountantAppointmentStatusViaApi,
} from "@/lib/services/accountant-appointments-client";
import { formatDate, formatTime } from "@/lib/utils";
import { phoneToLocalDisplay } from "@/lib/phone";
import { cn } from "@/lib/utils";
import { PageHeader } from "@/components/ui/PageHeader";
import { useLanguage } from "@/contexts/LanguageContext";
import {
  Hourglass,
  CalendarClock,
  Plus,
  RefreshCw,
  Pencil,
  Check,
  X,
  Ban,
  Trash2,
} from "lucide-react";

export interface AppointmentTableProps {
  role: AppointmentTableRole;
  clinicId: string | null;
  /** مطلوب لدور الطبيب — فلترة مواعيده فقط */
  doctorId?: string | null;
  title?: string;
  subtitle?: string;
  compact?: boolean;
}

export function AppointmentTable({
  role,
  clinicId,
  doctorId = null,
  title,
  subtitle,
  compact = false,
}: AppointmentTableProps) {
  const { bi } = useLanguage();
  const filterDoctorId = role === "doctor" ? doctorId : role === "assistant" ? doctorId : null;

  const { appointments, loading, refresh, pendingCount } = useCentralizedAppointments({
    clinicId,
    doctorId: filterDoctorId,
    enabled: Boolean(clinicId) && (role !== "doctor" || Boolean(doctorId)),
  });

  const [showAdd, setShowAdd] = useState(false);
  const [editing, setEditing] = useState<AppointmentWithDoctor | null>(null);
  const [rejecting, setRejecting] = useState<AppointmentWithDoctor | null>(null);
  const [cancelling, setCancelling] = useState<AppointmentWithDoctor | null>(null);
  const [actionId, setActionId] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const canManage = role === "assistant" || role === "accountant";
  const showDoctorColumn = role === "accountant";
  const portal = role === "accountant" ? "accountant" : "assistant";

  const defaultTitle =
    role === "accountant"
      ? "حجوزات العيادة"
      : role === "doctor"
        ? "مواعيدي"
        : "حجوزات طبيبي";

  const defaultSubtitle =
    role === "accountant"
      ? "حجز فوري — إلغاء ثم حذف (مرحلتان منفصلتان)"
      : role === "doctor"
        ? "مواعيدك فقط — تحديث فوري"
        : "إضافة وتعديل — إلغاء ثم حذف (مرحلتان)";

  async function handleAccept(appt: AppointmentWithDoctor) {
    setActionId(appt.id);
    setMessage(null);
    const result =
      portal === "accountant"
        ? await setAccountantAppointmentStatusViaApi(appt.id, "accept")
        : await setAssistantAppointmentStatusViaApi(appt.id, "accept");
    setActionId(null);
    if (!result.ok) {
      setMessage(result.error ?? "تعذر القبول");
      return;
    }
    setMessage(
      result.queuedToWaitingRoom
        ? "تمت الموافقة — المريض في غرفة الانتظار"
        : "تم تأكيد الحجز — سيُضاف لغرفة الانتظار في يوم الموعد"
    );
    refresh();
  }

  async function handleDelete(appt: AppointmentWithDoctor) {
    if (!confirm(`حذف نهائي لموعد ${appt.patient_name_ar}؟ (بعد الإلغاء فقط)`)) return;
    setActionId(appt.id);
    const result =
      portal === "accountant"
        ? await deleteAccountantAppointmentViaApi(appt.id)
        : await deleteAssistantAppointmentViaApi(appt.id);
    setActionId(null);
    if (!result.ok) {
      setMessage(result.error ?? "تعذر الحذف");
      return;
    }
    setMessage("تم حذف الموعد");
    refresh();
  }

  const asPage = !compact && role !== "doctor";

  const headerActions = (
    <>
      {canManage && (
        <button
          type="button"
          onClick={() => setShowAdd(true)}
          className="mc-btn-navy"
        >
          <Plus className="h-4 w-4" />
          {role === "accountant" ? "حجز مراجع" : "إضافة موعد"}
        </button>
      )}
      <button
        type="button"
        onClick={() => refresh()}
        className="mc-btn-soft h-9 w-9 !p-0"
        aria-label="تحديث"
      >
        <RefreshCw className={cn("h-4 w-4", loading && "animate-spin")} />
      </button>
    </>
  );

  return (
    <div className={cn("space-y-4", compact && "space-y-3")}>
      {asPage ? (
        <PageHeader
          eyebrow={bi("المواعيد", "Scheduling")}
          title={title ?? defaultTitle}
          subtitle={subtitle ?? defaultSubtitle}
          icon={CalendarClock}
          actions={headerActions}
          className="mb-0"
        />
      ) : null}

      {canManage && pendingCount > 0 && (
        <div className="flex items-center gap-3 rounded-2xl border border-warning-border bg-warning px-4 py-3 text-sm text-warning-text shadow-card">
          <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-xl bg-surface-card ring-1 ring-inset ring-warning-border">
            <Hourglass className="h-4 w-4" />
          </span>
          <p>
            <strong className="text-base tabular-nums">{pendingCount}</strong> طلب من الباركود بانتظار الموافقة
          </p>
        </div>
      )}

      {message && (
        <p className="flex items-center gap-2 rounded-2xl border border-success-border bg-success px-4 py-2.5 text-sm font-medium text-success-text">
          <Check className="h-4 w-4 shrink-0" />
          {message}
        </p>
      )}

      <section className="mc-panel">
        {!asPage && (
          <div className="mc-panel-head">
            <div className="min-w-0">
              <h2 className="mc-panel-title">
                <CalendarClock />
                {title ?? defaultTitle}
              </h2>
              <p className="mt-0.5 text-xs text-slate-muted">{subtitle ?? defaultSubtitle}</p>
            </div>
            <div className="flex items-center gap-2">{headerActions}</div>
          </div>
        )}

      {loading ? (
        <div className="space-y-2 p-5">
          {[0, 1, 2].map((i) => (
            <div key={i} className="mc-skeleton h-12 w-full" />
          ))}
        </div>
      ) : appointments.length === 0 ? (
        <div className="flex flex-col items-center px-6 py-12 text-center">
          <span className="mb-4 flex h-14 w-14 items-center justify-center rounded-2xl bg-surface text-slate-muted ring-1 ring-inset ring-slate-border">
            <CalendarClock className="h-7 w-7" strokeWidth={1.6} />
          </span>
          <p className="text-sm font-medium text-slate-muted">لا توجد مواعيد قادمة</p>
          {canManage && (
            <button
              type="button"
              onClick={() => setShowAdd(true)}
              className="mc-btn-soft mt-4"
            >
              <Plus className="h-4 w-4" />
              إضافة موعد
            </button>
          )}
        </div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[720px] text-sm">
            <thead>
              <tr className="text-start text-xs text-slate-muted">
                <th className="px-5 py-3 text-start font-semibold">المريض</th>
                <th className="px-4 py-3 text-start font-semibold">الهاتف</th>
                {showDoctorColumn && (
                  <th className="px-4 py-3 text-start font-semibold">الطبيب</th>
                )}
                <th className="px-4 py-3 text-start font-semibold">التاريخ والوقت</th>
                <th className="px-4 py-3 text-start font-semibold">الحالة</th>
                {canManage && (
                  <th className="px-4 py-3 text-start font-semibold">إجراءات</th>
                )}
              </tr>
            </thead>
            <tbody>
              {appointments.map((a) => (
                <AppointmentRow
                  key={a.id}
                  appointment={a}
                  showDoctorColumn={showDoctorColumn}
                  singleTimeDisplay={role === "accountant"}
                  canManage={canManage}
                  actionId={actionId}
                  onAccept={() => handleAccept(a)}
                  onReject={() => setRejecting(a)}
                  onCancel={() => setCancelling(a)}
                  onEdit={() => setEditing(a)}
                  onDelete={() => handleDelete(a)}
                />
              ))}
            </tbody>
          </table>
        </div>
      )}
      </section>

      {showAdd && (
        <AddAppointmentModal
          portal={portal}
          clinicId={clinicId}
          onClose={() => setShowAdd(false)}
          onSaved={(notice) => {
            setMessage(
              notice ??
                (role === "accountant"
                  ? "تم حجز المراجع بنجاح"
                  : "تم إضافة الموعد")
            );
            refresh();
          }}
        />
      )}
      {editing && (
        <EditAppointmentModal
          appointment={editing}
          portal={portal}
          onClose={() => setEditing(null)}
          onSaved={() => {
            setMessage("تم تعديل الموعد");
            refresh();
          }}
        />
      )}
      {rejecting && (
        <RejectAppointmentModal
          appointment={rejecting}
          portal={portal}
          onClose={() => setRejecting(null)}
          onSaved={() => {
            setMessage("تم رفض الطلب — المرحلة الأولى (ملغي)");
            refresh();
          }}
        />
      )}
      {cancelling && (
        <CancelAppointmentModal
          appointment={cancelling}
          portal={portal}
          onClose={() => setCancelling(null)}
          onSaved={() => {
            setMessage("تم إلغاء الحجز — يمكنك حذفه الآن من زر «حذف»");
            refresh();
          }}
        />
      )}
    </div>
  );
}

function AppointmentRow({
  appointment: a,
  showDoctorColumn,
  singleTimeDisplay,
  canManage,
  actionId,
  onAccept,
  onReject,
  onCancel,
  onEdit,
  onDelete,
}: {
  appointment: AppointmentWithDoctor;
  showDoctorColumn: boolean;
  singleTimeDisplay: boolean;
  canManage: boolean;
  actionId: string | null;
  onAccept: () => void;
  onReject: () => void;
  onCancel: () => void;
  onEdit: () => void;
  onDelete: () => void;
}) {
  const statusLabels = useAppointmentStatusLabels();
  const doctorName = a.doctor?.full_name_ar;
  const isPending = a.status === "pending";
  const isCancelled = a.status === "cancelled";
  const canDelete = isCancelled;
  const canCancel = ["scheduled", "confirmed", "waiting"].includes(a.status);
  const canEdit =
    a.status !== "cancelled" &&
    a.status !== "completed" &&
    a.status !== "in_examination" &&
    a.status !== "in_clinic";

  return (
    <tr
      className={cn(
        "border-b border-slate-border last:border-0",
        isPending && "bg-premium-50/40"
      )}
    >
      <td className="px-5 py-3.5">
        <div className="flex items-center gap-3">
          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-mc-pearl text-sm font-bold text-[#0b1f3a] ring-1 ring-inset ring-premium-200">
            {(a.patient_name_ar || "م").trim().charAt(0)}
          </span>
          <div className="min-w-0">
            <p className="font-semibold text-slate-text">
              {a.patient_name_ar || "مريض"}
            </p>
            {a.notes ? (
              <p className="truncate text-xs text-slate-muted">{String(a.notes)}</p>
            ) : null}
            {a.reason_for_change && a.status === "cancelled" && (
              <p className="text-xs text-debt-text">سبب: {a.reason_for_change}</p>
            )}
          </div>
        </div>
      </td>
      <td className="px-4 py-3.5 tabular-nums text-slate-muted" dir="ltr">
        {phoneToLocalDisplay(a.patient_phone) || "—"}
      </td>
      {showDoctorColumn && (
        <td className="px-4 py-3.5 font-medium text-slate-text">
          {doctorName ?? "—"}
        </td>
      )}
      <td className="px-4 py-3.5">
        <p className="font-medium text-slate-text">{formatDate(a.appointment_date)}</p>
        <span className="text-xs tabular-nums text-slate-muted">
          {singleTimeDisplay
            ? formatTime(a.start_time)
            : `${formatTime(a.start_time)} – ${formatTime(a.end_time)}`}
        </span>
      </td>
      <td className="px-4 py-3.5">
        <span
          className={cn(
            "inline-flex items-center rounded-full px-2.5 py-1 text-xs font-semibold",
            APPOINTMENT_STATUS_COLORS[a.status] ??
              APPOINTMENT_STATUS_COLORS.scheduled
          )}
        >
          {statusLabels[a.status] ?? a.status}
        </span>
      </td>
      {canManage && (
        <td className="px-4 py-3.5">
          <div className="flex flex-wrap gap-1.5">
            {isPending && (
              <>
                <ActionBtn
                  onClick={onAccept}
                  disabled={actionId === a.id}
                  className="border-transparent bg-mc-navy text-white shadow-soft hover:brightness-110"
                >
                  <Check className="h-3.5 w-3.5" />
                  موافقة
                </ActionBtn>
                <ActionBtn
                  onClick={onReject}
                  className="text-debt-text hover:border-debt-border hover:bg-debt"
                >
                  <X className="h-3.5 w-3.5" />
                  رفض
                </ActionBtn>
              </>
            )}
            {canEdit && (
              <ActionBtn
                onClick={onEdit}
                className="text-slate-text hover:border-primary-200 hover:bg-primary-50"
              >
                <Pencil className="h-3.5 w-3.5" />
                تعديل
              </ActionBtn>
            )}
            {canCancel && (
              <ActionBtn
                onClick={onCancel}
                disabled={actionId === a.id}
                className="text-warning-text hover:border-warning-border hover:bg-warning"
              >
                <Ban className="h-3.5 w-3.5" />
                إلغاء
              </ActionBtn>
            )}
            {canDelete && (
              <ActionBtn
                onClick={onDelete}
                disabled={actionId === a.id}
                className="text-debt-text hover:border-debt-border hover:bg-debt"
              >
                <Trash2 className="h-3.5 w-3.5" />
                حذف
              </ActionBtn>
            )}
          </div>
        </td>
      )}
    </tr>
  );
}

function ActionBtn({
  children,
  onClick,
  disabled,
  className,
}: {
  children: React.ReactNode;
  onClick: () => void;
  disabled?: boolean;
  className?: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={cn(
        "inline-flex items-center gap-1 rounded-lg border border-slate-border bg-surface-card px-2.5 py-1.5 text-xs font-semibold transition-colors disabled:opacity-50",
        className
      )}
    >
      {children}
    </button>
  );
}
