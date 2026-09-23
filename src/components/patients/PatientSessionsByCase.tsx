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
            : "text-success-text"
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
    <div className="relative rounded-2xl border border-slate-border bg-surface-card p-4 shadow-card">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex min-w-0 items-start gap-3">
          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-primary-50 text-sm font-bold text-primary-700 ring-1 ring-inset ring-primary-100 tabular-nums dark:bg-primary-900/30 dark:text-primary-200 dark:ring-primary-800">
            {item.sessionNumber}
          </span>
          <div className="min-w-0">
            <p className="inline-flex items-center rounded-full bg-premium-50 px-2 py-0.5 text-[11px] font-semibold text-premium-800 ring-1 ring-inset ring-premium-300/50 dark:bg-premium-500/10 dark:text-premium-200">
              {sessionKindLabel(op, !!clinicalView)} — جلسة {item.sessionNumber}{" "}
              من {totalInCase}
            </p>
            <p className="mt-1 text-sm font-bold text-slate-text">
              {clinicalView ? opName(op) : sessionDateLabel(item)}
            </p>
            <p className="text-xs text-slate-muted tabular-nums">
              {sessionDateLabel(item)}
              <span className="mx-1.5 text-slate-border">•</span>
              {formatDoctorDisplayName(opWithDoctor.doctor?.full_name_ar)}
            </p>
            {op.notes && (
              <p className="mt-1.5 text-xs italic text-slate-muted">{op.notes}</p>
            )}
            {Number(op.materials_cost ?? 0) > 0 && (
              <p className="mt-1 text-xs text-slate-muted tabular-nums">
                تكلفة المختبر: {formatCurrency(Number(op.materials_cost))}
              </p>
            )}
            {op.lab_notes?.trim() && (
              <p className="mt-1.5 rounded-lg border border-warning-border bg-warning px-2 py-1 text-xs text-warning-text">
                <span className="font-medium">ملاحظات المختبر: </span>
                {op.lab_notes}
              </p>
            )}
          </div>
        </div>
        {sessionPaid > 0 && (
          <div className="shrink-0 rounded-xl border border-slate-border bg-surface px-3 py-1.5 text-end tabular-nums">
            <p className="text-[11px] text-slate-muted">مدفوع هذه الجلسة</p>
            <p className="text-sm font-bold text-primary-700 dark:text-primary-300" dir="ltr">
              {formatCurrency(sessionPaid)}
            </p>
          </div>
        )}
        {sessionDebt > 0 && sessionPaid <= FINANCIAL_EPSILON && (
          <div className="shrink-0 rounded-xl border border-debt-border bg-debt px-3 py-1.5 text-end tabular-nums">
            <p className="text-[11px] text-debt-text">دين مسجّل</p>
            <p className="text-sm font-bold text-debt-text" dir="ltr">
              {formatCurrency(sessionDebt)}
            </p>
          </div>
        )}
      </div>

      {showContinueActions !== false && isPlan && linkedCaseId && (
        <div className="mt-3">
          {onContinueCase ? (
            <button
              type="button"
              className="mc-btn-soft w-full border-primary-200 text-primary-700 dark:text-primary-200"
              onClick={() => onContinueCase(linkedCaseId)}
            >
              متابعة هذه الحالة (فتح ملف / إضافة دفعة)
            </button>
          ) : (
            <Link
              href={`${ledgerPath}?patient=${encodeURIComponent(patientId)}&case=${encodeURIComponent(linkedCaseId)}`}
              className="mc-btn-soft w-full border-primary-200 text-primary-700 dark:text-primary-200"
            >
              متابعة هذه الحالة (فتح ملف / إضافة دفعة)
            </Link>
          )}
        </div>
      )}

      <div className="mt-3 border-t border-slate-border pt-3">
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
              className="inline-flex items-center rounded-xl border border-warning-border bg-warning px-3 py-1.5 text-xs font-semibold text-warning-text transition-all hover:-translate-y-px hover:shadow-soft disabled:opacity-50"
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
        className="mc-btn-navy w-full py-2.5"
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
      className="mc-btn-navy w-full py-2.5"
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
        "relative overflow-hidden rounded-2xl border bg-surface-card shadow-card transition-shadow",
        expanded && "shadow-soft",
        group.isComplete
          ? "border-success-border"
          : group.remaining > FINANCIAL_EPSILON
            ? "border-debt-border"
            : "border-slate-border"
      )}
    >
      <span
        aria-hidden
        className={cn(
          "absolute inset-y-0 start-0 w-1",
          group.isComplete
            ? "bg-success-text"
            : group.remaining > FINANCIAL_EPSILON
              ? "bg-debt-text"
              : "bg-premium-300"
        )}
      />
      <button
        type="button"
        onClick={onToggle}
        className="flex w-full items-start justify-between gap-3 px-5 py-4 text-start transition-colors hover:bg-surface"
      >
        <div className="flex min-w-0 items-start gap-3">
          <span
            className={cn(
              "flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border border-slate-border bg-surface text-slate-muted transition-all",
              expanded && "border-primary-200 bg-primary-50 text-primary-700 dark:bg-primary-900/30 dark:text-primary-200"
            )}
          >
            <ChevronDown
              className={cn(
                "h-5 w-5 transition-transform",
                expanded && "rotate-180"
              )}
            />
          </span>
          <div className="min-w-0">
            <p className="text-base font-bold text-slate-text">
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
            <div className="mt-2 inline-block rounded-lg bg-surface px-2.5 py-1">
              <CaseFinancialSummary group={group} />
            </div>
          </div>
        </div>
        {group.isComplete && (
          <span className="shrink-0 rounded-full border border-success-border bg-success px-2.5 py-0.5 text-xs font-semibold text-success-text">
            ✓ مكتمل
          </span>
        )}
      </button>

      {canContinue && linkedCaseId && (
        <div className="border-t border-slate-border bg-surface px-5 py-3">
          <ContinueCaseButton
            caseId={linkedCaseId}
            onContinueCase={onContinueCase}
            ledgerPath={ledgerPath}
            patientId={patientId}
          />
        </div>
      )}

      {expanded && (
        <div className="space-y-3 border-t border-slate-border bg-surface px-4 pb-4 pt-3 animate-fade-in">
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
    <div className="space-y-3">
      <p className="px-1 text-xs text-slate-muted">
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
