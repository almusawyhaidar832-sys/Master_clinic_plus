"use client";

import { useMemo, useState } from "react";
import { ChevronDown } from "lucide-react";
import { cn, formatCurrency, formatDate } from "@/lib/utils";
import {
  buildPatientCaseGroups,
  sumCaseGroupsFinancials,
  type PatientCaseGroup,
} from "@/lib/services/patient-case-groups";
import { FINANCIAL_EPSILON } from "@/lib/services/patient-financial-plan";
import type { PatientTreatmentCase } from "@/lib/services/patient-treatment-cases";
import type { PatientOperation } from "@/types";

interface PatientStatementByCaseProps {
  operations: PatientOperation[];
  treatmentCases: PatientTreatmentCase[];
}

function CaseStatusBadge({ group }: { group: PatientCaseGroup }) {
  if (group.isComplete) {
    return (
      <span className="rounded-full bg-emerald-100 px-2.5 py-0.5 text-xs font-semibold text-emerald-800">
        مكتمل
      </span>
    );
  }
  if (group.remaining > FINANCIAL_EPSILON) {
    return (
      <span className="rounded-full bg-amber-100 px-2.5 py-0.5 text-xs font-semibold text-amber-900">
        مستمر — يتطلب دفعات
      </span>
    );
  }
  return (
    <span className="rounded-full bg-slate-100 px-2.5 py-0.5 text-xs font-semibold text-slate-600">
      مستمر
    </span>
  );
}

function CaseFinancialLine({ group }: { group: PatientCaseGroup }) {
  return (
    <p className="text-xs tabular-nums text-slate-muted leading-relaxed">
      الإجمالي:{" "}
      <span className="font-semibold text-slate-text">
        {formatCurrency(group.total)}
      </span>
      {" · "}
      المدفوع:{" "}
      <span className="font-semibold text-primary">
        {formatCurrency(group.totalPaid)}
      </span>
      {" · "}
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

function StatementCaseCard({
  group,
  defaultOpen,
}: {
  group: PatientCaseGroup;
  defaultOpen: boolean;
}) {
  const [open, setOpen] = useState(defaultOpen);
  const paymentSessions = group.sessions.filter(
    (s) => s.amountPaid > FINANCIAL_EPSILON
  );

  return (
    <div
      className={cn(
        "statement-case rounded-xl border overflow-hidden",
        group.isComplete
          ? "border-emerald-200 bg-emerald-50/20"
          : group.remaining > FINANCIAL_EPSILON
            ? "border-debt/30 bg-debt/5"
            : "border-slate-border bg-white"
      )}
    >
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-start justify-between gap-3 px-4 py-3 text-right hover:bg-black/[0.02]"
      >
        <div className="flex min-w-0 flex-1 items-start gap-2">
          <ChevronDown
            className={cn(
              "mt-1 h-5 w-5 shrink-0 text-slate-muted transition-transform",
              open && "rotate-180"
            )}
          />
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <h3 className="font-bold text-slate-text">{group.caseName}</h3>
              <CaseStatusBadge group={group} />
            </div>
            {group.total > 0 && (
              <p className="mt-0.5 text-sm text-slate-muted tabular-nums">
                السعر الكلي: {formatCurrency(group.total)}
              </p>
            )}
            <div className="mt-2">
              <CaseFinancialLine group={group} />
            </div>
          </div>
        </div>
      </button>

      <div
        className={cn(
          "statement-case-body border-t border-slate-border/60 bg-white/80 px-4 py-3",
          !open && "hidden print:block"
        )}
      >
        {paymentSessions.length === 0 ? (
          <p className="text-xs text-slate-muted">
            لا توجد دفعات مسجّلة لهذه الحالة بعد.
          </p>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b text-right text-xs text-slate-muted">
                <th className="pb-2 font-medium">التاريخ</th>
                <th className="pb-2 font-medium">المبلغ المدفوع</th>
              </tr>
            </thead>
            <tbody>
              {paymentSessions.map((session) => (
                <tr
                  key={session.operation.id}
                  className="border-b border-slate-border/30 last:border-0"
                >
                  <td className="py-2 tabular-nums">
                    {session.date ? formatDate(session.date) : "—"}
                  </td>
                  <td className="py-2 font-semibold text-primary tabular-nums">
                    {formatCurrency(session.amountPaid)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}

export function PatientStatementByCase({
  operations,
  treatmentCases,
}: PatientStatementByCaseProps) {
  const caseGroups = useMemo(
    () => buildPatientCaseGroups(operations, treatmentCases),
    [operations, treatmentCases]
  );

  const totals = useMemo(() => {
    const base = sumCaseGroupsFinancials(caseGroups);
    const totalAgreed = caseGroups.reduce((s, g) => s + g.total, 0);
    return { ...base, totalAgreed };
  }, [caseGroups]);

  const defaultOpenKey =
    caseGroups.find((g) => !g.isComplete)?.key ?? caseGroups[0]?.key;

  if (caseGroups.length === 0) {
    return (
      <p className="rounded-lg border border-dashed border-slate-border py-8 text-center text-sm text-slate-muted">
        لا توجد حالات علاج أو جلسات مسجّلة لهذا الكشف.
      </p>
    );
  }

  return (
    <div className="space-y-4">
      <section>
        <h2 className="mb-2 text-base font-semibold">الملخص العام</h2>
        <div className="grid grid-cols-2 gap-2 text-sm sm:grid-cols-4">
          <div className="rounded-lg bg-surface p-3 text-center">
            <p className="text-xs text-slate-muted">عدد الحالات</p>
            <p className="text-lg font-bold">{caseGroups.length}</p>
          </div>
          <div className="rounded-lg bg-surface p-3 text-center">
            <p className="text-xs text-slate-muted">إجمالي المتفق</p>
            <p className="text-lg font-bold tabular-nums">
              {formatCurrency(totals.totalAgreed)}
            </p>
          </div>
          <div className="rounded-lg bg-surface p-3 text-center">
            <p className="text-xs text-slate-muted">إجمالي المدفوع</p>
            <p className="text-lg font-bold text-primary tabular-nums">
              {formatCurrency(totals.totalPaid)}
            </p>
          </div>
          <div
            className={cn(
              "rounded-lg p-3 text-center",
              totals.totalRemaining > FINANCIAL_EPSILON
                ? "bg-debt/30"
                : "bg-emerald-50"
            )}
          >
            <p className="text-xs text-slate-muted">إجمالي المتبقي</p>
            <p
              className={cn(
                "text-lg font-bold tabular-nums",
                totals.totalRemaining > FINANCIAL_EPSILON
                  ? "text-debt-text"
                  : "text-emerald-700"
              )}
            >
              {formatCurrency(totals.totalRemaining)}
            </p>
          </div>
        </div>
      </section>

      <section>
        <h2 className="mb-1 text-base font-semibold">الحالات والدفعات</h2>
        <p className="mb-3 text-xs text-slate-muted">
          كل حالة معزولة — الملخص المالي محسوب من جلساتها فقط
        </p>
        <div className="space-y-3">
          {caseGroups.map((group) => (
            <StatementCaseCard
              key={group.key}
              group={group}
              defaultOpen={group.key === defaultOpenKey}
            />
          ))}
        </div>
      </section>
    </div>
  );
}
