"use client";

import { useState, useEffect, useCallback } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { QuickEntryForm } from "@/components/accountant/QuickEntryForm";
import { DataTable, type Column } from "@/components/ui/DataTable";
import { formatCurrency, formatDate } from "@/lib/utils";
import { formatDoctorDisplayName } from "@/lib/services/clinic-profile";
import { createClient } from "@/lib/supabase/client";
import { opName, opDebt, type PatientOperation } from "@/types";

type RowWithJoins = PatientOperation & {
  patient?: { full_name_ar: string };
  doctor?: { full_name_ar: string };
};

export default function LedgerPage() {
  const router = useRouter();
  const [operations, setOperations] = useState<RowWithJoins[]>([]);
  const [loading, setLoading] = useState(true);

  const loadOperations = useCallback(async () => {
    setLoading(true);
    const supabase = createClient();

    // Build today's date range for created_at filter (works even without operation_date column)
    const todayStart = new Date();
    todayStart.setHours(0, 0, 0, 0);
    const todayEnd = new Date();
    todayEnd.setHours(23, 59, 59, 999);

    // Try with operation_date first, fall back to created_at
    let { data } = await supabase
      .from("patient_operations")
      .select(
        "*, patient:patients!patient_id(full_name_ar), doctor:doctors!doctor_id(full_name_ar)"
      )
      .gte("operation_date", todayStart.toISOString().split("T")[0])
      .lte("operation_date", todayEnd.toISOString().split("T")[0])
      .order("created_at", { ascending: false })
      .limit(100);

    // Fallback: if operation_date doesn't exist, query by created_at
    if (!data || data.length === 0) {
      const fallback = await supabase
        .from("patient_operations")
        .select(
          "*, patient:patients!patient_id(full_name_ar), doctor:doctors!doctor_id(full_name_ar)"
        )
        .gte("created_at", todayStart.toISOString())
        .lte("created_at", todayEnd.toISOString())
        .order("created_at", { ascending: false })
        .limit(100);
      data = fallback.data;
    }

    setOperations((data as RowWithJoins[]) || []);
    setLoading(false);
  }, []);

  useEffect(() => {
    loadOperations();
  }, [loadOperations]);

  const columns: Column<RowWithJoins>[] = [
    {
      key: "patient",
      header: "المريض",
      render: (row) => row.patient?.full_name_ar || "—",
    },
    {
      key: "doctor",
      header: "الطبيب",
      render: (row) => formatDoctorDisplayName(row.doctor?.full_name_ar),
    },
    {
      key: "operation",
      header: "العملية / الإجراء",
      render: (row) => (
        <span className="font-medium">{opName(row)}</span>
      ),
    },
    {
      key: "total",
      header: "الإجمالي",
      render: (row) => formatCurrency(row.total_amount),
    },
    {
      key: "paid",
      header: "المدفوع",
      render: (row) => (
        <span className="text-primary font-medium">
          {formatCurrency(row.paid_amount)}
        </span>
      ),
    },
    {
      key: "remaining",
      header: "المتبقي",
      render: (row) => {
        const debt = opDebt(row);
        return (
          <span className={debt > 0 ? "font-semibold text-debt-text" : "text-slate-muted"}>
            {formatCurrency(debt)}
          </span>
        );
      },
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
        <h2 className="text-2xl font-bold text-slate-text">إدخال جلسة</h2>
        <p className="text-slate-muted">
          إدخال سريع وعمليات اليوم — {formatDate(new Date())}
        </p>
      </div>

      <QuickEntryForm
        onSuccess={() => {
          loadOperations();
          router.refresh(); // Revalidate Next.js page cache
        }}
      />

      <div>
        <h3 className="mb-3 text-lg font-semibold text-slate-text">
          جلسات اليوم
          {!loading && operations.length > 0 && (
            <span className="mr-2 text-sm font-normal text-slate-muted">
              ({operations.length} جلسة)
            </span>
          )}
        </h3>
        {loading ? (
          <div className="space-y-2">
            {[1, 2, 3].map((i) => (
              <div key={i} className="h-12 animate-pulse rounded bg-slate-100" />
            ))}
          </div>
        ) : (
          <DataTable
            columns={columns}
            data={operations}
            emptyMessage="لا توجد جلسات مسجّلة اليوم"
            highlightDebt={(row) => opDebt(row) > 0}
          />
        )}
      </div>
    </div>
  );
}
