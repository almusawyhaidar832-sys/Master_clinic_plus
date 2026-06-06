"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { ChevronDown } from "lucide-react";
import { formatCurrency, formatDate, cn } from "@/lib/utils";
import { formatDoctorDisplayName } from "@/lib/services/clinic-profile";
import {
  computedCaseRemaining,
  FINANCIAL_EPSILON,
  isTreatmentCaseComplete,
} from "@/lib/services/patient-financial-plan";
import Link from "next/link";
import { sortOpsChronologically } from "@/lib/services/case-session-count";
import {
  groupOperationsByTreatmentCase,
  type TreatmentCaseSessionGroup,
} from "@/lib/services/group-operations-by-case";
import {
  isPersistedTreatmentCaseId,
  treatmentCaseDisplayLabel,
  treatmentNameKey,
} from "@/lib/services/patient-treatment-cases";
import type { PatientTreatmentCase } from "@/lib/services/patient-treatment-cases";
import { AddSessionClinicalPanel } from "@/components/clinical/AddSessionClinicalPanel";
import { SessionClinicalView } from "@/components/clinical/SessionClinicalView";
import type { ClinicalByOperationId } from "@/lib/clinical/types";
import { hasClinicalData } from "@/lib/clinical/types";
import type { PatientOperation } from "@/types";
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
  /** فتح نموذج المتابعة داخل نفس الصفحة */
  onContinueCase?: (caseId: string) => void;
  /** مسار الإدخال السريع (افتراضي لوحة المحاسب) */
  ledgerPath?: string;
  /** محاسب / طبيب / مالك — يظهر زر تعديل السجل */
  allowEdit?: boolean;
}

function resolveGroupCaseId(
  group: TreatmentCaseSessionGroup,
  treatmentCases: PatientTreatmentCase[]
): string | null {
  if (group.caseId && isPersistedTreatmentCaseId(group.caseId)) {
    return group.caseId;
  }
  if (
    group.caseInfo?.id &&
    isPersistedTreatmentCaseId(group.caseInfo.id)
  ) {
    return group.caseInfo.id;
  }
  for (const op of group.sessions) {
    const linked = op.treatment_case_id?.trim();
    if (linked && isPersistedTreatmentCaseId(linked)) return linked;
  }
  const nameKey = treatmentNameKey(group.treatmentName);
  const nameMatches = treatmentCases.filter(
    (c) =>
      isPersistedTreatmentCaseId(c.id) &&
      treatmentNameKey(c.treatment_name_ar) === nameKey
  );
  if (nameMatches.length === 1) return nameMatches[0].id;
  return null;
}

function resolveGroupCaseInfo(
  group: TreatmentCaseSessionGroup,
  treatmentCases: PatientTreatmentCase[],
  linkedCaseId: string | null
): PatientTreatmentCase | null {
  if (group.caseInfo) return group.caseInfo;
  if (linkedCaseId) {
    return treatmentCases.find((c) => c.id === linkedCaseId) ?? null;
  }
  const nameKey = treatmentNameKey(group.treatmentName);
  const nameMatches = treatmentCases.filter(
    (c) => treatmentNameKey(c.treatment_name_ar) === nameKey
  );
  if (nameMatches.length === 1) return nameMatches[0];
  return null;
}

function sessionDateLabel(op: PatientOperation): string {
  if (op.operation_date) return formatDate(op.operation_date);
  if (op.created_at) return formatDate(op.created_at.split("T")[0]);
  return "—";
}

function sessionKindLabel(op: PatientOperation): string {
  if (op.session_kind === "discount") return "خصم إضافي";
  if (op.session_kind === "plan" || Number(op.total_amount) > 0) {
    return "فتح ملف / سعر الحالة";
  }
  return "دفعة";
}

