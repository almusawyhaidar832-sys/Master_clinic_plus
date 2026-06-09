"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { Card, CardHeader, CardTitle } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { Select } from "@/components/ui/Select";
import { Alert } from "@/components/ui/Alert";
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
import { formatCurrency, formatDate } from "@/lib/utils";
import type { Doctor, PatientOperation } from "@/types";
import { CheckCircle2, Search, Undo2, User, Stethoscope } from "lucide-react";
import { useClinicSync } from "@/hooks/useClinicSync";
import { useActiveClinicId } from "@/hooks/useActiveClinicId";

type SearchMode = "patient" | "doctor";

export default function RefundsDashboardPage() {
  const { clinicId } = useActiveClinicId();
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
    topics: ["refunds", "all"],
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
    <div className="mx-auto max-w-5xl space-y-6 p-4 sm:p-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="flex items-center gap-2 text-xl font-bold text-slate-text sm:text-2xl">
            <Undo2 className="h-7 w-7 text-primary" />
            إدارة المرتجعات
          </h1>
          <p className="mt-1 text-sm text-slate-muted">
            ابحث عن المراجع أو الطبيب، اختر الجلسة، وسجّل الإرجاع مع تتبّع كامل
          </p>
        </div>
        <Link
          href="/dashboard/reports"
          className="text-sm font-semibold text-primary underline"
        >
          سجل المرتجعات في التقارير
        </Link>
      </div>

      {success && (
        <Alert variant="success" className="flex items-center gap-2">
          <CheckCircle2 className="h-5 w-5 shrink-0" />
          {success}
        </Alert>
      )}
      {message && <Alert variant="warning">{message}</Alert>}

      <Card>
        <CardHeader>
          <CardTitle>بحث جلسة للإرجاع</CardTitle>
        </CardHeader>
        <div className="space-y-4 px-4 pb-4">
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => setMode("patient")}
              className={`flex items-center gap-1.5 rounded-lg border px-3 py-2 text-sm font-semibold transition-colors ${
                mode === "patient"
                  ? "border-primary bg-primary/10 text-primary"
                  : "border-slate-border text-slate-muted hover:bg-surface"
              }`}
            >
              <User className="h-4 w-4" />
              بالمراجع
            </button>
            <button
              type="button"
              onClick={() => setMode("doctor")}
              className={`flex items-center gap-1.5 rounded-lg border px-3 py-2 text-sm font-semibold transition-colors ${
                mode === "doctor"
                  ? "border-primary bg-primary/10 text-primary"
                  : "border-slate-border text-slate-muted hover:bg-surface"
              }`}
            >
              <Stethoscope className="h-4 w-4" />
              بالطبيب
            </button>
          </div>

          {mode === "patient" ? (
            <div className="flex flex-col gap-2 sm:flex-row sm:items-end">
              <div className="min-w-0 flex-1">
                <p className="mb-1 text-xs font-medium text-slate-muted">
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
              <Button
                onClick={() => searchSessions()}
                disabled={loading || !selectedPatientId}
              >
                <Search className="h-4 w-4" />
                عرض الجلسات
              </Button>
            </div>
          ) : (
            <div className="flex flex-col gap-2 sm:flex-row sm:items-end">
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
              <Button onClick={searchSessions} disabled={loading}>
                <Search className="h-4 w-4" />
                عرض الجلسات
              </Button>
            </div>
          )}
        </div>
      </Card>

      {searched && sessions.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>جلسات قابلة للإرجاع ({sessions.length})</CardTitle>
          </CardHeader>
          <div className="overflow-x-auto px-2 pb-4">
            <table className="w-full min-w-[640px] text-sm">
              <thead>
                <tr className="border-b text-right text-xs text-slate-muted">
                  <th className="py-2 pr-2">التاريخ</th>
                  <th className="py-2">المراجع</th>
                  <th className="py-2">الطبيب</th>
                  <th className="py-2">الإجراء</th>
                  <th className="py-2">مدفوع</th>
                  <th className="py-2">مُسترجع سابقاً</th>
                  <th className="py-2">قابل للإرجاع</th>
                  <th className="py-2">إجراء</th>
                </tr>
              </thead>
              <tbody>
                {sessions.map((row) => (
                  <tr
                    key={row.id}
                    className="border-b border-slate-border/50 hover:bg-surface/50"
                  >
                    <td className="py-2 pr-2 tabular-nums">
                      {formatDate(row.operationDate)}
                    </td>
                    <td className="py-2 font-medium">
                      <Link
                        href={`/dashboard/patients/${row.patientId}`}
                        className="text-primary hover:underline"
                      >
                        {row.patientName}
                      </Link>
                    </td>
                    <td className="py-2">{formatDoctorDisplayName(row.doctorName)}</td>
                    <td className="py-2 text-slate-muted">{row.operationName}</td>
                    <td className="py-2 tabular-nums">{formatCurrency(row.paidAmount)}</td>
                    <td className="py-2 tabular-nums text-amber-700">
                      {row.refundedAmount > 0
                        ? formatCurrency(row.refundedAmount)
                        : "—"}
                    </td>
                    <td className="py-2 font-semibold tabular-nums text-primary">
                      {formatCurrency(row.maxRefundable)}
                    </td>
                    <td className="py-2">
                      <button
                        type="button"
                        onClick={() => setRefundTarget(row)}
                        className="rounded-lg border border-amber-300 bg-amber-50 px-2.5 py-1 text-xs font-bold text-amber-800 hover:bg-amber-100"
                      >
                        استرجاع
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}

      <Card>
        <CardHeader>
          <CardTitle>سجل المرتجعات المنجزة</CardTitle>
        </CardHeader>
        <div className="overflow-x-auto px-2 pb-4">
          {history.length === 0 ? (
            <p className="px-2 pb-4 text-sm text-slate-muted">
              لا توجد مرتجعات مسجّلة بعد
            </p>
          ) : (
            <table className="w-full min-w-[560px] text-sm">
              <thead>
                <tr className="border-b text-right text-xs text-slate-muted">
                  <th className="py-2 pr-2">التاريخ</th>
                  <th className="py-2">المراجع</th>
                  <th className="py-2">الطبيب</th>
                  <th className="py-2">المبلغ</th>
                  <th className="py-2">السبب</th>
                  <th className="py-2">الحالة</th>
                </tr>
              </thead>
              <tbody>
                {history.map((row) => (
                  <tr
                    key={row.id}
                    className="border-b border-slate-border/50"
                  >
                    <td className="py-2 pr-2 tabular-nums whitespace-nowrap">
                      {formatDate(row.createdAt)}
                    </td>
                    <td className="py-2 font-medium">{row.patientName}</td>
                    <td className="py-2">{formatDoctorDisplayName(row.doctorName)}</td>
                    <td className="py-2 font-bold tabular-nums text-amber-700">
                      {formatCurrency(row.amount)}
                    </td>
                    <td className="py-2 max-w-[200px] truncate text-slate-muted">
                      {row.reason}
                    </td>
                    <td className="py-2">
                      <span className="inline-flex items-center gap-1 rounded-full bg-emerald-50 px-2 py-0.5 text-xs font-semibold text-emerald-700">
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
      </Card>

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
