"use client";

import { useCallback, useEffect, useState } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import { Button } from "@/components/ui/Button";
import { Card, CardHeader, CardTitle } from "@/components/ui/Card";
import { createClient } from "@/lib/supabase/client";
import { getDoctorForCurrentUser } from "@/lib/clinic-context";
import { formatCurrency, formatDate } from "@/lib/utils";
import { formatDoctorDisplayName } from "@/lib/services/clinic-profile";
import type { Doctor, Patient, PatientOperation, MedicalLog, Treatment } from "@/types";
import { AddSessionClinicalPanel } from "@/components/clinical/AddSessionClinicalPanel";
import { SessionClinicalView } from "@/components/clinical/SessionClinicalView";
import { QuickEntryForm } from "@/components/accountant/QuickEntryForm";
import { fetchPatientClinicalRecords } from "@/lib/clinical/fetch-patient-clinical";
import type { ClinicalByOperationId } from "@/lib/clinical/types";
import { opName } from "@/types";
import { getPatientDisplayPhone } from "@/lib/phone";
import { ArrowRight, FileText, Plus, X } from "lucide-react";

export default function DoctorPatientDetailPage() {
  const params = useParams();
  const id = params.id as string;
  const [patient, setPatient] = useState<Patient | null>(null);
  const [operations, setOperations] = useState<PatientOperation[]>([]);
  const [logs, setLogs] = useState<MedicalLog[]>([]);
  const [treatments, setTreatments] = useState<Treatment[]>([]);
  const [newLog, setNewLog] = useState("");
  const [saving, setSaving] = useState(false);
  const [doctor, setDoctor] = useState<Doctor | null>(null);
  const [showSessionForm, setShowSessionForm] = useState(false);
  const [clinicalByOp, setClinicalByOp] = useState<ClinicalByOperationId>({});

  const reloadOperations = useCallback(async () => {
    const supabase = createClient();
    const doc = await getDoctorForCurrentUser(supabase);
    let opsQuery = supabase
      .from("patient_operations")
      .select("*")
      .eq("patient_id", id)
      .order("operation_date", { ascending: false });
    if (doc) opsQuery = opsQuery.eq("doctor_id", doc.id);
    const { data } = await opsQuery;
    setOperations((data as PatientOperation[]) || []);
    const clinical = await fetchPatientClinicalRecords(id);
    setClinicalByOp(clinical);
  }, [id]);

  useEffect(() => {
    async function load() {
      const supabase = createClient();
      const doc = await getDoctorForCurrentUser(supabase);
      setDoctor(doc);

      let opsQuery = supabase
        .from("patient_operations")
        .select("*")
        .eq("patient_id", id)
        .order("operation_date", { ascending: false });
      if (doc) opsQuery = opsQuery.eq("doctor_id", doc.id);

      const [pRes, oRes, lRes, tRes] = await Promise.all([
        supabase.from("patients").select("*").eq("id", id).single(),
        opsQuery,
        supabase
          .from("medical_logs")
          .select("*, doctor:doctors!doctor_id(full_name_ar)")
          .eq("patient_id", id)
          .order("log_date", { ascending: false }),
        supabase
          .from("treatments")
          .select("*")
          .eq("patient_id", id)
          .eq("status", "active"),
      ]);

      if (pRes.data) setPatient(pRes.data as Patient);
      setOperations((oRes.data as PatientOperation[]) || []);
      setLogs((lRes.data as MedicalLog[]) || []);
      setTreatments((tRes.data as Treatment[]) || []);
      const clinical = await fetchPatientClinicalRecords(id);
      setClinicalByOp(clinical);
    }
    if (id) load();
  }, [id]);

  async function addLog() {
    if (!newLog.trim()) return;
    const supabase = createClient();
    const doctor = await getDoctorForCurrentUser(supabase);
    if (!doctor) return;

    setSaving(true);
    const { data } = await supabase
      .from("medical_logs")
      .insert({
        clinic_id: doctor.clinic_id,
        patient_id: id,
        doctor_id: doctor.id,
        content_ar: newLog.trim(),
      })
      .select()
      .single();

    setSaving(false);
    if (data) {
      setLogs((prev) => [data as MedicalLog, ...prev]);
      setNewLog("");
    }
  }

  if (!patient) {
    return <p className="text-slate-muted">جاري التحميل...</p>;
  }

  return (
    <div className="space-y-4">
      <Link href="/doctor/patients">
        <Button variant="ghost" size="sm">
          <ArrowRight className="h-4 w-4" />
          قائمة المرضى
        </Button>
      </Link>

      <Card>
        <CardHeader>
          <CardTitle>{patient.full_name_ar}</CardTitle>
          {getPatientDisplayPhone(patient) && (
            <p dir="ltr" className="text-sm text-slate-muted">
              {getPatientDisplayPhone(patient)}
            </p>
          )}
        </CardHeader>
        <div className="flex flex-col gap-2">
          <Button
            variant="primary"
            size="sm"
            className="w-full"
            onClick={() => setShowSessionForm((v) => !v)}
          >
            {showSessionForm ? (
              <>
                <X className="h-4 w-4" />
                إغلاق إدخال الجلسة
              </>
            ) : (
              <>
                <Plus className="h-4 w-4" />
                إدخال جلسة (سجل بصري)
              </>
            )}
          </Button>
          <Link href={`/doctor/statement?patientId=${id}`}>
            <Button variant="outline" size="sm" className="w-full">
              <FileText className="h-4 w-4" />
              كشف حساب ومشاركة
            </Button>
          </Link>
        </div>
      </Card>

      {showSessionForm && doctor && (
        <QuickEntryForm
          defaultPatientId={id}
          defaultPatientName={patient.full_name_ar}
          lockDoctorId={doctor.id}
          onSuccess={() => {
            setShowSessionForm(false);
            reloadOperations();
          }}
        />
      )}

      {treatments.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">علاجات نشطة</CardTitle>
          </CardHeader>
          <ul className="space-y-2 text-sm">
            {treatments.map((t) => (
              <li key={t.id} className="rounded bg-amber-50 p-2">
                {t.title_ar} ({t.completed_sessions}/{t.expected_sessions})
              </li>
            ))}
          </ul>
        </Card>
      )}

      <Card>
        <CardHeader>
          <CardTitle className="text-base">سجل الجلسات</CardTitle>
        </CardHeader>
        {operations.length === 0 ? (
          <p className="text-sm text-slate-muted">لا توجد عمليات</p>
        ) : (
          <ul className="space-y-3 text-sm">
            {operations.map((op) => (
              <li
                key={op.id}
                className="rounded-lg border border-slate-border p-3"
              >
                <div className="flex justify-between gap-2">
                  <span className="font-medium">
                    {opName(op)}
                    {op.operation_date
                      ? ` — ${formatDate(op.operation_date)}`
                      : ""}
                  </span>
                  <span className="font-medium text-primary shrink-0">
                    {formatCurrency(op.doctor_share_amount ?? op.paid_amount)}
                  </span>
                </div>
                <SessionClinicalView data={clinicalByOp[op.id]} />
                <AddSessionClinicalPanel
                  operationId={op.id}
                  existing={clinicalByOp[op.id]}
                  onSaved={reloadOperations}
                />
              </li>
            ))}
          </ul>
        )}
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">إضافة ملاحظة طبية</CardTitle>
        </CardHeader>
        <textarea
          className="mb-2 w-full rounded-lg border border-slate-border p-3 text-sm"
          rows={3}
          value={newLog}
          onChange={(e) => setNewLog(e.target.value)}
          placeholder="سجل زيارة، تشخيص، خطة علاج..."
        />
        <Button size="sm" onClick={addLog} disabled={saving}>
          {saving ? "جاري الحفظ..." : "حفظ السجل"}
        </Button>
        {logs.length > 0 && (
          <ul className="mt-4 space-y-2 text-sm">
            {logs.map((log) => (
              <li key={log.id} className="rounded bg-surface p-2">
                <p className="text-xs text-slate-muted">
                  {formatDate(log.log_date)}
                </p>
                <p className="text-xs text-primary mb-1">
                  {formatDoctorDisplayName(
                    (log as { doctor?: { full_name_ar: string } }).doctor
                      ?.full_name_ar ?? doctor?.full_name_ar
                  )}
                </p>
                <p>{log.content_ar}</p>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}
