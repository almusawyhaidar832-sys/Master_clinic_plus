"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { getActiveClinicId } from "@/lib/clinic-context";
import { AddDoctorExpenseModal } from "@/components/doctor-expenses/AddDoctorExpenseModal";
import { InvoiceHistoryPanel } from "@/components/doctor-expenses/InvoiceHistoryPanel";
import { DoctorSalaryAdjustmentsPanel } from "@/components/expenses/DoctorSalaryAdjustmentsPanel";
import { DoctorSalaryPayoutPanel } from "@/components/expenses/DoctorSalaryPayoutPanel";
import { GeneralExpensesPanel } from "@/components/expenses/GeneralExpensesPanel";
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
  History,
  Banknote,
  Wallet,
} from "lucide-react";

const VALID_TABS = [
  "invoice_history",
  "clinic_expenses",
  "doctor_salary",
  "general_expenses",
] as const;

type ExpensesTab = (typeof VALID_TABS)[number];

function parseTab(value: string | null): ExpensesTab {
  if (value && (VALID_TABS as readonly string[]).includes(value)) {
    return value as ExpensesTab;
  }
  return "invoice_history";
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

const TAB_ITEMS: {
  id: ExpensesTab;
  label: string;
  icon: typeof History;
  accent: string;
}[] = [
  {
    id: "invoice_history",
    label: "السجل التاريخي",
    icon: History,
    accent: "mc-tab-accent-history",
  },
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
  const [historyRefreshKey, setHistoryRefreshKey] = useState(0);

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

  function refreshHistory() {
    setHistoryRefreshKey((k) => k + 1);
  }

  function handleExpenseSaved() {
    void load();
    selectTab("invoice_history");
    refreshHistory();
  }

  function handleSalaryPayout() {
    refreshHistory();
    selectTab("invoice_history");
  }

  function handleGeneralExpense() {
    refreshHistory();
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
      supabase
        .from("transactions")
        .select("reference_id")
        .eq("clinic_id", active.clinicId)
        .eq("reference_type", "doctor_expense_doctor"),
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
    setExpenses((expRes.data as DoctorExpenseRow[]) ?? []);
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
      setHistoryRefreshKey((k) => k + 1);
    },
    enabled: !!clinicId,
  });

  const totalAmount = expenses.reduce((s, e) => s + Number(e.amount), 0);
  const totalDoctorShare = expenses.reduce(
    (s, e) => s + Number(e.amount) * (Number(e.percentage_split) / 100),
    0
  );

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="flex items-center gap-2 text-2xl font-bold text-slate-800">
            <Receipt className="h-7 w-7 text-primary" />
            صرفيات عامة
          </h1>
          <p className="mc-page-subtitle">
            السجل التاريخي · فواتير وصرفيات الأطباء · رواتب الأطباء · صرفيات العيادة
          </p>
        </div>
        {activeTab === "clinic_expenses" && (
          <button
            type="button"
            onClick={() => setShowAdd(true)}
            disabled={!clinicId || doctors.length === 0}
            className="flex items-center gap-2 rounded-xl bg-primary px-4 py-2.5 text-sm font-bold text-white hover:bg-primary/90 disabled:opacity-50"
          >
            <Plus className="h-4 w-4" />
            إضافة فاتورة صرف
          </button>
        )}
      </div>

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

      {activeTab === "invoice_history" && (
        <InvoiceHistoryPanel
          clinicId={clinicId}
          doctors={doctors}
          refreshKey={historyRefreshKey}
        />
      )}

      {activeTab === "doctor_salary" && (
        <div className="space-y-6">
          <DoctorSalaryAdjustmentsPanel
            clinicId={clinicId}
            onUpdated={refreshHistory}
          />
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
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
            {[
              {
                label: "عدد الفواتير",
                value: expenses.length,
                color: "mc-stat-neutral",
              },
              {
                label: "إجمالي الصرف",
                value: formatCurrency(totalAmount),
                color: "mc-stat-debt",
              },
              {
                label: "حصة الأطباء",
                value: formatCurrency(totalDoctorShare),
                color: "mc-stat-warning",
              },
            ].map((s) => (
              <div key={s.label} className={s.color}>
                <p className="mc-stat-value">{s.value}</p>
                <p className="mc-stat-label">{s.label}</p>
              </div>
            ))}
          </div>

          {actionError && (
            <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-600">
              {actionError}
            </p>
          )}

          {loading ? (
            <div className="flex justify-center py-12">
              <RefreshCw className="h-6 w-6 animate-spin text-primary" />
            </div>
          ) : expenses.length === 0 ? (
            <div className="rounded-2xl border border-dashed border-slate-200 p-10 text-center text-sm text-slate-400">
              لا توجد صرفيات نشطة — الصرفيات الجديدة تنتقل تلقائياً إلى السجل
              التاريخي
            </div>
          ) : (
            <div className="space-y-2">
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
                      "rounded-2xl border bg-white p-4",
                      isDeducted
                        ? "border-slate-200"
                        : "border-amber-300 bg-amber-50/30"
                    )}
                  >
                    <div className="flex flex-wrap items-start justify-between gap-2">
                      <div className="min-w-0 flex-1">
                        <p className="flex items-center gap-1 font-bold text-slate-800">
                          <Stethoscope className="h-4 w-4 text-primary" />
                          {e.doctor?.full_name_ar ?? "طبيب"}
                        </p>
                        <p className="text-lg font-black text-red-700">
                          خصم الطبيب: {formatCurrency(doctorPart)}
                        </p>
                        <p className="text-sm text-slate-600">
                          إجمالي الفاتورة {formatCurrency(Number(e.amount))} —
                          نسبة الطبيب {e.percentage_split}% · العيادة{" "}
                          {formatCurrency(clinicPart)}
                        </p>
                        {!isDeducted && (
                          <p className="mt-1 text-xs font-medium text-amber-800">
                            لم يُخصم من محفظة الطبيب بعد
                          </p>
                        )}
                        {e.description_ar && (
                          <p className="mt-1 text-sm text-slate-600">
                            {e.description_ar}
                          </p>
                        )}
                        {e.invoice_file_name && (
                          <p className="mt-1 text-xs text-slate-400">
                            📎 {e.invoice_file_name}
                          </p>
                        )}
                      </div>
                      <div className="flex flex-col items-end gap-2">
                        <span className="text-xs text-slate-400">
                          {formatDate(e.expense_date)}
                        </span>
                        {!isDeducted && (
                          <div className="flex flex-wrap gap-1">
                            <button
                              type="button"
                              disabled={busy}
                              onClick={() => void applyDeduction(e.id)}
                              className="flex items-center gap-1 rounded-lg bg-primary px-2.5 py-1.5 text-xs font-bold text-white disabled:opacity-60"
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
                              className="flex items-center gap-1 rounded-lg border border-red-200 px-2.5 py-1.5 text-xs text-red-600 disabled:opacity-60"
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
