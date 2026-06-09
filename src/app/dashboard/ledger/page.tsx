"use client";

import { Suspense, useState, useEffect, useCallback } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import { QuickEntryForm } from "@/components/accountant/QuickEntryForm";
import { DataTable, type Column } from "@/components/ui/DataTable";
import { Alert } from "@/components/ui/Alert";
import { formatCurrency, formatDate } from "@/lib/utils";
import { formatDoctorDisplayName } from "@/lib/services/clinic-profile";
import { createClient } from "@/lib/supabase/client";
import { useActiveClinicId } from "@/hooks/useActiveClinicId";
import { useClinicSync } from "@/hooks/useClinicSync";
import { ensureAppointmentPatientClient } from "@/lib/services/ensure-appointment-patient-client";
import { fetchPatientTreatmentCases } from "@/lib/services/patient-treatment-cases";
import { getPatientDisplayPhone } from "@/lib/phone";
import { opName, opDebt, type PatientOperation } from "@/types";
import type { PatientTreatmentCase } from "@/lib/services/patient-treatment-cases";
import { RefreshCw } from "lucide-react";

type RowWithJoins = PatientOperation & {
  patient?: { full_name_ar: string };
  doctor?: { full_name_ar: string };
};

interface LedgerPatientContext {
  patientId: string;
  patientName: string;
  patientPhone?: string;
  doctorId?: string;
  doctorName?: string;
  treatmentCases: PatientTreatmentCase[];
}

function LedgerPageContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const patientIdParam =
    searchParams.get("patient_id") ?? searchParams.get("patient") ?? undefined;
  const appointmentIdParam = searchParams.get("appointment_id") ?? undefined;
  const doctorIdParam = searchParams.get("doctor_id") ?? undefined;
  const presetCaseId = searchParams.get("case") ?? undefined;

  const { clinicId, loading: clinicLoading } = useActiveClinicId();
  const [operations, setOperations] = useState<RowWithJoins[]>([]);
  const [loading, setLoading] = useState(true);
  const [patientContext, setPatientContext] = useState<LedgerPatientContext | null>(
    null
  );
  const [contextLoading, setContextLoading] = useState(
    () => !!(patientIdParam || appointmentIdParam)
  );
  const [contextError, setContextError] = useState<string | null>(null);

  const loadOperations = useCallback(async () => {
    if (!clinicId) {
      setOperations([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    const supabase = createClient();

    const todayStart = new Date();
    todayStart.setHours(0, 0, 0, 0);
    const todayEnd = new Date();
    todayEnd.setHours(23, 59, 59, 999);

    let { data } = await supabase
      .from("patient_operations")
      .select(
        "*, patient:patients!patient_id(full_name_ar), doctor:doctors!doctor_id(full_name_ar)"
      )
      .eq("clinic_id", clinicId)
      .gte("operation_date", todayStart.toISOString().split("T")[0])
      .lte("operation_date", todayEnd.toISOString().split("T")[0])
      .order("created_at", { ascending: false })
      .limit(100);

    if (!data || data.length === 0) {
      const fallback = await supabase
        .from("patient_operations")
        .select(
          "*, patient:patients!patient_id(full_name_ar), doctor:doctors!doctor_id(full_name_ar)"
        )
        .eq("clinic_id", clinicId)
        .gte("created_at", todayStart.toISOString())
        .lte("created_at", todayEnd.toISOString())
        .order("created_at", { ascending: false })
        .limit(100);
      data = fallback.data;
    }

    setOperations((data as RowWithJoins[]) || []);
    setLoading(false);
  }, [clinicId]);

  useEffect(() => {
    if (clinicLoading) return;
    loadOperations();
  }, [loadOperations, clinicLoading]);

  useClinicSync({
    topics: ["sessions", "all"],
    clinicId,
    onRefresh: loadOperations,
    enabled: !clinicLoading && !!clinicId,
  });

  useEffect(() => {
    if (clinicLoading || !clinicId) return;

    let cancelled = false;

    async function resolvePatientContext() {
      if (!patientIdParam && !appointmentIdParam) {
        setPatientContext(null);
        setContextLoading(false);
        setContextError(null);
        return;
      }

      setContextLoading(true);
      setContextError(null);

      try {
        const supabase = createClient();
        let resolvedPatientId = patientIdParam;
        let patientName = "";
        let patientPhone: string | undefined;
        let doctorId = doctorIdParam ?? undefined;
        let doctorName: string | undefined;

        if (appointmentIdParam) {
          const apptCtx = await ensureAppointmentPatientClient(
            supabase,
            appointmentIdParam,
            clinicId
          );
          resolvedPatientId = resolvedPatientId ?? apptCtx.patientId;
          patientName = patientName || apptCtx.patientName;
          patientPhone = patientPhone ?? apptCtx.patientPhone ?? undefined;
          doctorId = doctorId ?? apptCtx.doctorId;
          doctorName = doctorName ?? apptCtx.doctorName;
        }

        if (!resolvedPatientId) {
          throw new Error("معرّف المريض غير متوفر");
        }

        if (!patientName) {
          const { data: patient } = await supabase
            .from("patients")
            .select("full_name_ar, phone, phone_number")
            .eq("id", resolvedPatientId)
            .eq("clinic_id", clinicId)
            .maybeSingle();

          if (!patient) {
            throw new Error("المريض غير موجود في هذه العيادة");
          }

          patientName = patient.full_name_ar as string;
          patientPhone =
            patientPhone ?? getPatientDisplayPhone(patient) ?? undefined;
        }

        if (doctorId && !doctorName) {
          const { data: doc } = await supabase
            .from("doctors")
            .select("full_name_ar")
            .eq("id", doctorId)
            .eq("clinic_id", clinicId)
            .maybeSingle();
          doctorName = doc?.full_name_ar as string | undefined;
        }

        const cases = await fetchPatientTreatmentCases(
          supabase,
          resolvedPatientId,
          clinicId
        );

        if (cancelled) return;

        setPatientContext({
          patientId: resolvedPatientId,
          patientName,
          patientPhone,
          doctorId,
          doctorName,
          treatmentCases: cases,
        });
      } catch (err) {
        if (!cancelled) {
          setPatientContext(null);
          setContextError(
            err instanceof Error ? err.message : "تعذر تحميل بيانات المريض"
          );
        }
      } finally {
        if (!cancelled) setContextLoading(false);
      }
    }

    void resolvePatientContext();
    return () => {
      cancelled = true;
    };
  }, [
    clinicId,
    clinicLoading,
    patientIdParam,
    appointmentIdParam,
    doctorIdParam,
  ]);

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

  const formKey = patientContext
    ? `patient-${patientContext.patientId}-${presetCaseId ?? "default"}`
    : "ledger-default";

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-bold text-slate-text">إدخال جلسة</h2>
        <p className="text-slate-muted">
          إدخال سريع وعمليات اليوم — {formatDate(new Date())}
        </p>
      </div>

      {contextLoading && (
        <div className="flex items-center gap-2 rounded-xl border border-primary/20 bg-primary/5 px-4 py-3 text-sm text-primary">
          <RefreshCw className="h-4 w-4 animate-spin" />
          جاري تحميل بيانات المريض والحالات السابقة...
        </div>
      )}

      {contextError && (
        <Alert variant="error">{contextError}</Alert>
      )}

      {patientContext && !contextLoading && (
        <Alert variant="info">
          تم تحميل ملف <strong>{patientContext.patientName}</strong>
          {patientContext.doctorName && (
            <>
              {" "}
              — الطبيب: <strong>{patientContext.doctorName}</strong>
            </>
          )}
          {patientContext.treatmentCases.length > 0
            ? ` — ${patientContext.treatmentCases.length} حالة علاج سابقة`
            : " — مريض جديد بدون حالات سابقة"}
        </Alert>
      )}

      {!contextLoading && !contextError && (
        <QuickEntryForm
          key={formKey}
          defaultPatientId={patientContext?.patientId ?? patientIdParam}
          defaultPatientName={patientContext?.patientName}
          defaultPatientPhone={patientContext?.patientPhone}
          defaultCaseId={presetCaseId}
          prefetchedCases={patientContext?.treatmentCases}
          lockDoctorId={patientContext?.doctorId}
          lockDoctorName={patientContext?.doctorName}
          onSuccess={() => {
            loadOperations();
            router.refresh();
          }}
        />
      )}

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

export default function LedgerPage() {
  return (
    <Suspense
      fallback={
        <div className="flex min-h-[40vh] items-center justify-center">
          <RefreshCw className="h-8 w-8 animate-spin text-primary" />
        </div>
      }
    >
      <LedgerPageContent />
    </Suspense>
  );
}
