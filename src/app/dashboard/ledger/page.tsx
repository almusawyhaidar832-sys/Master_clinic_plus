"use client";

import { useState, useEffect, useCallback } from "react";
import Link from "next/link";
import { QuickEntryForm } from "@/components/accountant/QuickEntryForm";
import { DataTable, type Column } from "@/components/ui/DataTable";
import { formatCurrency, formatDate } from "@/lib/utils";
import { formatDoctorDisplayName } from "@/lib/services/clinic-profile";
import { createClient } from "@/lib/supabase/client";
import type { PatientOperation } from "@/types";

export default function LedgerPage() {
  const [operations, setOperations] = useState<PatientOperation[]>([]);
  const [loading, setLoading] = useState(true);

  const loadOperations = useCallback(async () => {
    const supabase = createClient();
    const today = new Date().toISOString().split("T")[0];
    const { data } = await supabase
      .from("patient_operations")
      .select("*, patient:patients(full_name_ar), doctor:doctors(full_name_ar)")
      .eq("operation_date", today)
      .order("created_at", { ascending: false });

    setOperations((data as PatientOperation[]) || []);
    setLoading(false);
  }, []);

  useEffect(() => {
    loadOperations();
  }, [loadOperations]);

  const columns: Column<PatientOperation>[] = [
    {
      key: "patient",
      header: "المريض",
      render: (row) =>
        (row as PatientOperation & { patient?: { full_name_ar: string } }).patient
          ?.full_name_ar || "—",
    },
    {
      key: "doctor",
      header: "الطبيب",
      render: (row) =>
        formatDoctorDisplayName(
          (row as PatientOperation & { doctor?: { full_name_ar: string } })
            .doctor?.full_name_ar
        ),
    },
    {
      key: "operation",
      header: "العملية",
      render: (row) => row.operation_name_ar,
    },
    {
      key: "total",
      header: "الإجمالي",
      render: (row) => formatCurrency(row.total_amount),
    },
    {
      key: "paid",
      header: "المدفوع",
      render: (row) => formatCurrency(row.paid_amount),
    },
    {
      key: "remaining_debt",
      header: "المتبقي",
      render: (row) => (
        <span className={row.remaining_debt > 0 ? "text-debt-text font-semibold" : ""}>
          {formatCurrency(row.remaining_debt)}
        </span>
      ),
    },
    {
      key: "profile",
      header: "",
      render: (row) => (
        <Link
          href={`/dashboard/patients/${row.patient_id}`}
          className="text-primary text-xs hover:underline"
        >
          الملف
        </Link>
      ),
    },
  ];

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-bold text-slate-text">سجل المرضى</h2>
        <p className="text-slate-muted">إدخال سريع وعمليات اليوم — {formatDate(new Date())}</p>
      </div>

      <QuickEntryForm onSuccess={() => loadOperations()} />

      <div>
        <h3 className="mb-3 text-lg font-semibold text-slate-text">عمليات اليوم</h3>
        {loading ? (
          <p className="text-slate-muted">جاري التحميل...</p>
        ) : (
          <DataTable
            columns={columns}
            data={operations}
            emptyMessage="لا توجد عمليات مسجلة اليوم"
            highlightDebt={(row) => row.remaining_debt > 0}
          />
        )}
      </div>
    </div>
  );
}
