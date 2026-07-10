"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { ChevronDown } from "lucide-react";
import { formatCurrency, formatDate, cn } from "@/lib/utils";
import { formatDoctorDisplayName } from "@/lib/services/clinic-profile";
import { FINANCIAL_EPSILON } from "@/lib/services/patient-financial-plan";
import Link from "next/link";
import {
  buildPatientCaseGroups,
  type CaseSessionItem,
  type PatientCaseGroup,
} from "@/lib/services/patient-case-groups";
import type { PatientTreatmentCase } from "@/lib/services/patient-treatment-cases";
import {
  debtRegistrationAmountFromOperation,
  isDebtRegistrationOperation,
  isPersistedTreatmentCaseId,
} from "@/lib/services/patient-treatment-cases";
import { VisualMedicalRecord } from "@/components/clinical/VisualMedicalRecord";
import { SessionPrescriptionPanel } from "@/components/prescriptions/SessionPrescriptionPanel";
import { useClinicModules } from "@/contexts/ClinicModulesContext";
import type { ClinicalByOperationId } from "@/lib/clinical/types";
import { hasClinicalData } from "@/lib/clinical/types";
import { opName, type PatientOperation } from "@/types";
import { SessionEditDialog } from "@/components/sessions/SessionEditDialog";
import { SessionRefundModal } from "@/components/sessions/SessionRefundModal";
import { createClient } from "@/lib/supabase/client";
import { fetchRefundedTotalForSession } from "@/lib/services/session-refunds";

interface PatientSessionsByCaseProps {
  patientId: string;
  operations: PatientOperation[];
  treatmentCases: PatientTreatmentCase[];
  clinicalByOp: ClinicalByOperationId;
  onClinicalSaved: () => void;
  onContinueCase?: (caseId: string) => void;
  ledgerPath?: string;
  allowEdit?: boolean;
  showContinueActions?: boolean;
  /** clinical — قائمة الجلسات العلاجية؛ الملخص المالي من كل جلسات الحالة */
  viewMode?: "accountant" | "clinical";
}

function CaseFinancialSummary({ group }: { group: PatientCaseGroup }) {
  const sessionOnly = group.total <= FINANCIAL_EPSILON && group.totalPaid > 0;
  const hasDebt = group.remaining > FINANCIAL_EPSILON;

  if (sessionOnly && !hasDebt) {
    return (
      <p className="text-xs tabular-nums text-slate-muted leading-relaxed">
        مجموع المدفوع:{" "}
        <span className="font-semibold text-primary">
          {formatCurrency(group.totalPaid)}
        </span>
        {" · "}
        {group.sessions.length} جلسة
      </p>
    );
  }

  if (sessionOnly && hasDebt) {
    return (
      <p className="text-xs tabular-nums text-slate-muted leading-relaxed">
        مجموع المدفوع:{" "}
        <span className="font-semibold text-primary">
          {formatCurrency(group.totalPaid)}
        </span>
        {" | "}
        دين مسجّل:{" "}
        <span className="font-bold text-debt-text">
          {formatCurrency(group.remaining)}
        </span>
      </p>
    );
  }

  return (
    <p className="text-xs tabular-nums text-slate-muted leading-relaxed">
      الإجمالي:{" "}
      <span className="font-semibold text-slate-text">
        {formatCurrency(group.total)}
      </span>
      {" | "}
      المدفوع:{" "}
      <span className="font-semibold text-primary">
        {formatCurrency(group.totalPaid)}
      </span>
      {" | "}
      المتبقي:{" "}
      <span
        className={cn(
          "font-bold",
          group.remaining > FINANCIAL_EPSILON
            ? "text-debt-text"
            : "text-emerald-700"
        )}
      >
        {formatCurrency(group.remaining)}
      </span>
    </p>
  );
}

function sessionDateLabel(item: CaseSessionItem): string {
  if (item.date) return formatDate(item.date);
  return "—";
}

function sessionKindLabel(op: PatientOperation, clinicalView: boolean): string {
  if (clinicalView) {
    if (op.session_kind === "plan" || Number(op.total_amount) > 0) {
      return "بداية العلاج";
    }
    if (op.session_kind === "payment") return "دفعة";
    if (op.session_kind === "discount") return "خصم";
    return "متابعة";
  }
  if (op.session_kind === "discount") return "خصم إضافي";
  if (isDebtRegistrationOperation(op)) {
    return "تسجيل دين";
  }
  if (op.is_review_statement || Number((op as { review_fee_amount?: number }).review_fee_amount ?? 0) > 0) {
    const fee = Number((op as { review_fee_amount?: number }).review_fee_amount ?? op.paid_amount ?? 0);
    return fee > 0 ? "كشفية مراجع" : "كشف";
  }
  if (op.session_kind === "plan" || Number(op.total_amount) > 0) {
    return "فتح ملف / سعر الحالة";
  }
  if (op.session_kind === "payment") return "دفعة";
  return "جلسة";
}

