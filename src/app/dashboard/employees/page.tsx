"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import {
  Pencil,
  RefreshCw,
  UserX,
  Users,
  History,
  BadgeDollarSign,
  Calculator,
  UserRound,
  Stethoscope,
} from "lucide-react";
import { Alert } from "@/components/ui/Alert";
import { Button } from "@/components/ui/Button";
import { PageHeader } from "@/components/ui/PageHeader";
import { StatTile } from "@/components/ui/StatTile";
import { useLanguage } from "@/contexts/LanguageContext";
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
  assistant: "bg-primary-50 text-primary-700 ring-primary-200",
  general: "bg-surface text-slate-muted ring-slate-border",
  accountant: "bg-royal-50 text-royal-700 ring-royal-200",
  doctor_salary: "bg-premium-50 text-premium-700 ring-premium-200",
};

export default function EmployeesPage() {
  const { bi } = useLanguage();
  const { clinicId, clinicName, source: clinicSource } = useActiveClinicId();
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
      const list = await fetchActivePayrollPersonsViaApi(clinicId);
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
      <PageHeader
        eyebrow={bi("إدارة العيادة", "Clinic management")}
        title="إدارة رواتب الموظفين"
        icon={BadgeDollarSign}
        className="mb-0"
        subtitle={
          <>
            تعديل الراتب أو إيقاف أي عامل — محاسبون، مساعدون، موظفو عيادة
            {clinicName ? (
              <>
                {" "}
                · <strong className="text-slate-text">{clinicName}</strong>
                {clinicSource === "developer" ? " (دخول نيابة)" : ""}
              </>
            ) : null}
          </>
        }
        actions={
          <>
            <Link href="/dashboard/payroll-history" className="mc-btn-soft">
              <History className="h-4 w-4" />
              سجل الصرف التاريخي
            </Link>
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
          </>
        }
      />

      {!loading && persons.length > 0 && (
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          <StatTile label="محاسبون" value={byCategory.accountant.length} icon={Calculator} tone="royal" />
          <StatTile label="مساعدون" value={byCategory.assistant.length} icon={UserRound} tone="navy" />
          <StatTile label="موظفو عيادة" value={byCategory.general.length} icon={Users} tone="muted" />
          <StatTile label="أطباء راتب" value={byCategory.doctor_salary.length} icon={Stethoscope} tone="gold" />
        </div>
      )}

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
        <div className="space-y-2">
          {[0, 1, 2, 3].map((i) => (
            <div key={i} className="mc-skeleton h-14 rounded-2xl" />
          ))}
        </div>
      ) : persons.length === 0 ? (
        <div className="mc-panel flex flex-col items-center gap-3 px-6 py-14 text-center">
          <span className="mc-icon-tile h-14 w-14">
            <Users className="h-7 w-7" />
          </span>
          <p className="text-sm font-medium text-slate-muted">لا يوجد عاملون نشطون بعد</p>
          <Link href="/dashboard/salary" className="mc-btn-soft">
            أضف موظفاً من صفحة الرواتب ←
          </Link>
        </div>
      ) : (
        <>
          <div className="space-y-3 md:hidden">
            {persons.map((p) => (
              <div
                key={`${p.category}-${p.id}`}
                className="mc-panel"
              >
                <div className="flex items-start gap-3 p-4">
                  <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-mc-pearl text-base font-extrabold text-[#0b1f3a] ring-1 ring-inset ring-premium-300/60">
                    {p.full_name_ar.trim().charAt(0)}
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="truncate font-bold text-slate-text">{p.full_name_ar}</p>
                    <p className="text-xs text-slate-muted">{p.job_title_ar}</p>
                    <p className="mt-1.5 text-lg font-black tabular-nums text-slate-text">
                      {formatCurrency(p.base_salary)}
                    </p>
                  </div>
                  <span
                    className={`shrink-0 rounded-full px-2 py-0.5 text-[11px] font-semibold ring-1 ring-inset ${CATEGORY_STYLES[p.category]}`}
                  >
                    {payrollCategoryLabel(p.category)}
                  </span>
                </div>
                <div className="flex gap-2 border-t border-slate-border bg-surface px-4 py-2.5">
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
                    className="flex-1 text-warning-text hover:border-warning-border hover:bg-warning"
                    onClick={() => setDeactivating(p)}
                  >
                    <UserX className="h-4 w-4" />
                    إيقاف
                  </Button>
                </div>
              </div>
            ))}
          </div>

          <section className="mc-panel hidden md:block">
            <div className="mc-panel-head">
              <h3 className="mc-panel-title">
                <Users />
                جميع العاملين ({persons.length})
              </h3>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full min-w-[720px] text-sm">
                <thead>
                  <tr className="text-xs text-slate-muted">
                    <th className="px-5 py-3 text-start font-semibold">الاسم</th>
                    <th className="px-3 py-3 text-start font-semibold">النوع</th>
                    <th className="px-3 py-3 text-start font-semibold">الوظيفة</th>
                    <th className="px-3 py-3 text-start font-semibold">الراتب</th>
                    <th className="px-3 py-3 text-start font-semibold">إجراءات</th>
                  </tr>
                </thead>
                <tbody>
                  {persons.map((p) => (
                    <tr
                      key={`${p.category}-${p.id}`}
                      className="border-b border-slate-border last:border-0"
                    >
                      <td className="px-5 py-3">
                        <div className="flex items-center gap-3">
                          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-mc-pearl text-sm font-bold text-[#0b1f3a] ring-1 ring-inset ring-premium-200">
                            {p.full_name_ar.trim().charAt(0)}
                          </span>
                          <span className="font-semibold text-slate-text">{p.full_name_ar}</span>
                        </div>
                      </td>
                      <td className="px-3 py-3">
                        <span
                          className={`rounded-full px-2.5 py-0.5 text-xs font-semibold ring-1 ring-inset ${CATEGORY_STYLES[p.category]}`}
                        >
                          {payrollCategoryLabel(p.category)}
                        </span>
                      </td>
                      <td className="px-3 py-3 text-slate-muted">{p.job_title_ar}</td>
                      <td className="px-3 py-3 font-bold tabular-nums text-slate-text">
                        {formatCurrency(p.base_salary)}
                      </td>
                      <td className="px-3 py-3">
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
                            className="text-warning-text hover:border-warning-border hover:bg-warning"
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
          </section>
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
