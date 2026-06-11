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
import { authPortalHeaders } from "@/lib/auth/api-portal";
import { buildLedgerPayUrl } from "@/lib/ledger/navigation";
import {
  fetchTodayLedgerOperations,
  ledgerDisplayRemaining,
  type TodayOperationRow,
} from "@/lib/ledger/today-operations";
import { notifyQueueRefresh } from "@/lib/queue/queue-refresh";
import { ensureAppointmentPatientClient } from "@/lib/services/ensure-appointment-patient-client";
import { fetchPatientTreatmentCases } from "@/lib/services/patient-treatment-cases";
import { getPatientDisplayPhone } from "@/lib/phone";
import { opName, type PatientOperation } from "@/types";
import type { PatientTreatmentCase } from "@/lib/services/patient-treatment-cases";
import { RefreshCw } from "lucide-react";
import { VisualMedicalRecord } from "@/components/clinical/VisualMedicalRecord";

type RowWithJoins = TodayOperationRow;

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
  const queueEntryIdParam = searchParams.get("queue_entry_id") ?? undefined;
  const doctorIdParam = searchParams.get("doctor_id") ?? undefined;
  const patientNameParam = searchParams.get("patient_name") ?? undefined;
  const patientPhoneParam = searchParams.get("patient_phone") ?? undefined;
  const presetCaseId = searchParams.get("case") ?? undefined;

  const { clinicId, loading: clinicLoading } = useActiveClinicId();
  const [operations, setOperations] = useState<RowWithJoins[]>([]);
  const [caseRemainingById, setCaseRemainingById] = useState<
    Map<string, number>
  >(new Map());
  const [loading, setLoading] = useState(true);
  const [patientContext, setPatientContext] = useState<LedgerPatientContext | null>(
    null
  );
  const [contextLoading, setContextLoading] = useState(
    () => !!(patientIdParam || appointmentIdParam || queueEntryIdParam)
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
    const { operations: rows, caseRemainingById: caseMap } =
      await fetchTodayLedgerOperations(supabase, clinicId);
    setOperations(rows);
    setCaseRemainingById(caseMap);
    setLoading(false);
  }, [clinicId]);

  useEffect(() => {
    if (clinicLoading) return;
    loadOperations();
  }, [loadOperations, clinicLoading]);

  useClinicSync({
    topics: ["sessions"],
    clinicId,
    onRefresh: loadOperations,
    enabled: !clinicLoading && !!clinicId,
  });

  useEffect(() => {
    if (clinicLoading || !clinicId) return;

    let cancelled = false;

    async function resolvePatientContext() {
      if (!patientIdParam && !appointmentIdParam && !queueEntryIdParam) {
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
        let patientName = patientNameParam?.trim() || "";
        let patientPhone: string | undefined = patientPhoneParam ?? undefined;
        let doctorId = doctorIdParam ?? undefined;
        let doctorName: string | undefined;
        let queueContextWarning: string | null = null;

        if (queueEntryIdParam || appointmentIdParam) {
          const params = new URLSearchParams();
          if (queueEntryIdParam) {
            params.set("queue_entry_id", queueEntryIdParam);
          }
          if (appointmentIdParam) {
            params.set("appointment_id", appointmentIdParam);
          }

          try {
            const res = await fetch(
              `/api/operations/checkout-summary?${params.toString()}`,
              {
                credentials: "include",
                headers: authPortalHeaders("accountant"),
              }
            );
            const json = (await res.json().catch(() => ({}))) as {
              summary?: {
                patientId: string;
                patientName: string;
                patientPhone: string | null;
                doctorId: string;
                doctorName: string;
              };
              error?: string;
            };

            if (res.ok && json.summary) {
              const summary = json.summary;
              resolvedPatientId = resolvedPatientId ?? summary.patientId;
              patientName = patientName || summary.patientName || "";
              patientPhone = patientPhone ?? summary.patientPhone ?? undefined;
              doctorId = doctorId ?? summary.doctorId;
              doctorName = doctorName ?? summary.doctorName;
            } else if (queueEntryIdParam && !patientIdParam) {
              queueContextWarning =
                json.error ?? "تعذر تحميل دور الانتظار — أكمل الإدخال يدوياً";
            }
          } catch {
            if (queueEntryIdParam && !patientIdParam) {
              queueContextWarning =
                "تعذر الاتصال بالسيرفر لتحميل دور الانتظار";
            }
          }
        }

        if (appointmentIdParam && !resolvedPatientId) {
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

        if (queueEntryIdParam && !resolvedPatientId) {
          const { data: queueEntry } = await supabase
            .from("patient_queue")
            .select("patient_id, doctor_id, patient_name, patient_phone")
            .eq("id", queueEntryIdParam)
            .maybeSingle();

          if (queueEntry) {
            resolvedPatientId =
              resolvedPatientId ??
              (queueEntry.patient_id as string | null) ??
              undefined;
            doctorId = doctorId ?? (queueEntry.doctor_id as string | undefined);
            patientName =
              patientName ||
              (queueEntry.patient_name as string | null)?.trim() ||
              "";
            patientPhone =
              patientPhone ??
              (queueEntry.patient_phone as string | null) ??
              undefined;
          } else if (!patientIdParam) {
            queueContextWarning = queueContextWarning ?? "دور الانتظار غير موجود";
          }
        }

        if (!resolvedPatientId) {
          if (patientName) {
            setPatientContext(null);
            setContextError(
              queueContextWarning ??
                "لم يُعثر على ملف المريض — ابحث عن المراجع في نموذج الإدخال"
            );
            return;
          }
          throw new Error(
            queueContextWarning ?? "معرّف المريض غير متوفر"
          );
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
    queueEntryIdParam,
    doctorIdParam,
    patientNameParam,
    patientPhoneParam,
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
        const debt = ledgerDisplayRemaining(row, caseRemainingById);
        return (
          <span className={debt > 0 ? "font-semibold text-debt-text" : "text-slate-muted"}>
            {formatCurrency(debt)}
          </span>
        );
      },
    },
    {
      key: "clinical",
      header: "السجل البصري",
      render: (row) => (
        <VisualMedicalRecord
          operationId={row.id}
          portal="accountant"
          collapsible
          defaultOpen={false}
          compact
          onSaved={loadOperations}
        />
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

  const formKey = patientContext
    ? `patient-${patientContext.patientId}-${presetCaseId ?? "default"}`
    : "ledger-default";

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-bold text-slate-text">إدخال جلسة</h2>
        <p className="mc-page-subtitle">
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

      {!contextLoading && (
        <QuickEntryForm
          key={formKey}
          defaultPatientId={patientContext?.patientId ?? patientIdParam}
          defaultPatientName={
            patientContext?.patientName ?? patientNameParam
          }
          defaultPatientPhone={
            patientContext?.patientPhone ?? patientPhoneParam
          }
          defaultCaseId={presetCaseId}
          prefetchedCases={patientContext?.treatmentCases}
          lockDoctorId={patientContext?.doctorId}
          lockDoctorName={patientContext?.doctorName}
          visitQueueEntryId={queueEntryIdParam}
          onSuccess={async () => {
            loadOperations();

            if ((appointmentIdParam || queueEntryIdParam) && clinicId) {
              try {
                await fetch("/api/operations/complete-visit", {
                  method: "POST",
                  credentials: "include",
                  headers: {
                    "Content-Type": "application/json",
                    ...authPortalHeaders("accountant"),
                  },
                  body: JSON.stringify({
                    appointment_id: appointmentIdParam,
                    queue_entry_id: queueEntryIdParam,
                  }),
                });
                notifyQueueRefresh({ scope: "clinic", clinicId });
              } catch {
                // الدفع سُجّل — إغلاق الزيارة اختياري
              }
              router.replace(
                buildLedgerPayUrl({
                  patientId: patientContext?.patientId ?? patientIdParam,
                  doctorId: patientContext?.doctorId ?? doctorIdParam,
                })
              );
              return;
            }

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
            highlightDebt={(row) => ledgerDisplayRemaining(row, caseRemainingById) > 0}
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