function SessionRow({
  item,
  totalInCase,
  caseId,
  patientId,
  ledgerPath,
  onContinueCase,
  clinical,
  onClinicalSaved,
  allowEdit,
  showContinueActions,
  clinicalView,
  showPrescriptions = false,
  prescriptionPortal = "doctor",
}: {
  item: CaseSessionItem;
  totalInCase: number;
  caseId: string | null;
  patientId: string;
  ledgerPath: string;
  onContinueCase?: (caseId: string) => void;
  clinical?: ClinicalByOperationId[string];
  onClinicalSaved: () => void;
  allowEdit?: boolean;
  showContinueActions?: boolean;
  clinicalView?: boolean;
  showPrescriptions?: boolean;
  prescriptionPortal?: "doctor" | "accountant";
}) {
  const op = item.operation;
  const [refundOpen, setRefundOpen] = useState(false);
  const [maxRefundable, setMaxRefundable] = useState(0);
  const [refundLoading, setRefundLoading] = useState(false);

  const opWithDoctor = op as PatientOperation & {
    doctor?: { full_name_ar: string };
  };
  const isPlan = op.session_kind === "plan" || Number(op.total_amount) > 0;
  const hasClinical = hasClinicalData(clinical);
  const sessionPaid = item.amountPaid;
  const sessionDebt = debtRegistrationAmountFromOperation(op);
  const canRefund =
    !!allowEdit && op.session_kind !== "refund" && sessionPaid > 0;
  const linkedCaseId =
    caseId ??
    (op.treatment_case_id && isPersistedTreatmentCaseId(op.treatment_case_id)
      ? op.treatment_case_id
      : null);

  return (
    <div className="rounded-lg border border-slate-border/80 bg-white p-3">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="text-xs font-medium text-primary">
            {sessionKindLabel(op, !!clinicalView)} — جلسة {item.sessionNumber}{" "}
            من {totalInCase}
          </p>
          <p className="text-sm font-semibold text-slate-text">
            {clinicalView ? opName(op) : sessionDateLabel(item)}
          </p>
          <p className="text-sm text-slate-muted tabular-nums">
            {sessionDateLabel(item)}
          </p>
          <p className="text-xs text-slate-muted">
            {formatDoctorDisplayName(opWithDoctor.doctor?.full_name_ar)}
          </p>
          {op.notes && (
            <p className="mt-1 text-xs text-slate-muted italic">{op.notes}</p>
          )}
          {Number(op.materials_cost ?? 0) > 0 && (
            <p className="mt-1 text-xs text-slate-muted tabular-nums">
              تكلفة المختبر: {formatCurrency(Number(op.materials_cost))}
            </p>
          )}
          {op.lab_notes?.trim() && (
            <p className="mt-1 text-xs text-amber-800/90">
              <span className="font-medium">ملاحظات المختبر: </span>
              {op.lab_notes}
            </p>
          )}
        </div>
        {sessionPaid > 0 && (
          <div className="shrink-0 text-left tabular-nums" dir="ltr">
            <p className="text-xs text-slate-muted">مدفوع هذه الجلسة</p>
            <p className="text-sm font-bold text-primary">
              {formatCurrency(sessionPaid)}
            </p>
          </div>
        )}
        {sessionDebt > 0 && sessionPaid <= FINANCIAL_EPSILON && (
          <div className="shrink-0 text-left tabular-nums" dir="ltr">
            <p className="text-xs text-slate-muted">دين مسجّل</p>
            <p className="text-sm font-bold text-debt-text">
              {formatCurrency(sessionDebt)}
            </p>
          </div>
        )}
      </div>

      {showContinueActions !== false && isPlan && linkedCaseId && (
        <div className="mt-2">
          {onContinueCase ? (
            <button
              type="button"
              className="w-full rounded-lg border border-primary/40 bg-primary/5 px-3 py-2 text-sm font-semibold text-primary hover:bg-primary/10"
              onClick={() => onContinueCase(linkedCaseId)}
            >
              متابعة هذه الحالة (فتح ملف / إضافة دفعة)
            </button>
          ) : (
            <Link
              href={`${ledgerPath}?patient=${encodeURIComponent(patientId)}&case=${encodeURIComponent(linkedCaseId)}`}
              className="block w-full rounded-lg border border-primary/40 bg-primary/5 px-3 py-2 text-center text-sm font-semibold text-primary hover:bg-primary/10"
            >
              متابعة هذه الحالة (فتح ملف / إضافة دفعة)
            </Link>
          )}
        </div>
      )}

      <div className="mt-2 border-t border-slate-border/50 pt-2">
        <VisualMedicalRecord
          operationId={op.id}
          portal={prescriptionPortal}
          initialData={clinical}
          onSaved={onClinicalSaved}
          collapsible
          defaultOpen={hasClinical}
          readOnly={!clinicalView}
          accountantSingleChart={!clinicalView}
        />
        {showPrescriptions && op.doctor_id && (
          <SessionPrescriptionPanel
            className="mt-2"
            operationId={op.id}
            patientId={patientId}
            doctorId={op.doctor_id}
            queueEntryId={op.queue_entry_id}
            portal={prescriptionPortal}
            readOnly
          />
        )}
        <div className="mt-2 flex flex-wrap gap-2">
          {canRefund && (
            <button
              type="button"
              disabled={refundLoading}
              onClick={async () => {
                setRefundLoading(true);
                try {
                  const supabase = createClient();
                  const refunded = await fetchRefundedTotalForSession(
                    supabase,
                    op.id
                  );
                  setMaxRefundable(
                    Math.max(0, Math.round((sessionPaid - refunded) * 100) / 100)
                  );
                  setRefundOpen(true);
                } finally {
                  setRefundLoading(false);
                }
              }}
              className="rounded-lg border border-amber-300 bg-amber-50 px-3 py-1.5 text-xs font-semibold text-amber-800 hover:bg-amber-100 disabled:opacity-50"
            >
              {refundLoading ? "جاري التحميل..." : "استرجاع مبلغ"}
            </button>
          )}
          {allowEdit && (
            <SessionEditDialog operation={op} onSaved={onClinicalSaved} />
          )}
        </div>
      </div>
    </div>
  );
}

