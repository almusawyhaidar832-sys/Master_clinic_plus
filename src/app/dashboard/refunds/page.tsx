"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { Select } from "@/components/ui/Select";
import { Alert } from "@/components/ui/Alert";
import { PageHeader } from "@/components/ui/PageHeader";
import { useLanguage } from "@/contexts/LanguageContext";
import { SessionRefundModal } from "@/components/sessions/SessionRefundModal";
import { createClient } from "@/lib/supabase/client";
import { getAuthProfile } from "@/lib/clinic-context";
import { PatientSearchField } from "@/components/patients/PatientSearchField";
import { formatDoctorDisplayName } from "@/lib/services/clinic-profile";
import {
  fetchRefundableSessionsByDoctor,
  fetchRefundableSessionsByPatients,
  fetchRefundHistory,
  type RefundableSessionRow,
  type RefundHistoryRow,
} from "@/lib/services/session-refunds";
import { cn, formatCurrency, formatDate } from "@/lib/utils";
import type { Doctor, PatientOperation } from "@/types";
import {
  CheckCircle2,
  Search,
  Undo2,
  User,
  Stethoscope,
  FileBarChart,
  ListChecks,
  History,
} from "lucide-react";
import { useClinicSync } from "@/hooks/useClinicSync";
import { useActiveClinicId } from "@/hooks/useActiveClinicId";

type SearchMode = "patient" | "doctor";

