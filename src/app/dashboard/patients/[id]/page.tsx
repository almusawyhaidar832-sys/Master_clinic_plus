"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import { Card, CardHeader, CardTitle } from "@/components/ui/Card";
import { DataTable, type Column } from "@/components/ui/DataTable";
import { Button } from "@/components/ui/Button";
import { createClient } from "@/lib/supabase/client";
import { formatCurrency, formatDate } from "@/lib/utils";
import { formatDoctorDisplayName } from "@/lib/services/clinic-profile";
import { useClinicProfile } from "@/contexts/ClinicProfileContext";
import { ClinicBrandingHeader } from "@/components/branding/ClinicBrandingHeader";
import type { Patient, PatientOperation } from "@/types";
import { ArrowRight } from "lucide-react";

export default function PatientProfilePage() {
  const params = useParams();
  const id = params.id as string;
  const { profile } = useClinicProfile();
  const [patient, setPatient] = useState<Patient | null>(null);
  const [operations, setOperations] = useState<PatientOperation[]>([]);

  useEffect(() => {
    async function load() {
      const supabase = createClient();
      const [pRes, oRes] = await Promise.all([
        supabase.from("patients").select("*").eq("id", id).single(),
        supabase
          .from("patient_operations")
          .select("*, doctor:doctors(full_name_ar)")
          .eq("patient_id", id)
          .order("operation_date", { ascending: false }),
      ]);
      if (pRes.data) setPatient(pRes.data as Patient);
      if (oRes.data) setOperations(oRes.data as PatientOperation[]);
    }
    if (id) load();
  }, [id]);

  const totalDebt = operations.reduce((s, o) => s + (o.remaining_debt || 0), 0);
  const totalPaid = operations.reduce((s, o) => s + o.paid_amount, 0);

  const columns: Column<PatientOperation>[] = [
    {
      key: "date",
      header: "التاريخ",
      render: (row) => formatDate(row.operation_date),
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
      key: "remaining",
      header: "المتبقي",
      render: (row) => (
        <span className={row.remaining_debt > 0 ? "text-debt-text font-semibold" : ""}>
          {formatCurrency(row.remaining_debt)}
        </span>
      ),
    },
  ];

  if (!patient) {
    return <p className="text-slate-muted">جاري تحميل ملف المريض...</p>;
  }

  return (
    <div className="space-y-6">
      <Link href="/dashboard/ledger">
        <Button variant="ghost" size="sm">
          <ArrowRight className="h-4 w-4" />
          العودة للسجل
        </Button>
      </Link>

      <Card className="overflow-hidden">
        <div className="border-b border-slate-border bg-surface/50 px-4 py-3">
          <ClinicBrandingHeader
            profile={profile}
            size="sm"
            className="border-0 pb-0"
          />
        </div>
        <CardHeader>
          <CardTitle>{patient.full_name_ar}</CardTitle>
          {patient.phone && (
            <p className="text-sm text-slate-muted" dir="ltr">
              {patient.phone}
            </p>
          )}
        </CardHeader>
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-3">
          <div className="rounded-lg bg-surface p-3 text-center">
            <p className="text-lg font-bold text-slate-text">{operations.length}</p>
            <p className="text-xs text-slate-muted">زيارات</p>
          </div>
          <div className="rounded-lg bg-surface p-3 text-center">
            <p className="text-lg font-bold text-primary">{formatCurrency(totalPaid)}</p>
            <p className="text-xs text-slate-muted">إجمالي المدفوع</p>
          </div>
          <div className="rounded-lg bg-debt/50 p-3 text-center col-span-2 sm:col-span-1">
            <p className="text-lg font-bold text-debt-text">{formatCurrency(totalDebt)}</p>
            <p className="text-xs text-slate-muted">ديون متبقية</p>
          </div>
        </div>
      </Card>

      <div>
        <h3 className="mb-3 text-lg font-semibold">سجل الزيارات والمدفوعات</h3>
        <DataTable
          columns={columns}
          data={operations}
          emptyMessage="لا يوجد سجل لهذا المريض"
          highlightDebt={(row) => row.remaining_debt > 0}
        />
      </div>
    </div>
  );
}
