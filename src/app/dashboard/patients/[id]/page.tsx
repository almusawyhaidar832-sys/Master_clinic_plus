"use client";

import { useCallback, useEffect, useState } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import { Card, CardHeader, CardTitle } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { Alert } from "@/components/ui/Alert";
import { createClient } from "@/lib/supabase/client";
import { formatCurrency, formatDate } from "@/lib/utils";
import { formatDoctorDisplayName } from "@/lib/services/clinic-profile";
import { useClinicProfile } from "@/contexts/ClinicProfileContext";
import { ClinicBrandingHeader } from "@/components/branding/ClinicBrandingHeader";
import { QuickEntryForm } from "@/components/accountant/QuickEntryForm";
import { opName, opDebt, type Patient, type PatientOperation } from "@/types";
import { ArrowRight, Plus, X } from "lucide-react";

export default function PatientProfilePage() {
  const params = useParams();
  const id = params.id as string;
  const { profile } = useClinicProfile();
  const [patient, setPatient] = useState<Patient | null>(null);
  const [operations, setOperations] = useState<PatientOperation[]>([]);
  const [showAddSession, setShowAddSession] = useState(false);

  const loadOperations = useCallback(async () => {
    const supabase = createClient();
    // Order by created_at (safer than operation_date which may not exist)
    const { data } = await supabase
      .from("patient_operations")
      .select("*, doctor:doctors!doctor_id(full_name_ar)")
      .eq("patient_id", id)
      .order("created_at", { ascending: false });
    if (data) setOperations(data as PatientOperation[]);
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

  const totalDebt = operations.reduce((s, o) => s + opDebt(o), 0);
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

      {/* Patient card */}
      <Card className="overflow-hidden">
        <div className="border-b border-slate-border bg-surface/50 px-4 py-3">
          <ClinicBrandingHeader profile={profile} size="sm" className="border-0 pb-0" />
        </div>
        <CardHeader>
          <div className="flex items-start justify-between gap-4">
            <div>
              <CardTitle>{patient.full_name_ar}</CardTitle>
              {patient.phone && (
                <p className="text-sm text-slate-muted" dir="ltr">{patient.phone}</p>
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

        {/* Financial summary */}
        <div className="grid grid-cols-3 gap-3 px-4 pb-4">
          <div className="rounded-lg bg-surface p-3 text-center">
            <p className="text-lg font-bold text-slate-text">{operations.length}</p>
            <p className="text-xs text-slate-muted">جلسة</p>
          </div>
          <div className="rounded-lg bg-surface p-3 text-center">
            <p className="text-lg font-bold text-primary">{formatCurrency(totalPaid)}</p>
            <p className="text-xs text-slate-muted">مدفوع</p>
          </div>
          <div className={`rounded-lg p-3 text-center ${totalDebt > 0 ? "bg-debt/40" : "bg-emerald-50"}`}>
            <p className={`text-lg font-bold ${totalDebt > 0 ? "text-debt-text" : "text-emerald-700"}`}>
              {formatCurrency(totalDebt)}
            </p>
            <p className="text-xs text-slate-muted">
              {totalDebt > 0 ? "ذمة متبقية" : "تسوية كاملة"}
            </p>
          </div>
        </div>
      </Card>

      {/* Add session form — slides in */}
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

      {/* Session history */}
      <div>
        <h3 className="mb-3 text-lg font-semibold text-slate-text">
          سجل الجلسات — {formatCurrency(totalBilled)} إجمالي الفواتير
        </h3>

        {operations.length === 0 ? (
          <Alert variant="info">لا توجد جلسات مسجّلة لهذا المريض</Alert>
        ) : (
          <div className="space-y-2">
            {operations.map((op) => {
              const opWithDoctor = op as PatientOperation & {
                doctor?: { full_name_ar: string };
              };
              const debt = opDebt(op);
              return (
                <div
                  key={op.id}
                  className={`rounded-xl border p-4 ${
                    debt > 0
                      ? "border-debt/50 bg-debt/10"
                      : "border-slate-border bg-surface-card"
                  }`}
                >
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <div>
                      <p className="font-semibold text-slate-text">
                        {opName(op)}
                      </p>
                      <p className="text-xs text-slate-muted">
                        {op.operation_date
                          ? formatDate(op.operation_date)
                          : op.created_at
                          ? formatDate(op.created_at.split("T")[0])
                          : "—"}{" "}
                        · {formatDoctorDisplayName(opWithDoctor.doctor?.full_name_ar)}
                      </p>
                      {op.notes && (
                        <p className="mt-1 text-xs text-slate-muted italic">
                          {op.notes}
                        </p>
                      )}
                    </div>
                    <div className="text-left" dir="ltr">
                      <p className="text-sm font-bold text-slate-text">
                        {formatCurrency(op.total_amount)}
                      </p>
                      <p className="text-xs text-primary">
                        دفع: {formatCurrency(op.paid_amount)}
                      </p>
                      {debt > 0 && (
                        <p className="text-xs font-semibold text-debt-text">
                          متبقي: {formatCurrency(debt)}
                        </p>
                      )}
                    </div>
                  </div>
                  {/* Shares breakdown */}
                  {(op.doctor_share_amount || op.clinic_share_amount) && (
                    <div className="mt-2 flex gap-4 text-[10px] text-slate-muted border-t border-slate-border/50 pt-2">
                      <span>
                        حصة الطبيب:{" "}
                        <strong className="text-primary">
                          {formatCurrency(op.doctor_share_amount ?? 0)}
                        </strong>
                      </span>
                      <span>
                        حصة العيادة:{" "}
                        <strong>
                          {formatCurrency(op.clinic_share_amount ?? 0)}
                        </strong>
                      </span>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
