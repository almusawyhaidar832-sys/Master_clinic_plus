"use client";

import { useCallback, useEffect, useState } from "react";
import { Input } from "@/components/ui/Input";
import { Select } from "@/components/ui/Select";
import { DataTable, type Column } from "@/components/ui/DataTable";
import { Alert } from "@/components/ui/Alert";
import { authPortalHeaders } from "@/lib/auth/api-portal";
import { cn, formatCurrency, formatDate } from "@/lib/utils";
import type { InvoiceHistoryRow } from "@/lib/services/invoice-archive";
import {
  hasLabDetails,
  labDetailsFromSnapshot,
  labSplitFromHistoryRow,
  truncateLabNotes,
} from "@/lib/invoices/lab-session-details";
import {
  canResendHistoryInvoice,
  historyRowFinancials,
  sessionInvoiceFromHistoryRow,
} from "@/lib/invoices/session-invoice";
import type { SessionInvoiceData } from "@/lib/invoices/session-invoice";
import { SessionInvoiceModal } from "@/components/invoices/SessionInvoiceModal";
import { useClinicProfile } from "@/contexts/ClinicProfileContext";
import { createClient } from "@/lib/supabase/client";
import { getPatientDisplayPhone } from "@/lib/phone";
import { History, MessageCircle, RefreshCw } from "lucide-react";

function historyPatientLabel(row: InvoiceHistoryRow): string {
  if (row.record_kind === "doctor_expense" || row.doctor_expense_id) {
    return "صرفية عيادة";
  }
  return String(row.patient_name_ar ?? "").trim() || "مراجع";
}

function historyLabDetails(row: InvoiceHistoryRow) {
  return labDetailsFromSnapshot(row.snapshot_json);
}

interface DoctorOption {
  id: string;
  full_name_ar: string;
}

interface InvoiceHistoryPanelProps {
  clinicId: string | null;
  doctors: DoctorOption[];
  refreshKey?: number;
}

