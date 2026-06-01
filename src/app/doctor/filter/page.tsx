"use client";

import { useState } from "react";
import { Input } from "@/components/ui/Input";
import { Button } from "@/components/ui/Button";
import { Card, CardHeader, CardTitle } from "@/components/ui/Card";
import { Calendar } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { getDoctorForCurrentUser } from "@/lib/clinic-context";
import { formatCurrency, formatDate, todayISO } from "@/lib/utils";
import type { PatientOperation } from "@/types";

export default function DoctorFilterPage() {
  const [from, setFrom] = useState(todayISO());
  const [to, setTo] = useState(todayISO());
  const [operations, setOperations] = useState<PatientOperation[]>([]);
  const [stats, setStats] = useState({
    count: 0,
    totalEarned: 0,
    totalPaid: 0,
  });
  const [applied, setApplied] = useState(false);
  const [loading, setLoading] = useState(false);

  async function applyFilter() {
    setLoading(true);
    const supabase = createClient();
    const doctor = await getDoctorForCurrentUser(supabase);
    if (!doctor) {
      setLoading(false);
      return;
    }

    const { data } = await supabase
      .from("patient_operations")
      .select("*, patient:patients!patient_id(full_name_ar)")
      .eq("doctor_id", doctor.id)
      .gte("operation_date", from)
      .lte("operation_date", to)
      .order("operation_date", { ascending: false });

    const rows = (data as PatientOperation[]) || [];
    setOperations(rows);
    setStats({
      count: rows.length,
      totalEarned: rows.reduce(
        (s, r) => s + Number(r.doctor_share_amount ?? 0),
        0
      ),
      totalPaid: rows.reduce((s, r) => s + Number(r.paid_amount ?? 0), 0),
    });
    setApplied(true);
    setLoading(false);
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2 text-slate-text">
        <Calendar className="h-5 w-5 text-primary" />
        <h2 className="text-lg font-bold">تصفية بالتاريخ</h2>
      </div>

      <Input
        label="من تاريخ"
        type="date"
        value={from}
        onChange={(e) => setFrom(e.target.value)}
        dir="ltr"
        className="text-left"
      />
      <Input
        label="إلى تاريخ"
        type="date"
        value={to}
        onChange={(e) => setTo(e.target.value)}
        dir="ltr"
        className="text-left"
      />
      <Button className="w-full" onClick={applyFilter} disabled={loading}>
        {loading ? "جاري التصفية..." : "تطبيق التصفية"}
      </Button>

      {applied && (
        <>
          <div className="grid grid-cols-3 gap-2 text-center text-sm">
            <Card className="p-3">
              <p className="font-bold text-primary">{stats.count}</p>
              <p className="text-xs text-slate-muted">عمليات</p>
            </Card>
            <Card className="p-3">
              <p className="font-bold text-slate-text">
                {formatCurrency(stats.totalPaid)}
              </p>
              <p className="text-xs text-slate-muted">محصّل</p>
            </Card>
            <Card className="p-3">
              <p className="font-bold text-primary">
                {formatCurrency(stats.totalEarned)}
              </p>
              <p className="text-xs text-slate-muted">حصتك</p>
            </Card>
          </div>

          <Card>
            <CardHeader>
              <CardTitle className="text-base">العمليات</CardTitle>
            </CardHeader>
            {operations.length === 0 ? (
              <p className="text-sm text-slate-muted">لا توجد عمليات في هذه الفترة</p>
            ) : (
              <ul className="space-y-2 text-sm">
                {operations.map((op) => (
                  <li
                    key={op.id}
                    className="flex justify-between border-b border-slate-border/40 py-2"
                  >
                    <span>
                      {(op.patient as { full_name_ar: string })?.full_name_ar} —{" "}
                      {op.operation_type || op.operation_name_ar || "—"}
                      <br />
                      <span className="text-xs text-slate-muted">
                        {formatDate(op.operation_date)}
                      </span>
                    </span>
                    <span className="font-medium text-primary">
                      {formatCurrency(op.doctor_share_amount ?? 0)}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </>
      )}
    </div>
  );
}
