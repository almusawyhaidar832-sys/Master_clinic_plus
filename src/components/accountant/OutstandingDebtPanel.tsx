"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { Alert } from "@/components/ui/Alert";
import { createClient } from "@/lib/supabase/client";
import {
  fetchClinicDebtors,
  type ClinicDebtorRow,
} from "@/lib/ledger/outstanding-debt";
import { buildLedgerPayUrl } from "@/lib/ledger/navigation";
import { formatCurrency, cn } from "@/lib/utils";
import { AlertCircle, Receipt } from "lucide-react";

export function OutstandingDebtPanel({
  clinicId,
  doctorId,
  embedded = false,
}: {
  clinicId: string | null;
  doctorId?: string;
  embedded?: boolean;
}) {
  const [debtors, setDebtors] = useState<ClinicDebtorRow[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    if (!clinicId) {
      setDebtors([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    const supabase = createClient();
    const rows = await fetchClinicDebtors(supabase, clinicId, {
      doctorId: doctorId || undefined,
    });
    setDebtors(rows);
    setLoading(false);
  }, [clinicId, doctorId]);

  useEffect(() => {
    void load();
  }, [load]);

  const totalDebt = debtors.reduce((s, d) => s + d.totalDebt, 0);

  if (loading) {
    return (
      <div className="mc-panel p-5">
        <div className="mc-skeleton h-24 rounded-xl" />
      </div>
    );
  }

  if (debtors.length === 0) {
    return (
      <Alert variant="success">
        لا يوجد مراجعون مديونون حالياً — الديون تظهر هنا عند تسجيلها من «نوع التسجيل: دين».
      </Alert>
    );
  }

  return (
    <div className={cn("mc-panel", embedded && "shadow-none")}>
      <div className="mc-panel-head">
        <div className="flex min-w-0 items-center gap-3">
          <span className="mc-kpi__icon mc-tone-danger h-10 w-10">
            <AlertCircle className="h-5 w-5" />
          </span>
          <div className="min-w-0">
            <p className="text-[15px] font-bold text-slate-text">
              قائمة المديونين — تفصيل الذمم
            </p>
            <p className="mt-0.5 text-xs text-slate-muted">
              كل دين مسجّل صراحةً — ليس من سعر كلي وهمي
            </p>
          </div>
        </div>
        <span className="rounded-full border border-debt-border bg-debt px-3 py-1 text-sm font-bold tabular-nums text-debt-text">
          {debtors.length} مراجع · {formatCurrency(totalDebt)}
        </span>
      </div>

      <div className="divide-y divide-slate-border">
        {debtors.map((debtor) => (
          <div
            key={debtor.patientId}
            className="flex flex-col gap-3 px-5 py-4 transition-colors hover:bg-surface sm:flex-row sm:items-start sm:justify-between"
          >
            <div className="min-w-0 flex-1 space-y-2">
              <div className="flex flex-wrap items-center gap-2">
                <p className="font-bold text-slate-text">
                  {debtor.patientName}
                </p>
                <span className="inline-flex rounded-full border border-warning-border bg-warning px-2 py-0.5 text-[11px] font-bold text-warning-text">
                  مديون
                </span>
              </div>
              {debtor.patientPhone && (
                <p className="text-xs text-slate-muted" dir="ltr">
                  {debtor.patientPhone}
                </p>
              )}
              <ul className="space-y-1 text-xs text-slate-muted">
                {debtor.cases.map((c) => (
                  <li key={c.caseId} className="tabular-nums">
                    <span className="font-medium text-slate-text">
                      {c.treatmentName}
                    </span>
                    {" — "}
                    دين:{" "}
                    <span className="font-bold text-debt-text">
                      {formatCurrency(c.debt)}
                    </span>
                    {c.totalPaid > 0 && (
                      <>
                        {" · "}
                        مدفوع: {formatCurrency(c.totalPaid)}
                      </>
                    )}
                  </li>
                ))}
              </ul>
            </div>

            <div className="flex shrink-0 flex-col items-end gap-2">
              <div className="text-end">
                <p className="text-[11px] font-medium text-slate-muted">إجمالي الدين</p>
                <p className="text-lg font-black tabular-nums text-debt-text">
                  {formatCurrency(debtor.totalDebt)}
                </p>
              </div>
              <div className="flex gap-2">
                <Link
                  href={`/dashboard/patients/${debtor.patientId}`}
                  className="mc-btn-soft px-3 py-1.5 text-xs"
                >
                  الملف
                </Link>
                <Link
                  href={buildLedgerPayUrl({
                    patientId: debtor.patientId,
                    patientName: debtor.patientName,
                    patientPhone: debtor.patientPhone,
                  })}
                  className="mc-btn-navy px-3 py-1.5 text-xs"
                >
                  <Receipt className="h-3.5 w-3.5" />
                  تحصيل
                </Link>
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
