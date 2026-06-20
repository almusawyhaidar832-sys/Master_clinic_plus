"use client";

import { useCallback, useEffect, useState } from "react";
import { Input } from "@/components/ui/Input";
import { Select } from "@/components/ui/Select";
import { DataTable, type Column } from "@/components/ui/DataTable";
import { authPortalHeaders } from "@/lib/auth/api-portal";
import { cn, formatCurrency, formatDate } from "@/lib/utils";
import type { InvoiceHistoryRow } from "@/lib/services/invoice-archive";
import {
  hasLabDetails,
  labDetailsFromSnapshot,
  labSplitFromHistoryRow,
  truncateLabNotes,
} from "@/lib/invoices/lab-session-details";
import { sessionInvoiceFromHistoryRow } from "@/lib/invoices/session-invoice";
import type { SessionInvoiceData } from "@/lib/invoices/session-invoice";
import { SessionInvoiceModal } from "@/components/invoices/SessionInvoiceModal";
import { useClinicProfile } from "@/contexts/ClinicProfileContext";
import { createClient } from "@/lib/supabase/client";
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
    const data = sessionInvoiceFromHistoryRow(row, clinicProfile ?? null);
    if (!data) return;

    let patientPhone = data.patientPhone;
    if (!patientPhone?.trim() && row.patient_id && clinicId) {
      const { data: patient } = await supabase
        .from("patients")
        .select("phone")
        .eq("id", row.patient_id)
        .eq("clinic_id", clinicId)
        .maybeSingle();
      patientPhone = (patient as { phone?: string } | null)?.phone ?? null;
    }

    setResendInvoice({ ...data, patientPhone });
  }

  const columns: Column<InvoiceHistoryRow>[] = [
    {
      key: "date",
      header: "التاريخ",
      render: (row) => formatDate(row.invoice_date),
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
      key: "doctor",
      header: "الطبيب",
      render: (row) => row.doctor_name_ar || "—",
    },
    {
      key: "patient",
      header: "المراجع",
      render: (row) => (
        <span className="font-medium text-slate-800">
          {historyPatientLabel(row)}
        </span>
      ),
    },
    {
      key: "procedure",
      header: "البيان",
      render: (row) => (
        <span className="text-slate-700">{row.procedure_label}</span>
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
      key: "paid",
      header: "المبلغ المدفوع",
      render: (row) => (
        <span className="font-bold text-primary tabular-nums">
          {formatCurrency(row.paid_amount)}
        </span>
      ),
    },
    {
      key: "doctor_share",
      header: "حصة الطبيب (جلسة)",
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
      header: "حصة العيادة (جلسة)",
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
    {
      key: "actions",
      header: "إرسال",
      render: (row) => {
        if (row.record_kind === "doctor_expense" || row.doctor_expense_id) {
          return <span className="text-slate-400">—</span>;
        }
        return (
          <button
            type="button"
            onClick={() => void openResendModal(row)}
            className="inline-flex items-center gap-1 rounded-lg border border-[#25D366]/30 bg-[#25D366]/10 px-2.5 py-1 text-xs font-semibold text-[#128C7E] hover:bg-[#25D366]/20"
            title="إعادة إرسال الفاتورة والوصفة على واتساب"
          >
            <MessageCircle className="h-3.5 w-3.5" />
            واتساب
          </button>
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
            فواتير الجلسات + فواتير وصرفيات الأطباء + رواتب الأطباء — فلترة حسب الطبيب
            والتاريخ
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
