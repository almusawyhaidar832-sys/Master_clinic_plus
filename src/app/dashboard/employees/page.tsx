"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { Pencil, RefreshCw, UserX, Users } from "lucide-react";
import { Alert } from "@/components/ui/Alert";
import { Button } from "@/components/ui/Button";
import { Card, CardHeader, CardTitle } from "@/components/ui/Card";
import { DeactivateEmployeeDialog } from "@/components/payroll/DeactivateEmployeeDialog";
import { EditEmployeeSalaryModal } from "@/components/payroll/EditEmployeeSalaryModal";
import { useActiveClinicId } from "@/hooks/useActiveClinicId";
import {
  fetchActivePayrollPersonsViaApi,
  payrollCategoryLabel,
  type PayrollPerson,
} from "@/lib/services/payroll-persons";
import { formatCurrency } from "@/lib/utils";

const CATEGORY_STYLES = {
  assistant: "bg-teal-100 text-teal-800",
  general: "bg-slate-100 text-slate-700",
  accountant: "bg-violet-100 text-violet-800",
  doctor_salary: "bg-amber-100 text-amber-900",
};

export default function EmployeesPage() {
  const { clinicId } = useActiveClinicId();
  const [persons, setPersons] = useState<PayrollPerson[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState<PayrollPerson | null>(null);
  const [deactivating, setDeactivating] = useState<PayrollPerson | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!clinicId) {
      setPersons([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const list = await fetchActivePayrollPersonsViaApi();
      setPersons(list);
    } catch (e) {
      setError(e instanceof Error ? e.message : "تعذر تحميل القائمة");
      setPersons([]);
    } finally {
      setLoading(false);
    }
  }, [clinicId]);

  useEffect(() => {
    load();
  }, [load]);

  const byCategory = {
    accountant: persons.filter((p) => p.category === "accountant"),
    assistant: persons.filter((p) => p.category === "assistant"),
    general: persons.filter((p) => p.category === "general"),
    doctor_salary: persons.filter((p) => p.category === "doctor_salary"),
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h2 className="text-2xl font-bold text-slate-text">إدارة رواتب الموظفين</h2>
          <p className="text-slate-muted">
            تعديل الراتب أو إيقاف أي عامل — محاسبون، مساعدون، موظفو خدمات
          </p>
        </div>
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() => void load()}
          disabled={loading}
        >
          <RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} />
          تحديث
        </Button>
      </div>

      {successMsg && <Alert variant="success">{successMsg}</Alert>}

      {error && (
        <Alert variant="error">
          {error}
          <p className="mt-2 text-xs">
            تأكد من تشغيل SQL:{" "}
            <code dir="ltr">supabase/scripts/07-profile-salary-fields.sql</code>
          </p>
        </Alert>
      )}

      {loading ? (
        <p className="text-center text-sm text-slate-muted">جاري التحميل...</p>
      ) : persons.length === 0 ? (
        <Card>
          <div className="flex flex-col items-center gap-3 py-12 text-center">
            <Users className="h-10 w-10 text-slate-300" />
            <p className="text-slate-muted">لا يوجد عاملون نشطون بعد</p>
            <Link
              href="/dashboard/salary"
              className="text-sm font-medium text-primary hover:underline"
            >
              أضف موظفاً من صفحة الرواتب ←
            </Link>
          </div>
        </Card>
      ) : (
        <>
          <div className="space-y-3 md:hidden">
            {persons.map((p) => (
              <div
                key={`${p.category}-${p.id}`}
                className="rounded-xl border border-slate-border bg-white p-4 shadow-sm"
              >
                <div className="mb-2 flex items-start justify-between gap-2">
                  <div>
                    <p className="font-bold text-slate-text">{p.full_name_ar}</p>
                    <p className="text-xs text-slate-muted">{p.job_title_ar}</p>
                  </div>
                  <span
                    className={`shrink-0 rounded-full px-2 py-0.5 text-xs font-bold ${CATEGORY_STYLES[p.category]}`}
                  >
                    {payrollCategoryLabel(p.category)}
                  </span>
                </div>
                <p className="mb-3 text-lg font-bold text-primary">
                  {formatCurrency(p.base_salary)}
                </p>
                <div className="flex gap-2">
                  <Button
                    type="button"
                    size="sm"
                    className="flex-1"
                    onClick={() => setEditing(p)}
                  >
                    <Pencil className="h-4 w-4" />
                    تعديل الراتب
                  </Button>
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    className="flex-1 border-amber-300 text-amber-800"
                    onClick={() => setDeactivating(p)}
                  >
                    <UserX className="h-4 w-4" />
                    إيقاف
                  </Button>
                </div>
              </div>
            ))}
          </div>

          <Card className="hidden md:block">
            <CardHeader>
              <CardTitle>جميع العاملين ({persons.length})</CardTitle>
            </CardHeader>
            <div className="overflow-x-auto">
              <table className="w-full min-w-[720px] text-sm">
                <thead>
                  <tr className="border-b text-right text-xs text-slate-muted">
                    <th className="py-2 pe-2">الاسم</th>
                    <th className="py-2 pe-2">النوع</th>
                    <th className="py-2 pe-2">الوظيفة</th>
                    <th className="py-2 pe-2">الراتب</th>
                    <th className="py-2">إجراءات</th>
                  </tr>
                </thead>
                <tbody>
                  {persons.map((p) => (
                    <tr
                      key={`${p.category}-${p.id}`}
                      className="border-b border-slate-border/30"
                    >
                      <td className="py-3 pe-2 font-medium">{p.full_name_ar}</td>
                      <td className="py-3 pe-2">
                        <span
                          className={`rounded-full px-2 py-0.5 text-xs font-bold ${CATEGORY_STYLES[p.category]}`}
                        >
                          {payrollCategoryLabel(p.category)}
                        </span>
                      </td>
                      <td className="py-3 pe-2 text-slate-600">{p.job_title_ar}</td>
                      <td className="py-3 pe-2 font-semibold text-primary">
                        {formatCurrency(p.base_salary)}
                      </td>
                      <td className="py-3">
                        <div className="flex flex-wrap gap-2">
                          <Button
                            type="button"
                            size="sm"
                            variant="outline"
                            onClick={() => setEditing(p)}
                          >
                            <Pencil className="h-3.5 w-3.5" />
                            تعديل الراتب
                          </Button>
                          <Button
                            type="button"
                            size="sm"
                            variant="outline"
                            onClick={() => setDeactivating(p)}
                            className="border-amber-300 text-amber-800 hover:bg-amber-50"
                          >
                            <UserX className="h-3.5 w-3.5" />
                            إيقاف الموظف
                          </Button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div className="mt-4 flex flex-wrap gap-4 border-t border-slate-border/40 px-4 pb-4 pt-4 text-xs text-slate-muted">
              <span>محاسبون: {byCategory.accountant.length}</span>
              <span>مساعدون: {byCategory.assistant.length}</span>
              <span>خدمات: {byCategory.general.length}</span>
              <span>أطباء راتب: {byCategory.doctor_salary.length}</span>
            </div>
          </Card>
        </>
      )}

      {editing && (
        <EditEmployeeSalaryModal
          person={editing}
          onClose={() => setEditing(null)}
          onSaved={() => {
            setSuccessMsg(`تم تحديث راتب ${editing.full_name_ar}`);
            void load();
          }}
        />
      )}

      {deactivating && (
        <DeactivateEmployeeDialog
          person={deactivating}
          onClose={() => setDeactivating(null)}
          onDeactivated={() => {
            setSuccessMsg(`تم إيقاف ${deactivating.full_name_ar}`);
            void load();
          }}
        />
      )}
    </div>
  );
}
