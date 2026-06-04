"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { ChevronDown } from "lucide-react";
import { formatCurrency, formatDate, cn } from "@/lib/utils";
import { formatDoctorDisplayName } from "@/lib/services/clinic-profile";
import { isTreatmentCaseComplete } from "@/lib/services/patient-financial-plan";
import {
  groupOperationsByTreatmentCase,
  type TreatmentCaseSessionGroup,
} from "@/lib/services/group-operations-by-case";
import type { PatientTreatmentCase } from "@/lib/services/patient-treatment-cases";
import { AddSessionClinicalPanel } from "@/components/clinical/AddSessionClinicalPanel";
import { SessionClinicalView } from "@/components/clinical/SessionClinicalView";
import type { ClinicalByOperationId } from "@/lib/clinical/types";
import { hasClinicalData } from "@/lib/clinical/types";
import { opName, type PatientOperation } from "@/types";
import { SessionEditDialog } from "@/components/sessions/SessionEditDialog";

interface PatientSessionsByCaseProps {
  operations: PatientOperation[];
  treatmentCases: PatientTreatmentCase[];
  clinicalByOp: ClinicalByOperationId;
  onClinicalSaved: () => void;
  /** محاسب / طبيب / مالك — يظهر زر تعديل السجل */
  allowEdit?: boolean;
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
  clinical,
  onClinicalSaved,
  allowEdit,
}: {
  op: PatientOperation;
  clinical?: ClinicalByOperationId[string];
  onClinicalSaved: () => void;
  allowEdit?: boolean;
}) {
  const opWithDoctor = op as PatientOperation & {
    doctor?: { full_name_ar: string };
  };
  const isPlan = op.session_kind === "plan" || Number(op.total_amount) > 0;
  const hasClinical = hasClinicalData(clinical);

  return (
    <div className="rounded-lg border border-slate-border/80 bg-white p-3">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="text-xs font-medium text-primary">
            {sessionKindLabel(op)}
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

      <div className="mt-2 border-t border-slate-border/50 pt-2">
        {hasClinical && (
          <SessionClinicalView data={clinical} alwaysShow={false} />
        )}
        <AddSessionClinicalPanel
          operationId={op.id}
          existing={clinical}
          onSaved={onClinicalSaved}
        />
        {allowEdit && (
          <SessionEditDialog operation={op} onSaved={onClinicalSaved} />
        )}
      </div>
    </div>
  );
}

function CaseAccordion({
  group,
  expanded,
  onToggle,
  clinicalByOp,
  onClinicalSaved,
  allowEdit,
}: {
  group: TreatmentCaseSessionGroup;
  expanded: boolean;
  onToggle: () => void;
  clinicalByOp: ClinicalByOperationId;
  onClinicalSaved: () => void;
  allowEdit?: boolean;
}) {
  const complete = group.caseInfo
    ? isTreatmentCaseComplete(group.caseInfo)
    : false;

  return (
    <div
      className={cn(
        "rounded-xl border overflow-hidden",
        complete
          ? "border-emerald-200 bg-emerald-50/30"
          : (group.caseInfo?.remaining_balance ?? 0) > 0
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
              {group.treatmentName}
            </p>
            <p className="text-xs text-slate-muted mt-0.5">
              {group.sessionCount} جلسة
              {group.caseInfo && (
                <>
                  {" "}
                  · السعر الكلي {formatCurrency(group.caseInfo.case_price)}
                </>
              )}
            </p>
          </div>
        </div>
        <div className="shrink-0 text-left">
          {complete ? (
            <span className="text-xs font-semibold text-emerald-700">
              ✓ مكتمل
            </span>
          ) : group.caseInfo ? (
            <>
              <p className="text-xs text-slate-muted">المتبقي</p>
              <p className="text-lg font-bold text-debt-text tabular-nums">
                {formatCurrency(group.caseInfo.remaining_balance)}
              </p>
            </>
          ) : null}
        </div>
      </button>

      {expanded && (
        <div className="border-t border-slate-border/60 px-3 pb-3 pt-2 space-y-2 bg-white/60">
          {group.sessions.map((op) => (
            <SessionRow
              key={op.id}
              op={op}
              clinical={clinicalByOp[op.id]}
              onClinicalSaved={onClinicalSaved}
              allowEdit={allowEdit}
            />
          ))}
        </div>
      )}
    </div>
  );
}

export function PatientSessionsByCase({
  operations,
  treatmentCases,
  clinicalByOp,
  onClinicalSaved,
  allowEdit = false,
}: PatientSessionsByCaseProps) {
  const groups = useMemo(
    () => groupOperationsByTreatmentCase(operations, treatmentCases),
    [operations, treatmentCases]
  );

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
          clinicalByOp={clinicalByOp}
          onClinicalSaved={onClinicalSaved}
          allowEdit={allowEdit}
        />
      ))}
    </div>
  );
}