function ContinueCaseButton({
  caseId,
  onContinueCase,
  ledgerPath,
  patientId,
}: {
  caseId: string;
  onContinueCase?: (caseId: string) => void;
  ledgerPath: string;
  patientId: string;
}) {
  if (onContinueCase) {
    return (
      <button
        type="button"
        className="w-full rounded-lg border border-primary/40 bg-primary/5 px-3 py-2 text-sm font-semibold text-primary hover:bg-primary/10"
        onClick={(e) => {
          e.stopPropagation();
          onContinueCase(caseId);
        }}
      >
        متابعة الحالة — إضافة جلسة / دفعة
      </button>
    );
  }
  return (
    <Link
      href={`${ledgerPath}?patient=${encodeURIComponent(patientId)}&case=${encodeURIComponent(caseId)}`}
      className="block w-full rounded-lg border border-primary/40 bg-primary/5 px-3 py-2 text-center text-sm font-semibold text-primary hover:bg-primary/10"
      onClick={(e) => e.stopPropagation()}
    >
      متابعة الحالة — إضافة جلسة / دفعة
    </Link>
  );
}

function CaseAccordion({
  group,
  expanded,
  onToggle,
  patientId,
  ledgerPath,
  onContinueCase,
  clinicalByOp,
  onClinicalSaved,
  allowEdit,
  showContinueActions,
  clinicalView,
  showPrescriptions = false,
  prescriptionPortal = "doctor",
}: {
  group: PatientCaseGroup;
  expanded: boolean;
  onToggle: () => void;
  patientId: string;
  ledgerPath: string;
  onContinueCase?: (caseId: string) => void;
  clinicalByOp: ClinicalByOperationId;
  onClinicalSaved: () => void;
  allowEdit?: boolean;
  showContinueActions?: boolean;
  clinicalView?: boolean;
  showPrescriptions?: boolean;
  prescriptionPortal?: "doctor" | "accountant";
}) {
  const linkedCaseId =
    group.caseId && isPersistedTreatmentCaseId(group.caseId)
      ? group.caseId
      : null;
  const canContinue =
    showContinueActions !== false &&
    !!linkedCaseId &&
    group.remaining > FINANCIAL_EPSILON;

  return (
    <div
      className={cn(
        "rounded-xl border overflow-hidden",
        group.isComplete
          ? "border-emerald-200 bg-emerald-50/30"
          : group.remaining > FINANCIAL_EPSILON
            ? "border-debt/40 bg-debt/5"
            : "border-slate-border bg-surface-card"
      )}
    >
      <button
        type="button"
        onClick={onToggle}
        className="flex w-full items-start justify-between gap-3 px-4 py-3 text-right hover:bg-black/[0.02] transition-colors"
      >
        <div className="flex items-start gap-2 min-w-0">
          <ChevronDown
            className={cn(
              "mt-0.5 h-5 w-5 shrink-0 text-slate-muted transition-transform",
              expanded && "rotate-180"
            )}
          />
          <div className="min-w-0">
            <p className="font-semibold text-slate-text text-base">
              {group.caseName}
              {group.total > 0 && (
                <span className="font-normal text-slate-muted">
                  {" "}
                  — {formatCurrency(group.total)}
                </span>
              )}
            </p>
            <p className="text-xs text-slate-muted mt-0.5">
              {group.sessions.length} جلسة
              {group.caseInfo?.primary_doctor_name ? (
                <>
                  {" "}
                  — د.{" "}
                  {formatDoctorDisplayName(group.caseInfo.primary_doctor_name)}
                </>
              ) : null}
            </p>
            <div className="mt-1.5">
              <CaseFinancialSummary group={group} />
            </div>
          </div>
        </div>
        {group.isComplete && (
          <span className="shrink-0 text-xs font-semibold text-emerald-700">
            ✓ مكتمل
          </span>
        )}
      </button>

      {canContinue && linkedCaseId && (
        <div className="border-t border-primary/20 bg-primary/5 px-3 py-2">
          <ContinueCaseButton
            caseId={linkedCaseId}
            onContinueCase={onContinueCase}
            ledgerPath={ledgerPath}
            patientId={patientId}
          />
        </div>
      )}

      {expanded && (
        <div className="border-t border-slate-border/60 px-3 pb-3 pt-2 space-y-2 bg-white/60">
          {group.sessions.length === 0 ? (
            <p className="text-xs text-slate-muted px-2 py-2">
              لا جلسات مسجّلة في هذه الحالة بعد.
            </p>
          ) : (
            group.sessions.map((item) => (
              <SessionRow
                key={item.operation.id}
                item={item}
                totalInCase={group.sessions.length}
                caseId={linkedCaseId}
                patientId={patientId}
                ledgerPath={ledgerPath}
                onContinueCase={onContinueCase}
                clinical={clinicalByOp[item.operation.id]}
                onClinicalSaved={onClinicalSaved}
                allowEdit={allowEdit}
                showContinueActions={showContinueActions}
                clinicalView={clinicalView}
                showPrescriptions={showPrescriptions}
                prescriptionPortal={prescriptionPortal}
              />
            ))
          )}
        </div>
      )}
    </div>
  );
}