function SessionRow({
  op,
  sessionNumber,
  totalInCase,
  caseId,
  patientId,
  ledgerPath,
  onContinueCase,
  clinical,
  onClinicalSaved,
  allowEdit,
}: {
  op: PatientOperation;
  sessionNumber: number;
  totalInCase: number;
  caseId: string | null;
  patientId: string;
  ledgerPath: string;
  onContinueCase?: (caseId: string) => void;
  clinical?: ClinicalByOperationId[string];
  onClinicalSaved: () => void;
  allowEdit?: boolean;
}) {
  const [refundOpen, setRefundOpen] = useState(false);
  const [maxRefundable, setMaxRefundable] = useState(0);
  const [refundLoading, setRefundLoading] = useState(false);

  const opWithDoctor = op as PatientOperation & {
    doctor?: { full_name_ar: string };
  };
  const isPlan = op.session_kind === "plan" || Number(op.total_amount) > 0;
  const hasClinical = hasClinicalData(clinical);
  const sessionPaid = Number(op.paid_amount ?? 0);
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
            {sessionKindLabel(op)} — جلسة {sessionNumber} من {totalInCase}
          </p>
          <p className="text-sm font-semibold text-slate-text tabular-nums">
            {sessionDateLabel(op)}
          </p>
          <p className="text-xs text-slate-muted">
            {formatDoctorDisplayName(opWithDoctor.doctor?.full_name_ar)}
          </p>
          {op.notes && (
            <p className="mt-1 text-xs text-slate-muted italic">{op.notes}</p>
          )}
        </div>
        <div className="text-left shrink-0 tabular-nums" dir="ltr">
          {isPlan && Number(op.total_amount) > 0 && (
            <p className="text-sm font-bold text-slate-text">
              سعر الحالة: {formatCurrency(op.total_amount)}
            </p>
          )}
          {Number(op.paid_amount) > 0 && (
            <p className="text-xs text-primary font-semibold">
              دفع: {formatCurrency(op.paid_amount)}
            </p>
          )}
          {op.session_kind === "discount" && (
            <p className="text-xs text-amber-800">خصم على الذمة</p>
          )}
        </div>
      </div>

      {isPlan && linkedCaseId && (
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
        {hasClinical && (
          <SessionClinicalView data={clinical} alwaysShow={false} />
        )}
        <AddSessionClinicalPanel
          operationId={op.id}
          existing={clinical}
          onSaved={onClinicalSaved}
        />
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

      <SessionRefundModal
        operation={op}
        maxRefundable={maxRefundable}
        open={refundOpen}
        onClose={() => setRefundOpen(false)}
        onSaved={onClinicalSaved}
      />
    </div>
  );
}

function ContinueCaseButton({
  caseId,
  onContinueCase,
  ledgerPath,
  patientId,
  compact,
}: {
  caseId: string;
  onContinueCase?: (caseId: string) => void;
  ledgerPath: string;
  patientId: string;
  compact?: boolean;
}) {
  if (onContinueCase) {
    return (
      <button
        type="button"
        className={
          compact
            ? "text-xs font-semibold text-primary underline"
            : "w-full rounded-lg border border-primary/40 bg-primary/5 px-3 py-2 text-sm font-semibold text-primary hover:bg-primary/10"
        }
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
      className={
        compact
          ? "text-xs font-semibold text-primary underline"
          : "block w-full rounded-lg border border-primary/40 bg-primary/5 px-3 py-2 text-center text-sm font-semibold text-primary hover:bg-primary/10"
      }
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
  treatmentCases,
  clinicalByOp,
  onClinicalSaved,
  allowEdit,
}: {
  group: TreatmentCaseSessionGroup;
  expanded: boolean;
  onToggle: () => void;
  patientId: string;
  ledgerPath: string;
  onContinueCase?: (caseId: string) => void;
  treatmentCases: PatientTreatmentCase[];
  clinicalByOp: ClinicalByOperationId;
  onClinicalSaved: () => void;
  allowEdit?: boolean;
}) {
  const linkedCaseId = resolveGroupCaseId(group, treatmentCases);
  const caseInfo = resolveGroupCaseInfo(group, treatmentCases, linkedCaseId);
  const remaining = caseInfo ? computedCaseRemaining(caseInfo) : 0;
  const complete =
    caseInfo ? isTreatmentCaseComplete(caseInfo) && remaining <= FINANCIAL_EPSILON : false;
  const canContinue =
    !!linkedCaseId &&
    (caseInfo ? remaining > FINANCIAL_EPSILON : true);

  return (
    <div
      className={cn(
        "rounded-xl border overflow-hidden",
        complete
          ? "border-emerald-200 bg-emerald-50/30"
          : remaining > FINANCIAL_EPSILON
            ? "border-debt/40 bg-debt/5"
            : "border-slate-border bg-surface-card"
      )}
    >
      <button
        type="button"
        onClick={onToggle}
        className="flex w-full items-center justify-between gap-3 px-4 py-3 text-right hover:bg-black/[0.02] transition-colors"
      >
        <div className="flex items-center gap-2 min-w-0">
          <ChevronDown
            className={cn(
              "h-5 w-5 shrink-0 text-slate-muted transition-transform",
              expanded && "rotate-180"
            )}
          />
          <div>
            <p className="font-semibold text-slate-text text-base">
              {caseInfo
                ? treatmentCaseDisplayLabel(caseInfo, treatmentCases)
                : group.treatmentName}
            </p>
            <p className="text-xs text-slate-muted mt-0.5">
              {group.sessionCount} جلسة
              {caseInfo && (
                <>
                  {" "}
                  · السعر الكلي {formatCurrency(caseInfo.case_price)}
                </>
              )}
            </p>
          </div>
        </div>
        <div className="shrink-0 text-left flex flex-col items-end gap-1">
          {complete ? (
            <span className="text-xs font-semibold text-emerald-700">
              ✓ مكتمل
            </span>
          ) : caseInfo ? (
            <>
              <p className="text-xs text-slate-muted">المتبقي</p>
              <p className="text-lg font-bold text-debt-text tabular-nums">
                {formatCurrency(remaining)}
              </p>
            </>
          ) : null}
        </div>
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
              لا جلسات مسجّلة بعد — استخدم «متابعة الحالة» أعلاه لإضافة أول جلسة.
            </p>
          ) : null}
          {(() => {
            const chronological = sortOpsChronologically(group.sessions);
            const totalInCase = chronological.length;
            return chronological.map((op, index) => (
              <SessionRow
                key={op.id}
                op={op}
                sessionNumber={index + 1}
                totalInCase={totalInCase}
                caseId={linkedCaseId}
                patientId={patientId}
                ledgerPath={ledgerPath}
                onContinueCase={onContinueCase}
                clinical={clinicalByOp[op.id]}
                onClinicalSaved={onClinicalSaved}
                allowEdit={allowEdit}
              />
            ));
          })()}
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
}: PatientSessionsByCaseProps) {
  const groups = useMemo(() => {
    const base = groupOperationsByTreatmentCase(operations, treatmentCases);
    const representedCaseIds = new Set(
      base
        .map((g) => g.caseId)
        .filter((id): id is string => !!id && isPersistedTreatmentCaseId(id))
    );
    for (const c of treatmentCases) {
      if (!isPersistedTreatmentCaseId(c.id)) continue;
      if (representedCaseIds.has(c.id)) continue;
      if (computedCaseRemaining(c) <= FINANCIAL_EPSILON) continue;
      base.push({
        key: `case:${c.id}`,
        treatmentName: c.treatment_name_ar,
        caseId: c.id,
        caseInfo: c,
        sessions: [],
        sessionCount: 0,
      });
    }
    return base.sort((a, b) => {
      const aComplete = a.caseInfo ? isTreatmentCaseComplete(a.caseInfo) : false;
      const bComplete = b.caseInfo ? isTreatmentCaseComplete(b.caseInfo) : false;
      if (aComplete !== bComplete) return aComplete ? 1 : -1;
      const aRem = a.caseInfo ? computedCaseRemaining(a.caseInfo) : 0;
      const bRem = b.caseInfo ? computedCaseRemaining(b.caseInfo) : 0;
      if (aRem !== bRem) return bRem - aRem;
      return a.treatmentName.localeCompare(b.treatmentName, "ar");
    });
  }, [operations, treatmentCases]);

  const defaultKey = groups.find(
    (g) => g.caseInfo && !isTreatmentCaseComplete(g.caseInfo)
  )?.key ?? groups[0]?.key ?? null;

  const [expandedKey, setExpandedKey] = useState<string | null>(null);
  const didInit = useRef(false);

  useEffect(() => {
    if (!didInit.current && defaultKey) {
      setExpandedKey(defaultKey);
      didInit.current = true;
    }
  }, [defaultKey]);

  if (groups.length === 0) return null;

  return (
    <div className="space-y-2">
      <p className="text-xs text-slate-muted mb-2">
        اضغط على اسم الحالة لعرض كل جلساتها وتواريخها
      </p>
      {groups.map((group) => (
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
          treatmentCases={treatmentCases}
          clinicalByOp={clinicalByOp}
          onClinicalSaved={onClinicalSaved}
          allowEdit={allowEdit}
        />
      ))}
    </div>
  );
}
