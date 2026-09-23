"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { fetchAllRows } from "@/lib/supabase/fetch-all-rows";
import { getActiveClinicId } from "@/lib/clinic-context";
import { PageHeader } from "@/components/ui/PageHeader";
import { StatTile } from "@/components/ui/StatTile";
import { useLanguage } from "@/contexts/LanguageContext";
import { AddDoctorExpenseModal } from "@/components/doctor-expenses/AddDoctorExpenseModal";
import { DoctorExpenseInvoiceViewer } from "@/components/doctor-expenses/DoctorExpenseInvoiceViewer";
import { DoctorSalaryAdjustmentsPanel } from "@/components/expenses/DoctorSalaryAdjustmentsPanel";
import { DoctorSalaryPayoutPanel } from "@/components/expenses/DoctorSalaryPayoutPanel";
import { GeneralExpensesPanel } from "@/components/expenses/GeneralExpensesPanel";
import { Alert } from "@/components/ui/Alert";
import { authPortalHeaders } from "@/lib/auth/api-portal";
import { useClinicSync } from "@/hooks/useClinicSync";
import { notifyFinancialMutation } from "@/lib/sync/mutation-notify";
import { notifyClinicProfitRefresh } from "@/lib/services/clinic-profit";
import { cn, formatCurrency, formatDate } from "@/lib/utils";
import {
  Receipt,
  Plus,
  RefreshCw,
  Stethoscope,
  Trash2,
  Zap,
  Banknote,
  Wallet,
  FileText,
  TrendingDown,
} from "lucide-react";

const VALID_TABS = [
  "clinic_expenses",
  "doctor_salary",
  "general_expenses",
] as const;

type ExpensesTab = (typeof VALID_TABS)[number];

function parseTab(value: string | null): ExpensesTab {
  if (value && (VALID_TABS as readonly string[]).includes(value)) {
    return value as ExpensesTab;
  }
  return "clinic_expenses";
}

interface DoctorOption {
  id: string;
  full_name_ar: string;
}

interface DoctorExpenseRow {
  id: string;
  doctor_id: string;
  amount: number;
  percentage_split: number;
  expense_date: string;
  description_ar: string | null;
  invoice_file_name: string | null;
  invoice_storage_path: string | null;
  doctor?: { full_name_ar: string } | null;
}

/** شكل الصف كما يصل من Supabase — علاقة (doctor:doctors) قد تُرجع مصفوفة
 * بدل كائن واحد حسب كيفية استنتاج PostgREST للعلاقة */
type RawDoctorExpenseRow = Omit<DoctorExpenseRow, "doctor"> & {
  doctor?: { full_name_ar: string } | { full_name_ar: string }[] | null;
};

/** بدون هذا التطبيع يظهر اسم الطبيب دائماً "طبيب" العام بدل الاسم الفعلي */
function normalizeExpenseDoctor(row: RawDoctorExpenseRow): DoctorExpenseRow {
  const doctor = Array.isArray(row.doctor) ? row.doctor[0] : row.doctor;
  return { ...row, doctor: doctor ?? null };
}

const TAB_ITEMS: {
  id: ExpensesTab;
  label: string;
  icon: typeof Receipt;
  accent: string;
}[] = [
  {
    id: "clinic_expenses",
    label: "فواتير وصرفيات الأطباء",
    icon: Receipt,
    accent: "mc-tab-accent-clinic",
  },
  {
    id: "doctor_salary",
    label: "صرف رواتب الأطباء",
    icon: Banknote,
    accent: "mc-tab-accent-salary",
  },
  {
    id: "general_expenses",
    label: "صرفيات العيادة",
    icon: Wallet,
    accent: "mc-tab-accent-general",
  },
];

