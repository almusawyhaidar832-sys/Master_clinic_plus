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
import {
  CalendarClock,
  Plus,
  RefreshCw,
  Pencil,
  Check,
  X,
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
  const filterDoctorId = role === "doctor" ? doctorId : role === "assistant" ? doctorId : null;

  const { appointments, loading, refresh, pendingCount } = useCentralizedAppointments({
    clinicId,
    doctorId: filterDoctorId,
    enabled: Boolean(clinicId) && (role !== "doctor" || Boolean(doctorId)),
  });

  const [showAdd, setShowAdd] = useState(false);
  const [editing, setEditing] = useState<AppointmentWithDoctor | null>(null);
  const [rejecting, setRejecting] = useState<AppointmentWithDoctor | null>(null);
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
      ? "حجز فوري لأي طبيب — منع تضارب المواعيد — تحديث لحظي"
      : role === "doctor"
        ? "مواعيدك فقط — تحديث فوري"
        : "إدارة كاملة — إضافة وتعديل وحذف";

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
    if (!confirm(`حذف موعد ${appt.patient_name_ar}؟`)) return;
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

  return (
    <div className={cn("space-y-4", compact && "space-y-3")}>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2
            className={cn(
              "font-bold text-slate-800",
              compact ? "text-base" : "text-xl"
            )}
          >
            {title ?? defaultTitle}
          </h2>
          <p className="text-sm text-slate-500">{subtitle ?? defaultSubtitle}</p>
        </div>
        <div className="flex gap-2">
          {canManage && (
            <button
              type="button"
              onClick={() => setShowAdd(true)}
              className="inline-flex items-center gap-1.5 rounded-xl bg-teal-600 px-4 py-2 text-sm font-semibold text-white shadow-sm hover:bg-teal-700"
            >
              <Plus className="h-4 w-4" />
              {role === "accountant" ? "حجز مراجع" : "إضافة موعد"}
            </button>
          )}
          <button
            type="button"
            onClick={() => refresh()}
            className="rounded-xl border border-slate-200 p-2 text-slate-500 hover:bg-white"
            aria-label="تحديث"
          >
            <RefreshCw className={cn("h-4 w-4", loading && "animate-spin")} />
          </button>
        </div>
      </div>

      {canManage && pendingCount > 0 && (
        <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
          <strong>{pendingCount}</strong> طلب من الباركود بانتظار الموافقة
        </div>
      )}

      {message && (
        <p className="rounded-xl bg-emerald-50 px-4 py-2 text-sm text-emerald-800">
          {message}
        </p>
      )}

      {loading ? (
        <div className="flex justify-center py-12">
          <RefreshCw className="h-6 w-6 animate-spin text-teal-600" />
        </div>
      ) : appointments.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-slate-200 bg-white p-8 text-center">
          <CalendarClock className="mx-auto mb-3 h-10 w-10 text-slate-300" />
          <p className="text-sm text-slate-500">لا توجد مواعيد قادمة</p>
          {canManage && (
            <button
              type="button"
              onClick={() => setShowAdd(true)}
              className="mt-3 text-sm font-medium text-teal-600 hover:underline"
            >
              إضافة موعد
            </button>
          )}
        </div>
      ) : (
        <div className="overflow-x-auto rounded-2xl border border-slate-200 bg-white shadow-sm">
          <table className="w-full min-w-[720px] text-sm">
            <thead>
              <tr className="border-b bg-slate-50 text-right text-xs text-slate-500">
                <th className="px-4 py-3 font-medium">المريض</th>
                <th className="px-4 py-3 font-medium">الهاتف</th>
                {showDoctorColumn && (
                  <th className="px-4 py-3 font-medium">الطبيب</th>
                )}
                <th className="px-4 py-3 font-medium">التاريخ والوقت</th>
                <th className="px-4 py-3 font-medium">الحالة</th>
                {canManage && (
                  <th className="px-4 py-3 font-medium">إجراءات</th>
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
                  onEdit={() => setEditing(a)}
                  onDelete={() => handleDelete(a)}
                />
              ))}
            </tbody>
          </table>
        </div>
      )}

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
            setMessage("تم رفض الطلب");
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
  onEdit: () => void;
  onDelete: () => void;
}) {
  const statusLabels = useAppointmentStatusLabels();
  const doctorName = a.doctor?.full_name_ar;
  const isPending = a.status === "pending";
  const canDelete = ["pending", "scheduled", "confirmed", "waiting"].includes(a.status);
  const canEdit =
    a.status !== "cancelled" &&
    a.status !== "completed" &&
    a.status !== "in_examination" &&
    a.status !== "in_clinic";

  return (
    <tr
      className={cn(
        "border-b border-slate-100 last:border-0",
        isPending && "bg-amber-50/40"
      )}
    >
      <td className="px-4 py-3">
        <p className="font-semibold text-slate-800">
          {a.patient_name_ar || "مريض"}
        </p>
        {a.notes ? (
          <p className="text-xs text-slate-500">{String(a.notes)}</p>
        ) : null}
        {a.reason_for_change && a.status === "cancelled" && (
          <p className="text-xs text-red-600">سبب: {a.reason_for_change}</p>
        )}
      </td>
      <td className="px-4 py-3 text-slate-600" dir="ltr">
        {phoneToLocalDisplay(a.patient_phone) || "—"}
      </td>
      {showDoctorColumn && (
        <td className="px-4 py-3 text-slate-700">
          {doctorName ?? "—"}
        </td>
      )}
      <td className="px-4 py-3 text-slate-600">
        {formatDate(a.appointment_date)}
        <br />
        <span className="text-xs">
          {singleTimeDisplay
            ? formatTime(a.start_time)
            : `${formatTime(a.start_time)} – ${formatTime(a.end_time)}`}
        </span>
      </td>
      <td className="px-4 py-3">
        <span
          className={cn(
            "inline-block rounded-full px-2.5 py-1 text-xs font-medium",
            APPOINTMENT_STATUS_COLORS[a.status] ??
              APPOINTMENT_STATUS_COLORS.scheduled
          )}
        >
          {statusLabels[a.status] ?? a.status}
        </span>
      </td>
      {canManage && (
        <td className="px-4 py-3">
          <div className="flex flex-wrap gap-1.5">
            {isPending && (
              <>
                <ActionBtn
                  onClick={onAccept}
                  disabled={actionId === a.id}
                  className="bg-emerald-600 text-white hover:bg-emerald-700"
                >
                  <Check className="h-3.5 w-3.5" />
                  موافقة
                </ActionBtn>
                <ActionBtn
                  onClick={onReject}
                  className="border border-red-200 bg-red-50 text-red-700 hover:bg-red-100"
                >
                  <X className="h-3.5 w-3.5" />
                  رفض
                </ActionBtn>
              </>
            )}
            {canEdit && (
              <ActionBtn
                onClick={onEdit}
                className="border border-slate-200 text-slate-700 hover:bg-slate-50"
              >
                <Pencil className="h-3.5 w-3.5" />
                تعديل
              </ActionBtn>
            )}
            {canDelete && (
              <ActionBtn
                onClick={onDelete}
                disabled={actionId === a.id}
                className="border border-red-200 text-red-600 hover:bg-red-50"
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
        "inline-flex items-center gap-1 rounded-lg px-2.5 py-1.5 text-xs font-medium disabled:opacity-50",
        className
      )}
    >
      {children}
    </button>
  );
}