export default function RefundsDashboardPage() {
  const { clinicId } = useActiveClinicId();
  const { bi } = useLanguage();
  const [mode, setMode] = useState<SearchMode>("patient");
  const [patientQuery, setPatientQuery] = useState("");
  const [selectedPatientId, setSelectedPatientId] = useState<string | null>(null);
  const [doctorId, setDoctorId] = useState("");
  const [doctors, setDoctors] = useState<Doctor[]>([]);
  const [sessions, setSessions] = useState<RefundableSessionRow[]>([]);
  const [history, setHistory] = useState<RefundHistoryRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [searched, setSearched] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [refundTarget, setRefundTarget] = useState<RefundableSessionRow | null>(
    null
  );

  const loadHistory = useCallback(async () => {
    const supabase = createClient();
    const rows = await fetchRefundHistory(supabase, 40);
    setHistory(rows);
  }, []);

  const loadDoctors = useCallback(async () => {
    const supabase = createClient();
    const profile = await getAuthProfile(supabase);
    if (!profile?.clinic_id) return;
    const { data } = await supabase
      .from("doctors")
      .select("*")
      .eq("clinic_id", profile.clinic_id)
      .eq("is_active", true)
      .order("full_name_ar");
    if (data) setDoctors(data as Doctor[]);
  }, []);

  useEffect(() => {
    loadHistory();
    loadDoctors();
  }, [loadHistory, loadDoctors]);

  useClinicSync({
    topics: ["refunds"],
    clinicId,
    onRefresh: () => {
      void loadHistory();
      if (searched) void searchSessions();
    },
    enabled: !!clinicId,
  });

  async function searchSessions(patientIdOverride?: string | null) {
    setLoading(true);
    setSearched(true);
    setMessage(null);
    setSuccess(null);

    const supabase = createClient();
    let rows: RefundableSessionRow[] = [];

    try {
      if (mode === "doctor") {
        if (!doctorId) {
          setMessage("اختر الطبيب أولاً");
          setSessions([]);
          setLoading(false);
          return;
        }
        rows = await fetchRefundableSessionsByDoctor(supabase, doctorId);
      } else {
        const pid = patientIdOverride ?? selectedPatientId;
        if (pid) {
          rows = await fetchRefundableSessionsByPatients(supabase, [pid]);
        } else {
          setMessage("اختر مراجعاً من القائمة أو اكتب اسمه ثم اضغط بحث");
          setSessions([]);
          setLoading(false);
          return;
        }
      }

      setSessions(rows);
      if (rows.length === 0) {
        setMessage("لا توجد جلسات بمبالغ قابلة للإرجاع");
      }
    } catch {
      setMessage("تعذر تحميل الجلسات");
      setSessions([]);
    }

    setLoading(false);
  }

  function handleRefundSaved(info?: { amount: number }) {
    const targetId = refundTarget?.id;
    const refundedAmt = info?.amount ?? 0;

    setRefundTarget(null);
    setMessage(null);

    if (refundedAmt > 0) {
      setSuccess(
        `تم تسجيل الإرجاع بنجاح — ${formatCurrency(refundedAmt)} مسترجعة للمراجع`
      );
      if (targetId) {
        setSessions((prev) =>
          prev
            .map((s) => {
              if (s.id !== targetId) return s;
              const refundedAmount =
                Math.round((s.refundedAmount + refundedAmt) * 100) / 100;
              const maxRefundable =
                Math.round((s.paidAmount - refundedAmount) * 100) / 100;
              if (maxRefundable <= 0.001) return null;
              return { ...s, refundedAmount, maxRefundable };
            })
            .filter((s): s is RefundableSessionRow => s !== null)
        );
      }
    }

    void loadHistory();
    if (searched) void searchSessions();
  }

  const stubOp = (row: RefundableSessionRow): PatientOperation => ({
    id: row.id,
    clinic_id: "",
    patient_id: row.patientId,
    doctor_id: row.doctorId,
    operation_name_ar: row.operationName,
    operation_date: row.operationDate,
    total_amount: 0,
    paid_amount: row.paidAmount,
    session_kind:
      row.sessionKind === "plan" || row.sessionKind === "discount"
        ? row.sessionKind
        : "payment",
  });

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <PageHeader
        title="إدارة المرتجعات"
        eyebrow={bi("المالية", "Finance")}
        icon={Undo2}
        subtitle="ابحث عن المراجع أو الطبيب، اختر الجلسة، وسجّل الإرجاع مع تتبّع كامل"
        className="mb-0"
        actions={
          <Link href="/dashboard/reports" className="mc-btn-soft py-2.5">
            <FileBarChart className="h-4 w-4 text-premium-500" />
            سجل المرتجعات في التقارير
          </Link>
        }
      />

      {success && (
        <Alert variant="success" className="flex items-center gap-2">
          <CheckCircle2 className="h-5 w-5 shrink-0" />
          {success}
        </Alert>
      )}
      {message && <Alert variant="warning">{message}</Alert>}

      <div className="mc-panel">
        <div className="mc-panel-head">
          <h3 className="mc-panel-title">
            <Search />
            بحث جلسة للإرجاع
          </h3>
          <div className="mc-tab-group p-1 shadow-none">
            <button
              type="button"
              onClick={() => setMode("patient")}
              className={cn(
                "mc-tab min-w-0 px-4 py-2",
                mode === "patient" && "mc-tab--active"
              )}
            >
              <User className="h-4 w-4" />
              بالمراجع
            </button>
            <button
              type="button"
              onClick={() => setMode("doctor")}
              className={cn(
                "mc-tab min-w-0 px-4 py-2",
                mode === "doctor" && "mc-tab--active"
              )}
            >
              <Stethoscope className="h-4 w-4" />
              بالطبيب
            </button>
          </div>
        </div>
        <div className="mc-panel-body">
          {mode === "patient" ? (
            <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
              <div className="min-w-0 flex-1">
                <p className="mc-label mb-1.5">
                  ابحث بالاسم — تظهر النتائج أثناء الكتابة
                </p>
                <PatientSearchField
                  portal="accountant"
                  value={patientQuery}
                  selectedPatientId={selectedPatientId}
                  placeholder="اسم المراجع (حرفان على الأقل)..."
                  onChange={(v) => {
                    setPatientQuery(v);
                    setSelectedPatientId(null);
                  }}
                  onSelect={(p) => {
                    setPatientQuery(p.full_name_ar);
                    setSelectedPatientId(p.id);
                    void searchSessions(p.id);
                  }}
                />
              </div>
              <button
                type="button"
                className="mc-btn-navy h-10 px-5"
                onClick={() => searchSessions()}
                disabled={loading || !selectedPatientId}
              >
                <Search className="h-4 w-4 text-premium-300" />
                عرض الجلسات
              </button>
            </div>
          ) : (
            <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
              <div className="min-w-0 flex-1">
                <Select
                  label="الطبيب"
                  value={doctorId}
                  onChange={(e) => setDoctorId(e.target.value)}
                  placeholder="— اختر الطبيب —"
                  options={doctors.map((d) => ({
                    value: d.id,
                    label: formatDoctorDisplayName(d.full_name_ar),
                  }))}
                />
              </div>
              <button
                type="button"
                className="mc-btn-navy h-10 px-5"
                onClick={() => searchSessions()}
                disabled={loading}
              >
                <Search className="h-4 w-4 text-premium-300" />
                عرض الجلسات
              </button>
            </div>
          )}
        </div>
      </div>

      {searched && sessions.length > 0 && (
        <div className="mc-panel">
          <div className="mc-panel-head">
            <h3 className="mc-panel-title">
              <ListChecks />
              جلسات قابلة للإرجاع ({sessions.length})
            </h3>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[640px] text-sm">
              <thead>
                <tr className="border-b border-slate-border bg-surface text-right text-xs font-bold uppercase tracking-wide text-slate-muted">
                  <th className="px-4 py-3">التاريخ</th>
                  <th className="px-4 py-3">المراجع</th>
                  <th className="px-4 py-3">الطبيب</th>
                  <th className="px-4 py-3">الإجراء</th>
                  <th className="px-4 py-3">مدفوع</th>
                  <th className="px-4 py-3">مُسترجع سابقاً</th>
                  <th className="px-4 py-3">قابل للإرجاع</th>
                  <th className="px-4 py-3">إجراء</th>
                </tr>
              </thead>
              <tbody>
                {sessions.map((row) => (
                  <tr
                    key={row.id}
                    className="border-b border-slate-border transition-colors last:border-b-0 hover:bg-surface"
                  >
                    <td className="px-4 py-3 tabular-nums text-slate-muted">
                      {formatDate(row.operationDate)}
                    </td>
                    <td className="px-4 py-3 font-semibold">
                      <Link
                        href={`/dashboard/patients/${row.patientId}`}
                        className="text-primary-700 hover:underline"
                      >
                        {row.patientName}
                      </Link>
                    </td>
                    <td className="px-4 py-3 text-slate-text">{formatDoctorDisplayName(row.doctorName)}</td>
                    <td className="px-4 py-3 text-slate-muted">{row.operationName}</td>
                    <td className="px-4 py-3 font-semibold tabular-nums text-slate-text">{formatCurrency(row.paidAmount)}</td>
                    <td className="px-4 py-3 tabular-nums text-warning-text">
                      {row.refundedAmount > 0
                        ? formatCurrency(row.refundedAmount)
                        : "—"}
                    </td>
                    <td className="px-4 py-3 font-black tabular-nums text-slate-text">
                      {formatCurrency(row.maxRefundable)}
                    </td>
                    <td className="px-4 py-3">
                      <button
                        type="button"
                        onClick={() => setRefundTarget(row)}
                        className="inline-flex items-center gap-1 rounded-xl border border-warning-border bg-warning px-3 py-1.5 text-xs font-bold text-warning-text transition-all hover:-translate-y-px hover:shadow-soft"
                      >
                        <Undo2 className="h-3.5 w-3.5" />
                        استرجاع
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      <div className="mc-panel">
        <div className="mc-panel-head">
          <h3 className="mc-panel-title">
            <History />
            سجل المرتجعات المنجزة
          </h3>
        </div>
        <div className="overflow-x-auto">
          {history.length === 0 ? (
            <div className="flex flex-col items-center gap-3 px-6 py-10 text-center">
              <span className="mc-icon-tile h-11 w-11 rounded-xl">
                <Undo2 className="h-5 w-5" />
              </span>
              <p className="text-sm text-slate-muted">
                لا توجد مرتجعات مسجّلة بعد
              </p>
            </div>
          ) : (
            <table className="w-full min-w-[560px] text-sm">
              <thead>
                <tr className="border-b border-slate-border bg-surface text-right text-xs font-bold uppercase tracking-wide text-slate-muted">
                  <th className="px-4 py-3">التاريخ</th>
                  <th className="px-4 py-3">المراجع</th>
                  <th className="px-4 py-3">الطبيب</th>
                  <th className="px-4 py-3">المبلغ</th>
                  <th className="px-4 py-3">السبب</th>
                  <th className="px-4 py-3">الحالة</th>
                </tr>
              </thead>
              <tbody>
                {history.map((row) => (
                  <tr
                    key={row.id}
                    className="border-b border-slate-border transition-colors last:border-b-0 hover:bg-surface"
                  >
                    <td className="whitespace-nowrap px-4 py-3 tabular-nums text-slate-muted">
                      {formatDate(row.createdAt)}
                    </td>
                    <td className="px-4 py-3 font-semibold text-slate-text">{row.patientName}</td>
                    <td className="px-4 py-3 text-slate-text">{formatDoctorDisplayName(row.doctorName)}</td>
                    <td className="px-4 py-3 font-bold tabular-nums text-warning-text">
                      {formatCurrency(row.amount)}
                    </td>
                    <td className="max-w-[200px] truncate px-4 py-3 text-slate-muted">
                      {row.reason}
                    </td>
                    <td className="px-4 py-3">
                      <span className="inline-flex items-center gap-1 rounded-full border border-success-border bg-success px-2.5 py-0.5 text-xs font-semibold text-success-text">
                        <CheckCircle2 className="h-3.5 w-3.5" />
                        تم الإرجاع
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>

      {refundTarget && (
        <SessionRefundModal
          operation={stubOp(refundTarget)}
          maxRefundable={refundTarget.maxRefundable}
          open={!!refundTarget}
          onClose={() => setRefundTarget(null)}
          onSaved={handleRefundSaved}
          patientName={refundTarget.patientName}
          doctorName={formatDoctorDisplayName(refundTarget.doctorName)}
        />
      )}
    </div>
  );
}
