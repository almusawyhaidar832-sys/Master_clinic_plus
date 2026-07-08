"use client";

import { UserCheck } from "lucide-react";
import type { ProfitLedgerLine } from "@/lib/services/profit-deduction-ledger";
import { cn, formatCurrency, formatDate } from "@/lib/utils";

function AssistantPayrollSplit({
  line,
}: {
  line: ProfitLedgerLine & {
    totalAmount: number;
    doctorShare: number;
    clinicShare: number;
    doctorSharePct?: number;
  };
}) {
  return (
    <div className="mt-1.5 grid grid-cols-3 gap-1.5 rounded-lg border border-violet-200/60 bg-violet-50/50 p-2">
      <div className="text-center">
        <p className="text-[10px] text-slate-muted">الإجمالي</p>
        <p className="text-xs font-bold tabular-nums text-slate-text">
          {formatCurrency(line.totalAmount)}
        </p>
      </div>
      <div className="text-center border-x border-violet-200/60">
        <p className="text-[10px] text-slate-muted">من الطبيب</p>
        <p className="text-xs font-bold tabular-nums text-orange-700">
          {formatCurrency(line.doctorShare)}
        </p>
      </div>
      <div className="text-center">
        <p className="text-[10px] text-slate-muted">من العيادة</p>
        <p className="text-xs font-bold tabular-nums text-debt-text">
          {formatCurrency(line.clinicShare)}
        </p>
      </div>
    </div>
  );
}

interface ProfitLedgerLineRowProps {
  line: ProfitLedgerLine;
  className?: string;
}

export function ProfitLedgerLineRow({ line, className }: ProfitLedgerLineRowProps) {
  const hasSplit =
    line.category === "assistant_payroll" &&
    line.totalAmount != null &&
    line.totalAmount > 0 &&
    line.doctorShare != null &&
    line.clinicShare != null;

  const profitImpact = Math.abs(line.amount);
  const showProfitAmount = hasSplit ? line.clinicShare! > 0 : profitImpact > 0;

  return (
    <li
      className={cn(
        "flex items-start justify-between gap-3 px-3 py-2.5 text-sm",
        className
      )}
    >
      <div className="min-w-0 flex-1">
        <p className="font-medium text-slate-text">{line.title}</p>
        {line.subtitle && (
          <p className="mt-0.5 text-xs text-slate-muted">{line.subtitle}</p>
        )}
        {hasSplit && (
          <AssistantPayrollSplit
            line={
              line as ProfitLedgerLine & {
                totalAmount: number;
                doctorShare: number;
                clinicShare: number;
              }
            }
          />
        )}
        {line.actorName && !line.subtitle?.includes(line.actorName) && (
          <p className="mt-1 flex items-center gap-1 text-xs text-primary">
            <UserCheck className="h-3 w-3 shrink-0" />
            المحاسب: {line.actorName}
          </p>
        )}
        <p className="mt-0.5 text-[11px] text-slate-muted/80">
          {formatDate(line.date)}
        </p>
      </div>
      {showProfitAmount ? (
        <div className="shrink-0 text-end">
          <span
            className={cn(
              "font-semibold tabular-nums",
              line.amount >= 0 ? "text-success-text" : "text-debt-text"
            )}
          >
            {line.amount >= 0 ? "+" : "−"}
            {formatCurrency(hasSplit ? line.clinicShare! : profitImpact)}
          </span>
          {hasSplit && (
            <p className="mt-0.5 text-[10px] text-slate-muted">خصم من الربح</p>
          )}
        </div>
      ) : (
        <span className="shrink-0 text-[11px] text-slate-muted">لا خصم من الربح</span>
      )}
    </li>
  );
}