export default function DoctorExpensesPage() {
  const supabase = createClient();
  const router = useRouter();
  const searchParams = useSearchParams();
  const { bi } = useLanguage();

  const [clinicId, setClinicId] = useState<string | null>(null);
  const [doctors, setDoctors] = useState<DoctorOption[]>([]);
  const [expenses, setExpenses] = useState<DoctorExpenseRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [showAdd, setShowAdd] = useState(false);
  const [deductedIds, setDeductedIds] = useState<Set<string>>(new Set());
  const [actionId, setActionId] = useState<string | null>(null);
  const [actionError, setActionError] = useState("");
  const [activeTab, setActiveTab] = useState<ExpensesTab>(() =>
    parseTab(searchParams.get("tab"))
  );

  const patientsHistoryHref = "/dashboard/patients/history";

  const selectTab = useCallback(
    (tab: ExpensesTab) => {
      setActiveTab(tab);
      router.replace(`/dashboard/doctor-expenses?tab=${tab}`, { scroll: false });
    },
    [router]
  );

  useEffect(() => {
    const tab = parseTab(searchParams.get("tab"));
    setActiveTab(tab);
  }, [searchParams]);

  function handleExpenseSaved() {
    void load();
    router.push(patientsHistoryHref);
  }

  function handleSalaryPayout() {
    router.push(patientsHistoryHref);
  }

  function handleGeneralExpense() {
    /* صرفيات العيادة — لا تُؤرشَف في السجل التاريخي */
  }

  const load = useCallback(async () => {
    setLoading(true);
    const active = await getActiveClinicId(supabase);
    if (!active?.clinicId) {
      setClinicId(null);
      setExpenses([]);
      setDoctors([]);
      setLoading(false);
      return;
    }

    setClinicId(active.clinicId);

    const [docsRes, expResFirst, txRes] = await Promise.all([
      supabase
        .from("doctors")
        .select("id, full_name_ar")
        .eq("clinic_id", active.clinicId)
        .eq("is_active", true)
        .order("full_name_ar"),
      supabase
        .from("doctor_expenses")
        .select(
          `id, doctor_id, amount, percentage_split, expense_date, description_ar,
           invoice_file_name, invoice_storage_path,
           doctor:doctors ( full_name_ar )`
        )
        .eq("clinic_id", active.clinicId)
        .eq("archived_to_history", false)
        .order("expense_date", { ascending: false })
        .limit(100),
      fetchAllRows<{ id: string; reference_id: string | null }>(() =>
        supabase
          .from("transactions")
          .select("id, reference_id")
          .eq("clinic_id", active.clinicId)
          .eq("reference_type", "doctor_expense_doctor")
          .order("id", { ascending: true })
      ),
    ]);

    let expRes = expResFirst;
    if (expRes.error?.message?.includes("archived_to_history")) {
      expRes = await supabase
        .from("doctor_expenses")
        .select(
          `id, doctor_id, amount, percentage_split, expense_date, description_ar,
           invoice_file_name, invoice_storage_path,
           doctor:doctors ( full_name_ar )`
        )
        .eq("clinic_id", active.clinicId)
        .order("expense_date", { ascending: false })
        .limit(100);
    }

    setDoctors((docsRes.data as DoctorOption[]) ?? []);
    setExpenses(
      ((expRes.data as RawDoctorExpenseRow[]) ?? []).map(normalizeExpenseDoctor)
    );
    setDeductedIds(
      new Set(
        (txRes.data ?? [])
          .map((t) => String(t.reference_id ?? ""))
          .filter(Boolean)
      )
    );
    setLoading(false);
  }, [supabase]);

  async function applyDeduction(expenseId: string) {
    setActionId(expenseId);
    setActionError("");
    try {
      const res = await fetch(`/api/doctor-expenses/${expenseId}/apply-deduction`, {
        method: "POST",
        credentials: "include",
        headers: authPortalHeaders("accountant"),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        setActionError((json as { error?: string }).error ?? "تعذر تطبيق الخصم");
        return;
      }
      notifyClinicProfitRefresh();
      const expense = expenses.find((e) => e.id === expenseId);
      if (clinicId) {
        notifyFinancialMutation({
          clinicId,
          doctorId: expense?.doctor_id,
        });
      }
      await load();
    } finally {
      setActionId(null);
    }
  }

  async function deleteOrphan(expenseId: string) {
    if (!confirm("حذف هذه الفاتورة؟ (لم يُخصم من الطبيب)")) return;
    setActionId(expenseId);
    setActionError("");
    try {
      const res = await fetch(`/api/doctor-expenses/${expenseId}`, {
        method: "DELETE",
        credentials: "include",
        headers: authPortalHeaders("accountant"),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        setActionError((json as { error?: string }).error ?? "تعذر الحذف");
        return;
      }
      await load();
    } finally {
      setActionId(null);
    }
  }

  useEffect(() => {
    load();
  }, [load]);

  useClinicSync({
    topics: ["financial"],
    clinicId,
    onRefresh: () => {
      void load();
    },
    enabled: !!clinicId,
  });

  const totalAmount = expenses.reduce((s, e) => s + Number(e.amount), 0);
  const totalDoctorShare = expenses.reduce(
    (s, e) => s + Number(e.amount) * (Number(e.percentage_split) / 100),
    0
  );

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <PageHeader
        title="صرفيات عامة"
        eyebrow={bi("المالية", "Finance")}
        icon={Receipt}
        className="mb-0"
        subtitle={
          <>
            فواتير وصرفيات الأطباء · رواتب الأطباء · صرفيات العيادة — السجل
            التاريخي في{" "}
            <button
              type="button"
              className="font-semibold text-primary-700 underline decoration-premium-400 underline-offset-4 hover:text-primary-800"
              onClick={() => router.push(patientsHistoryHref)}
            >
              ملفات المرضى
            </button>
          </>
        }
        actions={
          activeTab === "clinic_expenses" ? (
            <button
              type="button"
              className="mc-btn-navy py-2.5"
              onClick={() => setShowAdd(true)}
              disabled={!clinicId || doctors.length === 0}
            >
              <Plus className="h-4 w-4 text-premium-300" />
              إضافة فاتورة صرف
            </button>
          ) : undefined
        }
      />

      <div className="mc-tab-group">
        {TAB_ITEMS.map(({ id, label, icon: Icon, accent }) => (
          <button
            key={id}
            type="button"
            onClick={() => selectTab(id)}
            className={cn(
              "mc-tab",
              activeTab === id && "mc-tab--active",
              activeTab === id && accent
            )}
          >
            <Icon className="h-4 w-4 shrink-0" />
            {label}
          </button>
        ))}
      </div>

      {activeTab === "doctor_salary" && (
        <div className="space-y-6">
          <DoctorSalaryAdjustmentsPanel clinicId={clinicId} />
          <DoctorSalaryPayoutPanel
            clinicId={clinicId}
            onPayoutRecorded={handleSalaryPayout}
          />
        </div>
      )}

      {activeTab === "general_expenses" && (
        <GeneralExpensesPanel
          clinicId={clinicId}
          onRecorded={handleGeneralExpense}
        />
      )}

      {activeTab === "clinic_expenses" && (
        <>
          <div className="grid gap-3 sm:grid-cols-3">
            <StatTile
              label="عدد الفواتير"
              value={expenses.length}
              icon={FileText}
              tone="navy"
            />
            <StatTile
              label="إجمالي الصرف"
              value={formatCurrency(totalAmount)}
              icon={TrendingDown}
              tone="danger"
            />
            <StatTile
              label="حصة الأطباء"
              value={formatCurrency(totalDoctorShare)}
              icon={Stethoscope}
              tone="warning"
            />
          </div>

          {actionError && (
            <Alert variant="error">{actionError}</Alert>
          )}

          {loading ? (
            <div className="space-y-3">
              {[1, 2, 3].map((i) => (
                <div key={i} className="mc-skeleton h-28 rounded-2xl" />
              ))}
            </div>
          ) : expenses.length === 0 ? (
            <div className="mc-panel flex flex-col items-center gap-3 border-dashed px-6 py-12 text-center">
              <span className="mc-icon-tile h-12 w-12">
                <Receipt className="h-5 w-5" />
              </span>
              <p className="max-w-md text-sm text-slate-muted">
                لا توجد صرفيات نشطة — بعد الاعتماد تنتقل الفاتورة إلى السجل
                التاريخي في ملفات المرضى
              </p>
            </div>
          ) : (
            <div className="space-y-3">
              {expenses.map((e) => {
                const doctorPart =
                  Number(e.amount) * (Number(e.percentage_split) / 100);
                const clinicPart = Number(e.amount) - doctorPart;
                const isDeducted = deductedIds.has(e.id);
                const busy = actionId === e.id;
                return (
                  <div
                    key={e.id}
                    className={cn(
                      "mc-panel mc-hover-lift p-5",
                      !isDeducted && "border-s-4 border-s-warning-border"
                    )}
                  >
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div className="flex min-w-0 flex-1 gap-3.5">
                        <span className="mc-icon-tile h-11 w-11 rounded-xl">
                          <Stethoscope className="h-5 w-5" strokeWidth={1.8} />
                        </span>
                      <div className="min-w-0 flex-1">
                        <p className="font-bold text-slate-text">
                          {e.doctor?.full_name_ar ?? "طبيب"}
                        </p>
                        <p className="mt-0.5 text-lg font-black tabular-nums text-debt-text">
                          خصم الطبيب: {formatCurrency(doctorPart)}
                        </p>
                        <p className="text-sm text-slate-muted">
                          إجمالي الفاتورة {formatCurrency(Number(e.amount))} —
                          نسبة الطبيب {e.percentage_split}% · العيادة{" "}
                          {formatCurrency(clinicPart)}
                        </p>
                        {!isDeducted && (
                          <p className="mt-2 inline-flex rounded-full border border-warning-border bg-warning px-2.5 py-0.5 text-xs font-semibold text-warning-text">
                            لم يُخصم من محفظة الطبيب بعد
                          </p>
                        )}
                        {e.description_ar && (
                          <p className="mt-1 text-sm text-slate-muted">
                            {e.description_ar}
                          </p>
                        )}
                        {e.invoice_file_name && e.invoice_storage_path && (
                          <div className="mt-2">
                            <DoctorExpenseInvoiceViewer
                              expenseId={e.id}
                              fileName={e.invoice_file_name}
                              portal="accountant"
                            />
                          </div>
                        )}
                        {e.invoice_file_name && !e.invoice_storage_path && (
                          <p className="mt-1 text-xs text-slate-muted">
                            📎 {e.invoice_file_name}
                          </p>
                        )}
                      </div>
                      </div>
                      <div className="flex flex-col items-end gap-2">
                        <span className="rounded-full border border-slate-border bg-surface px-2.5 py-0.5 text-xs font-medium tabular-nums text-slate-muted">
                          {formatDate(e.expense_date)}
                        </span>
                        {!isDeducted && (
                          <div className="flex flex-wrap gap-1.5">
                            <button
                              type="button"
                              disabled={busy}
                              onClick={() => void applyDeduction(e.id)}
                              className="mc-btn-navy px-3 py-1.5 text-xs"
                            >
                              {busy ? (
                                <RefreshCw className="h-3 w-3 animate-spin" />
                              ) : (
                                <Zap className="h-3 w-3" />
                              )}
                              تطبيق الخصم
                            </button>
                            <button
                              type="button"
                              disabled={busy}
                              onClick={() => void deleteOrphan(e.id)}
                              className="inline-flex items-center gap-1 rounded-xl border border-debt-border bg-surface-card px-3 py-1.5 text-xs font-semibold text-debt-text transition-colors hover:bg-debt disabled:opacity-60"
                            >
                              <Trash2 className="h-3 w-3" />
                              حذف
                            </button>
                          </div>
                        )}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </>
      )}

      {showAdd && clinicId && (
        <AddDoctorExpenseModal
          clinicId={clinicId}
          doctors={doctors}
          onClose={() => setShowAdd(false)}
          onSaved={handleExpenseSaved}
        />
      )}
    </div>
  );
}
