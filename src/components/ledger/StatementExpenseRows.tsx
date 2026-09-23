"use client";

import { formatCurrency, formatDate } from "@/lib/utils";
import { cn } from "@/lib/utils";
import type {
  DailyClinicExpenseLine,
  DailyDoctorExpenseLine,
} from "@/lib/ledger/daily-statement-expenses";
import { Receipt, Stethoscope, UserCheck } from "lucide-react";

function isLabExpense(text: string): boolean {
  return /مختبر|lab/i.test(text);
}

const ROW_CLASS =
  "flex flex-col gap-3 border-b border-slate-border px-5 py-3.5 last:border-b-0 transition-colors hover:bg-surface sm:flex-row sm:items-center sm:justify-between";

export function DoctorExpenseRow({
  line,
  forDoctor = false,
}: {
  line: DailyDoctorExpenseLine;
  /** عرض للطبيب: حصته فقط حسب النسبة — بدون صرفيات العيادة العامة */
  forDoctor?: boolean;
}) {
  const isLab = isLabExpense(line.description);
  const doctorPct = Math.round(line.percentageSplit);

  return (
    <div className={ROW_CLASS}>
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <span
            className={cn(
              "mc-kpi__icon h-7 w-7 rounded-lg",
              isLab ? "mc-tone-royal" : "mc-tone-danger"
            )}
          >
            <Stethoscope className="h-3.5 w-3.5" />
          </span>
          <p className="font-semibold text-slate-text">{line.description}</p>
          <span
            className={cn(
              "inline-flex rounded-full border px-2 py-0.5 text-[11px] font-semibold",
              isLab
                ? "border-royal-200 bg-royal-50 text-royal-600"
                : "border-debt-border bg-debt text-debt-text"
            )}
          >
            {isLab ? "مختبر" : "فاتورة صرفية"}
          </span>
        </div>
        <p className="mt-1 text-xs text-slate-muted">
          {formatDate(line.expenseDate)}
          {forDoctor ? (
            <>
              {" "}
              · نسبتك {doctorPct}% من {formatCurrency(line.totalAmount)}
            </>
          ) : null}
          {!forDoctor && line.actorName ? ` · المحاسب: ${line.actorName}` : ""}
        </p>
        {forDoctor && line.actorName && (
          <p className="mt-0.5 text-[11px] text-slate-muted">
            سجّلها المحاسب: {line.actorName}
          </p>
        )}
      </div>
      <div className="flex flex-wrap items-center gap-x-5 gap-y-3 sm:justify-end">
        {!forDoctor && (
          <div className="text-end">
            <p className="text-[11px] font-medium text-slate-muted">إجمالي الفاتورة</p>
            <p className="font-bold tabular-nums text-slate-text">
              {formatCurrency(line.totalAmount)}
            </p>
          </div>
        )}
        <div className="text-end">
          <p className="text-[11px] font-medium text-slate-muted">
            {forDoctor
              ? `يُخصم منك (${doctorPct}%)`
              : "يُخصم من الطبيب"}
          </p>
          <p className="font-bold tabular-nums text-debt-text">
            − {formatCurrency(line.doctorShare)}
          </p>
        </div>
        {!forDoctor && line.clinicShare > 0 && (
          <div className="text-end">
            <p className="text-[11px] font-medium text-slate-muted">حصة العيادة</p>
            <p className="font-bold tabular-nums text-warning-text">
              − {formatCurrency(line.clinicShare)}
            </p>
          </div>
        )}
      </div>
    </div>
  );
}

export function ClinicExpenseRow({ line }: { line: DailyClinicExpenseLine }) {
  const isLab = isLabExpense(`${line.description} ${line.categoryName ?? ""}`);

  return (
    <div className={ROW_CLASS}>
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <span
            className={cn(
              "mc-kpi__icon h-7 w-7 rounded-lg",
              isLab ? "mc-tone-royal" : "mc-tone-muted"
            )}
          >
            <Receipt className="h-3.5 w-3.5" />
          </span>
          <p className="font-semibold text-slate-text">{line.description}</p>
          {line.categoryName && (
            <span className="inline-flex rounded-full border border-slate-border bg-surface px-2 py-0.5 text-[11px] font-medium text-slate-text">
              {line.categoryName}
            </span>
          )}
          <span className="inline-flex rounded-full border border-premium-200 bg-premium-50 px-2 py-0.5 text-[10px] font-semibold text-premium-600">
            للإدارة فقط
          </span>
        </div>
        <p className="mt-1 flex flex-wrap items-center gap-1 text-xs text-slate-muted">
          <span>{formatDate(line.expenseDate)}</span>
          {line.actorName && (
            <>
              <span>·</span>
              <UserCheck className="h-3 w-3" />
              <span>المحاسب: {line.actorName}</span>
            </>
          )}
        </p>
      </div>
      <div className="text-end">
        <p className="text-[11px] font-medium text-slate-muted">خصم من ربح العيادة</p>
        <p className="font-bold tabular-nums text-debt-text">
          − {formatCurrency(line.amount)}
        </p>
      </div>
    </div>
  );
}

export function StatementExpenseSection({
  title,
  children,
  tone = "orange",
}: {
  title: string;
  children: React.ReactNode;
  tone?: "orange" | "slate" | "violet";
}) {
  const toneClass =
    tone === "violet"
      ? "bg-royal-50 text-royal-600"
      : tone === "slate"
        ? "bg-surface text-slate-text"
        : "bg-debt text-debt-text";

  return (
    <div>
      <p
        className={cn(
          "flex items-center gap-2 border-y border-slate-border px-5 py-2 text-xs font-bold",
          toneClass
        )}
      >
        <span className="h-1.5 w-1.5 rounded-full bg-current" aria-hidden />
        {title}
      </p>
      {children}
    </div>
  );
}
