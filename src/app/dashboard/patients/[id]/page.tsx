"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import { Card, CardHeader, CardTitle } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { Alert } from "@/components/ui/Alert";
import { createClient } from "@/lib/supabase/client";
import { formatCurrency } from "@/lib/utils";
import { useClinicProfile } from "@/contexts/ClinicProfileContext";
import { ClinicBrandingHeader } from "@/components/branding/ClinicBrandingHeader";
import { QuickEntryForm } from "@/components/accountant/QuickEntryForm";
import { isTreatmentCaseComplete } from "@/lib/services/patient-financial-plan";
import {
  computeOutstandingDebtFromOperations,
  inferTreatmentCasesFromOperations,
} from "@/lib/services/patient-treatment-cases";
import { PatientSessionsByCase } from "@/components/patients/PatientSessionsByCase";
import { fetchPatientClinicalRecords } from "@/lib/clinical/fetch-patient-clinical";
import type { ClinicalByOperationId } from "@/lib/clinical/types";
import type { Patient, PatientOperation } from "@/types";
import { ArrowRight, Plus, X } from "lucide-react";

export default function PatientProfilePage() {
  const params = useParams();
  const id = params.id as string;
  const { profile } = useClinicProfile();
  const [patient, setPatient] = useState<Patient | null>(null);
  const [operations, setOperations] = useState<PatientOperation[]>([]);
  const [clinicalByOp, setClinicalByOp] = useState<ClinicalByOperationId>({});
  const [showAddSession, setShowAddSession] = useState(false);

  const loadOperations = useCallback(async () => {
    const supabase = createClient();
    const { data } = await supabase
      .from("patient_operations")
      .select("*, doctor:doctors!doctor_id(full_name_ar)")
      .eq("patient_id", id)
      .order("created_at", { ascending: false });
    if (data) {
      setOperations(data as PatientOperation[]);
      const clinical = await fetchPatientClinicalRecords(id);
      setClinicalByOp(clinical);
    }
  }, [id]);

  useEffect(() => {
    async function load() {
      const supabase = createClient();
      const { data: pRes } = await supabase
        .from("patients")
        .select("*")
        .eq("id", id)
        .maybeSingle();
      if (pRes) setPatient(pRes as Patient);
      await loadOperations();
    }
    if (id) load();
  }, [id, loadOperations]);

  const treatmentCases = useMemo(
    () => inferTreatmentCasesFromOperations(operations, id),
    [operations, id]
  );

  const totalDebt = useMemo(
    () => computeOutstandingDebtFromOperations(operations, id),
    [operations, id]
  );
  const totalPaid = operations.reduce((s, o) => s + o.paid_amount, 0);
  const totalBilled = operations.reduce((s, o) => s + o.total_amount, 0);

  if (!patient) {
    return (
      <div className="flex items-center justify-center py-16 text-slate-muted">
        جاري تحميل ملف المريض...
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <Link href="/dashboard/patients">
        <Button variant="ghost" size="sm">
          <ArrowRight className="h-4 w-4" />
          البحث عن مريض
        </Button>
      </Link>

      <Card className="overflow-hidden">
        <div className="border-b border-slate-border bg-surface/50 px-4 py-3">
          <ClinicBrandingHeader profile={profile} size="sm" className="border-0 pb-0" />
        </div>
        <CardHeader>
          <div className="flex items-start justify-between gap-4">
            <div>
              <CardTitle>{patient.full_name_ar}</CardTitle>
              {patient.phone && (
                <p className="text-sm text-slate-muted" dir="ltr">
                  {patient.phone}
                </p>
              )}
              {patient.notes && (
                <p className="mt-1 text-xs text-slate-muted">{patient.notes}</p>
              )}
            </div>
            <Button
              size="sm"
              onClick={() => setShowAddSession((v) => !v)}
              variant={showAddSession ? "outline" : "primary"}
            >
              {showAddSession ? (
                <>
                  <X className="h-4 w-4" />
                  إغلاق
                </>
              ) : (
                <>
                  <Plus className="h-4 w-4" />
                  إضافة جلسة جديدة
                </>
              )}
            </Button>
          </div>
        </CardHeader>

        <div className="grid grid-cols-3 gap-3 px-4 pb-4">
          <div className="rounded-lg bg-surface p-3 text-center">
            <p className="text-lg font-bold text-slate-text">
              {operations.length}
            </p>
            <p className="text-xs text-slate-muted">جلسة</p>
          </div>
          <div className="rounded-lg bg-surface p-3 text-center">
            <p className="text-lg font-bold text-primary">
              {formatCurrency(totalPaid)}
            </p>
            <p className="text-xs text-slate-muted">مدفوع</p>
          </div>
          <div
            className={`rounded-lg p-3 text-center ${totalDebt > 0 ? "bg-debt/40" : "bg-emerald-50"}`}
          >
            <p
              className={`text-lg font-bold ${totalDebt > 0 ? "text-debt-text" : "text-emerald-700"}`}
            >
              {formatCurrency(totalDebt)}
            </p>
            <p className="text-xs text-slate-muted">
              {totalDebt > 0 ? "ذمة متبقية" : "لا ذمة"}
            </p>
          </div>
        </div>

        {treatmentCases.length > 0 && (
          <div className="border-t border-slate-border px-4 pb-4 pt-3">
            <p className="text-xs font-semibold text-slate-muted mb-2">
              ملخص الحالات
            </p>
            <ul className="flex flex-wrap gap-2">
              {treatmentCases.map((c) => (
                <li
                  key={c.id}
                  className="rounded-full border border-slate-border bg-surface/80 px-3 py-1 text-xs"
                >
                  <span className="font-medium text-slate-text">
                    {c.treatment_name_ar}
                  </span>
                  {" — "}
                  {isTreatmentCaseComplete(c) ? (
                    <span className="text-emerald-700 font-semibold">مكتمل</span>
                  ) : (
                    <span className="text-debt-text font-semibold tabular-nums">
                      متبقي {formatCurrency(c.remaining_balance)}
                    </span>
                  )}
                </li>
              ))}
            </ul>
          </div>
        )}
      </Card>

      {showAddSession && (
        <div className="rounded-xl border-2 border-primary/20 bg-primary/5 p-4">
          <p className="mb-3 text-sm font-semibold text-primary">
            إضافة جلسة جديدة للمريض: {patient.full_name_ar}
          </p>
          <QuickEntryForm
            defaultPatientId={id}
            defaultPatientName={patient.full_name_ar}
            onSuccess={() => {
              loadOperations();
              setShowAddSession(false);
            }}
          />
        </div>
      )}

      <div>
        <h3 className="mb-3 text-lg font-semibold text-slate-text">
          سجل الجلسات حسب الحالة
          {totalBilled > 0 && (
            <span className="text-sm font-normal text-slate-muted mr-2">
              — فواتير {formatCurrency(totalBilled)}
            </span>
          )}
        </h3>

        {operations.length === 0 ? (
          <Alert variant="info">لا توجد جلسات مسجّلة لهذا المريض</Alert>
        ) : (
          <PatientSessionsByCase
            operations={operations}
            treatmentCases={treatmentCases}
            clinicalByOp={clinicalByOp}
            onClinicalSaved={loadOperations}
          />
        )}
      </div>
    </div>
  );
}