export function InvoiceHistoryPanel({
  clinicId,
  doctors,
  refreshKey = 0,
}: InvoiceHistoryPanelProps) {
  const supabase = createClient();
  const { profile: clinicProfile } = useClinicProfile();
  const [doctorId, setDoctorId] = useState("");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [rows, setRows] = useState<InvoiceHistoryRow[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [resendNotice, setResendNotice] = useState<string | null>(null);
  const [resendInvoice, setResendInvoice] = useState<SessionInvoiceData | null>(
    null
  );

  const load = useCallback(async () => {
    if (!clinicId) {
      setRows([]);
      setTotal(0);
      return;
    }

    setLoading(true);
    setError("");

    const params = new URLSearchParams({ limit: "100" });
    if (doctorId) params.set("doctor_id", doctorId);
    if (dateFrom) params.set("date_from", dateFrom);
    if (dateTo) params.set("date_to", dateTo);

    try {
      const res = await fetch(`/api/invoices/history?${params}`, {
        credentials: "include",
        headers: authPortalHeaders("accountant"),
      });
      const json = (await res.json()) as {
        rows?: InvoiceHistoryRow[];
        total?: number;
        error?: string;
      };

      if (!res.ok) {
        setError(json.error ?? "تعذر تحميل السجل");
        setRows([]);
        setTotal(0);
        return;
      }

      setRows(json.rows ?? []);
      setTotal(json.total ?? 0);
    } catch {
      setError("تعذر الاتصال بالسيرفر");
    } finally {
      setLoading(false);
    }
  }, [clinicId, doctorId, dateFrom, dateTo]);

  useEffect(() => {
    void load();
  }, [load, refreshKey]);

  async function openResendModal(row: InvoiceHistoryRow) {
    setResendNotice(null);

    let operationId = row.operation_id;
    if (!operationId && row.invoice_id && clinicId) {
      const { data: invoice } = await supabase
        .from("invoices")
        .select("operation_id")
        .eq("id", row.invoice_id)
        .eq("clinic_id", clinicId)
        .maybeSingle();
      operationId = (invoice as { operation_id?: string } | null)?.operation_id ?? null;
    }

    const data = sessionInvoiceFromHistoryRow(
      { ...row, operation_id: operationId },
      clinicProfile ?? null
    );

    if (!data) {
      setResendNotice("تعذر فتح إعادة الإرسال — السجل ناقص أو غير مرتبط بجلسة");
      return;
    }

    let patientPhone = data.patientPhone;
    if (!patientPhone?.trim() && row.patient_id && clinicId) {
      const { data: patient } = await supabase
        .from("patients")
        .select("phone, phone_number")
        .eq("id", row.patient_id)
        .eq("clinic_id", clinicId)
        .maybeSingle();
      patientPhone = getPatientDisplayPhone(patient ?? {}) || null;
    }

    if (!patientPhone?.trim()) {
      setResendNotice(
        `لا يوجد رقم جوال لـ «${data.patientName}» — أضف الرقم في ملف المريض ثم أعد المحاولة`
      );
      return;
    }

    setResendInvoice({ ...data, patientPhone, operationId: data.operationId });
  }

  const columns: Column<InvoiceHistoryRow>[] = [
    {
      key: "date",
      header: "التاريخ",
      render: (row) => formatDate(row.invoice_date),
    },
    {
      key: "patient",
      header: "المراجع",
      render: (row) => (
        <span className="min-w-[6rem] font-medium text-slate-800">
          {historyPatientLabel(row)}
        </span>
      ),
    },
    {
      key: "case",
      header: "الحالة",
      render: (row) => {
        const fin = historyRowFinancials(row);
        if (!fin) return <span className="text-slate-400">—</span>;
        return (
          <div className="min-w-[7rem]">
            <p className="font-semibold text-slate-text">{fin.treatmentName}</p>
            <p className="mt-0.5 text-xs text-slate-muted">{row.procedure_label}</p>
          </div>
        );
      },
    },
    {
      key: "doctor",
      header: "الطبيب",
      render: (row) => row.doctor_name_ar || "—",
    },
    {
      key: "paid_session",
      header: "دفع الجلسة",
      render: (row) => {
        const fin = historyRowFinancials(row);
        if (!fin) return <span className="text-slate-400">—</span>;
        return (
          <span
            className={
              fin.paidSession > 0
                ? "font-bold tabular-nums text-emerald-700"
                : "tabular-nums text-slate-muted"
            }
          >
            {formatCurrency(fin.paidSession)}
          </span>
        );
      },
    },
    {
      key: "case_total",
      header: "إجمالي الحالة",
      render: (row) => {
        const fin = historyRowFinancials(row);
        if (!fin || fin.caseTotal <= 0) {
          return <span className="text-slate-400">—</span>;
        }
        return (
          <span className="tabular-nums font-medium text-slate-700">
            {formatCurrency(fin.caseTotal)}
          </span>
        );
      },
    },
    {
      key: "case_paid",
      header: "مدفوع الحالة",
      render: (row) => {
        const fin = historyRowFinancials(row);
        if (!fin || fin.casePaid <= 0) {
          return <span className="text-slate-400">—</span>;
        }
        return (
          <span className="tabular-nums font-semibold text-primary">
            {formatCurrency(fin.casePaid)}
          </span>
        );
      },
    },
    {
      key: "remaining",
      header: "المتبقي",
      render: (row) => {
        const fin = historyRowFinancials(row);
        if (!fin) return <span className="text-slate-400">—</span>;
        return (
          <span
            className={
              fin.remaining > 0
                ? "font-bold tabular-nums text-debt-text"
                : "font-semibold tabular-nums text-emerald-700"
            }
          >
            {formatCurrency(fin.remaining)}
          </span>
        );
      },
    },
    {
      key: "actions",
      header: "إعادة إرسال",
      render: (row) => {
        if (!canResendHistoryInvoice(row)) {
          return <span className="text-slate-400">—</span>;
        }
        return (
          <button
            type="button"
            onClick={() => void openResendModal(row)}
            className="inline-flex items-center gap-1.5 rounded-lg bg-[#25D366] px-3 py-1.5 text-xs font-bold text-white shadow-sm hover:bg-[#1da851]"
            title="إعادة إرسال الفاتورة والوصفة للمراجع على واتساب"
          >
            <MessageCircle className="h-3.5 w-3.5" />
            واتساب
          </button>
        );
      },
    },
    {
      key: "invoice",
      header: "رقم الفاتورة",
      render: (row) => (
        <span className="font-mono text-xs" dir="ltr">
          {row.invoice_number}
        </span>
      ),
    },
    {
      key: "type",
      header: "النوع",
      render: (row) =>
        row.record_kind === "doctor_expense" ? (
          <span className="rounded-full bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-800">
            صرفية عيادة
          </span>
        ) : (
          <span className="rounded-full bg-primary/10 px-2 py-0.5 text-xs font-medium text-primary">
            جلسة
          </span>
        ),
    },
    {
      key: "lab_cost",
      header: "تكلفة المختبر",
      render: (row) => {
        const lab = historyLabDetails(row);
        const split = labSplitFromHistoryRow(row);
        const cost = split?.materialsCost ?? lab.materialsCost;
        if (!cost) return <span className="text-slate-400">—</span>;
        return (
          <span className="tabular-nums text-amber-800">
            {formatCurrency(cost)}
          </span>
        );
      },
    },
    {
      key: "lab_doctor_share",
      header: "تحمّل الطبيب",
      render: (row) => {
        const split = labSplitFromHistoryRow(row);
        if (!split?.doctorShare) {
          return <span className="text-slate-400">—</span>;
        }
        return (
          <span
            className="tabular-nums font-semibold text-red-600"
            title={
              split.materialsSharePct > 0
                ? `${split.materialsSharePct}% من تكلفة المختبر`
                : undefined
            }
          >
            {formatCurrency(split.doctorShare)}
          </span>
        );
      },
    },
    {
      key: "lab_clinic_share",
      header: "تحمّل العيادة",
      render: (row) => {
        const split = labSplitFromHistoryRow(row);
        if (!split?.clinicShare) {
          return <span className="text-slate-400">—</span>;
        }
        return (
          <span
            className="tabular-nums font-semibold text-slate-800"
            title={
              split.materialsSharePct > 0
                ? `${100 - split.materialsSharePct}% من تكلفة المختبر`
                : undefined
            }
          >
            {formatCurrency(split.clinicShare)}
          </span>
        );
      },
    },
    {
      key: "lab_notes",
      header: "ملاحظات المختبر",
      render: (row) => {
        const lab = historyLabDetails(row);
        if (!hasLabDetails(lab) || !lab.labNotes) {
          return <span className="text-slate-400">—</span>;
        }
        return (
          <span
            className="max-w-[12rem] truncate text-xs text-slate-600"
            title={lab.labNotes}
          >
            {truncateLabNotes(lab.labNotes, 56)}
          </span>
        );
      },
    },
    {
      key: "doctor_share",
      header: "حصة الطبيب",
      render: (row) => {
        if (row.record_kind === "doctor_expense") {
          return <span className="text-slate-400">—</span>;
        }
        const snap = row.snapshot_json as {
          doctorShareTotal?: number;
        } | null;
        const share =
          row.doctor_share > 0
            ? row.doctor_share
            : Number(snap?.doctorShareTotal ?? 0);
        if (!share) return <span className="text-slate-400">—</span>;
        return (
          <span className="tabular-nums text-emerald-700">
            {formatCurrency(share)}
          </span>
        );
      },
    },
    {
      key: "clinic_share",
      header: "حصة العيادة",
      render: (row) => {
        if (row.record_kind === "doctor_expense") {
          return <span className="text-slate-400">—</span>;
        }
        const snap = row.snapshot_json as {
          clinicShareTotal?: number;
        } | null;
        const share =
          row.clinic_share > 0
            ? row.clinic_share
            : Number(snap?.clinicShareTotal ?? 0);
        if (!share) return <span className="text-slate-400">—</span>;
        return (
          <span className="tabular-nums text-slate-700">
            {formatCurrency(share)}
          </span>
        );
      },
    },
  ];

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h2 className="flex items-center gap-2 text-lg font-bold text-slate-800">
            <History className="h-5 w-5 text-primary" />
            السجل التاريخي
          </h2>
          <p className="text-sm text-slate-500">
            فواتير الجلسات مع المبالغ المدفوعة والمتبقية — إعادة إرسال الفاتورة
            والوصفة للمراجع عبر واتساب
          </p>
        </div>
        <button
          type="button"
          onClick={() => void load()}
          className="flex items-center gap-1 rounded-lg border border-slate-200 px-3 py-1.5 text-sm text-slate-600 hover:bg-slate-50"
        >
          <RefreshCw className={cn("h-4 w-4", loading && "animate-spin")} />
          تحديث
        </button>
      </div>

      <div className="grid gap-3 sm:grid-cols-3">
        <Select
          label="الطبيب"
          name="history_doctor"
          value={doctorId}
          onChange={(e) => setDoctorId(e.target.value)}
          options={[
            { value: "", label: "— كل الأطباء —" },
            ...doctors.map((d) => ({
              value: d.id,
              label: d.full_name_ar,
            })),
          ]}
        />
        <Input
          label="من تاريخ"
          type="date"
          value={dateFrom}
          onChange={(e) => setDateFrom(e.target.value)}
          dir="ltr"
          className="text-left"
        />
        <Input
          label="إلى تاريخ"
          type="date"
          value={dateTo}
          onChange={(e) => setDateTo(e.target.value)}
          dir="ltr"
          className="text-left"
        />
      </div>

      {error && (
        <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-600">
          {error}
        </p>
      )}

      {resendNotice && (
        <Alert variant="warning">{resendNotice}</Alert>
      )}

      <p className="text-sm text-slate-600">
        إجمالي النتائج: <strong>{total}</strong>
      </p>

      {loading ? (
        <div className="flex justify-center py-12">
          <RefreshCw className="h-6 w-6 animate-spin text-primary" />
        </div>
      ) : (
        <DataTable
          columns={columns}
          data={rows}
          emptyMessage={
            doctorId
              ? "لا توجد سجلات لهذا الطبيب في الفترة المحددة"
              : "لا توجد سجلات — أضف فاتورة صرف أو اعتمد فاتورة جلسة"
          }
          highlightDebt={(row) => (historyRowFinancials(row)?.remaining ?? 0) > 0}
        />
      )}

      {resendInvoice && (
        <SessionInvoiceModal
          data={resendInvoice}
          invoiceId={resendInvoice.invoiceId}
          archivedHistory
          onClose={() => {
            setResendInvoice(null);
          }}
        />
      )}
    </div>
  );
}
