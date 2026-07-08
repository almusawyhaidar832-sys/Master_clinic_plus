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
    <div
      className={cn(
        "flex flex-col gap-3 border-b border-slate-border/60 px-4 py-3 last:border-b-0 sm:flex-row sm:items-center sm:justify-between",
        isLab ? "bg-violet-50/25" : "bg-orange-50/20"
      )}
    >
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <Stethoscope className="h-4 w-4 shrink-0 text-orange-600" />
          <p className="font-semibold text-slate-text">{line.description}</p>
          <span
            className={cn(
              "inline-flex rounded-full px-2 py-0.5 text-[11px] font-medium",
              isLab
                ? "bg-violet-100 text-violet-900"
                : "bg-orange-100 text-orange-900"
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
      <div className="flex flex-wrap items-center gap-4 sm:justify-end">
        {!forDoctor && (
          <div className="text-right">
            <p className="text-[11px] text-slate-muted">إجمالي الفاتورة</p>
            <p className="font-bold tabular-nums text-slate-text">
              {formatCurrency(line.totalAmount)}
            </p>
          </div>
        )}
        <div className="text-right">
          <p className="text-[11px] text-slate-muted">
            {forDoctor
              ? `يُخصم منك (${doctorPct}%)`
              : "يُخصم من الطبيب"}
          </p>
          <p className="font-bold tabular-nums text-red-700">
            − {formatCurrency(line.doctorShare)}
          </p>
        </div>
        {!forDoctor && line.clinicShare > 0 && (
          <div className="text-right">
            <p className="text-[11px] text-slate-muted">حصة العيادة</p>
            <p className="font-bold tabular-nums text-amber-800">
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
    <div
      className={cn(
        "flex flex-col gap-3 border-b border-slate-border/60 px-4 py-3 last:border-b-0 sm:flex-row sm:items-center sm:justify-between",
        isLab ? "bg-violet-50/30" : "bg-slate-50/40"
      )}
    >
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <Receipt className="h-4 w-4 shrink-0 text-slate-600" />
          <p className="font-semibold text-slate-text">{line.description}</p>
          {line.categoryName && (
            <span className="inline-flex rounded-full bg-slate-100 px-2 py-0.5 text-[11px] font-medium text-slate-700">
              {line.categoryName}
            </span>
          )}
          <span className="inline-flex rounded-full bg-slate-200/80 px-2 py-0.5 text-[10px] font-medium text-slate-600">
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
      <div className="text-right">
        <p className="text-[11px] text-slate-muted">خصم من ربح العيادة</p>
        <p className="font-bold tabular-nums text-red-700">
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
      ? "border-violet-200/60 bg-violet-50/60 text-violet-900"
      : tone === "slate"
        ? "border-slate-200/60 bg-slate-50/60 text-slate-800"
        : "border-orange-200/60 bg-orange-50/60 text-orange-900";

  return (
    <div className={cn("border-t", toneClass.split(" ")[0])}>
      <p className={cn("px-4 py-2 text-xs font-semibold", toneClass)}>
        {title}
      </p>
      {children}
    </div>
  );
}
