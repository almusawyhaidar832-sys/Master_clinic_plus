"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { Card, CardHeader, CardTitle } from "@/components/ui/Card";
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
      <Card className={embedded ? "border-amber-200/80" : undefined}>
        <div className="h-24 animate-pulse rounded-lg bg-surface" />
      </Card>
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
    <Card className={cn("overflow-hidden p-0", embedded && "border-amber-200/80")}>
      <CardHeader className="border-b border-amber-200/60 bg-amber-50/40">
        <CardTitle className="flex flex-wrap items-center justify-between gap-2 text-base text-amber-950">
          <span className="inline-flex items-center gap-2">
            <AlertCircle className="h-4 w-4" />
            قائمة المديونين — تفصيل الذمم
          </span>
          <span className="text-sm font-bold tabular-nums text-debt-text">
            {debtors.length} مراجع · {formatCurrency(totalDebt)}
          </span>
        </CardTitle>
        <p className="mt-1 text-xs text-amber-900/80">
          كل دين مسجّل صراحةً — ليس من سعر كلي وهمي
        </p>
      </CardHeader>

      <div className="divide-y divide-slate-border/60">
        {debtors.map((debtor) => (
          <div
            key={debtor.patientId}
            className="flex flex-col gap-3 px-4 py-3 sm:flex-row sm:items-start sm:justify-between"
          >
            <div className="min-w-0 flex-1 space-y-2">
              <div className="flex flex-wrap items-center gap-2">
                <p className="font-semibold text-slate-text">
                  {debtor.patientName}
                </p>
                <span className="inline-flex rounded-full bg-orange-100 px-2 py-0.5 text-[11px] font-bold text-orange-900 ring-1 ring-orange-300">
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
              <div className="text-right">
                <p className="text-[11px] text-slate-muted">إجمالي الدين</p>
                <p className="text-lg font-black tabular-nums text-debt-text">
                  {formatCurrency(debtor.totalDebt)}
                </p>
              </div>
              <div className="flex gap-2">
                <Link
                  href={`/dashboard/patients/${debtor.patientId}`}
                  className="rounded-lg border border-slate-border px-3 py-1.5 text-xs font-medium text-slate-text hover:bg-surface"
                >
                  الملف
                </Link>
                <Link
                  href={buildLedgerPayUrl({
                    patientId: debtor.patientId,
                    patientName: debtor.patientName,
                    patientPhone: debtor.patientPhone,
                  })}
                  className="inline-flex items-center gap-1 rounded-lg bg-primary px-3 py-1.5 text-xs font-semibold text-white hover:bg-primary/90"
                >
                  <Receipt className="h-3.5 w-3.5" />
                  تحصيل
                </Link>
              </div>
            </div>
          </div>
        ))}
      </div>
    </Card>
  );
}