export function PatientSessionsByCase({
  patientId,
  operations,
  treatmentCases,
  clinicalByOp,
  onClinicalSaved,
  onContinueCase,
  ledgerPath = "/dashboard/ledger",
  allowEdit = false,
  showContinueActions = true,
  viewMode = "accountant",
}: PatientSessionsByCaseProps) {
  const { hasModule } = useClinicModules();
  const showPrescriptions = hasModule("smart_prescriptions");
  const clinicalView = viewMode === "clinical";
  const prescriptionPortal = clinicalView ? "doctor" : "accountant";

  const caseGroups = useMemo(
    () =>
      buildPatientCaseGroups(operations, treatmentCases, {
        clinicalSessionsOnly: clinicalView,
        clinicalByOp,
      }),
    [operations, treatmentCases, clinicalView, clinicalByOp]
  );

  const defaultKey =
    caseGroups.find((g) => !g.isComplete)?.key ?? caseGroups[0]?.key ?? null;

  const [expandedKey, setExpandedKey] = useState<string | null>(null);
  const didInit = useRef(false);

  useEffect(() => {
    if (!didInit.current && defaultKey) {
      setExpandedKey(defaultKey);
      didInit.current = true;
    }
  }, [defaultKey]);

  if (caseGroups.length === 0) return null;

  return (
    <div className="space-y-2">
      <p className="text-xs text-slate-muted mb-2">
        كل حالة مجمّعة بمعرّفها — الملخص المالي محسوب من جلسات هذه الحالة فقط
      </p>
      {caseGroups.map((group) => (
        <CaseAccordion
          key={group.key}
          group={group}
          expanded={expandedKey === group.key}
          onToggle={() =>
            setExpandedKey((k) => (k === group.key ? null : group.key))
          }
          patientId={patientId}
          ledgerPath={ledgerPath}
          onContinueCase={onContinueCase}
          clinicalByOp={clinicalByOp}
          onClinicalSaved={onClinicalSaved}
          allowEdit={allowEdit}
          showContinueActions={showContinueActions}
          clinicalView={clinicalView}
          showPrescriptions={showPrescriptions}
          prescriptionPortal={prescriptionPortal}
        />
      ))}
    </div>
  );
}

/** للاستخدام في الصفحات — خريطة الحالات بعد الجلب */
export { buildPatientCaseGroups, buildPatientCaseGroupsMap } from "@/lib/services/patient-case-groups";
