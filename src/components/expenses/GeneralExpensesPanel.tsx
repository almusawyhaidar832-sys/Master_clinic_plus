"use client";

import { useCallback, useEffect, useState } from "react";
import { Input } from "@/components/ui/Input";
import { PieChart, PlusCircle } from "lucide-react";
import { Alert } from "@/components/ui/Alert";
import { DataTable, type Column } from "@/components/ui/DataTable";
import { createClient } from "@/lib/supabase/client";
import { formatCurrency, formatDate, todayISO } from "@/lib/utils";
import { authPortalHeaders } from "@/lib/auth/api-portal";
import { notifyFinancialMutation } from "@/lib/sync/mutation-notify";
import { notifyClinicProfitRefresh } from "@/lib/services/clinic-profit";
import type { Expense } from "@/types";
import { cn } from "@/lib/utils";

interface ExpenseCategory {
  id: string;
  name_ar: string;
  color: string;
  icon: string;
}

interface ExpenseWithCategory extends Expense {
  category_id?: string | null;
  category?: ExpenseCategory | null;
}

interface GeneralExpensesPanelProps {
  clinicId: string | null;
  onRecorded?: () => void;
}

export function GeneralExpensesPanel({
  clinicId,
  onRecorded,
}: GeneralExpensesPanelProps) {
  const [description, setDescription] = useState("");
  const [amount, setAmount] = useState("");
  const [expenseDate, setExpenseDate] = useState(todayISO());
  const [categoryId, setCategoryId] = useState<string>("");
  const [categories, setCategories] = useState<ExpenseCategory[]>([]);
  const [message, setMessage] = useState<{
    type: "success" | "error";
    text: string;
  } | null>(null);
  const [loading, setLoading] = useState(false);
  const [expenses, setExpenses] = useState<ExpenseWithCategory[]>([]);
  const [filterCat, setFilterCat] = useState<string>("all");

  const supabase = createClient();

  const loadCategories = useCallback(async () => {
    if (!clinicId) {
      setCategories([]);
      return;
    }
    const { data } = await supabase
      .from("expense_categories")
      .select("id, name_ar, color, icon")
      .eq("clinic_id", clinicId)
      .eq("is_active", true)
      .order("sort_order");
    setCategories((data as ExpenseCategory[]) ?? []);
  }, [supabase, clinicId]);

  const loadExpenses = useCallback(async () => {
    if (!clinicId) {
      setExpenses([]);
      return;
    }
    const { data } = await supabase
      .from("expenses")
      .select("*, category:expense_categories(id, name_ar, color, icon)")
      .eq("clinic_id", clinicId)
      .or("expense_kind.eq.general,expense_kind.is.null")
      .order("expense_date", { ascending: false })
      .limit(100);
    setExpenses((data as ExpenseWithCategory[]) ?? []);
  }, [supabase, clinicId]);

  useEffect(() => {
    void loadCategories();
    void loadExpenses();
  }, [loadCategories, loadExpenses, clinicId]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!clinicId) {
      setMessage({ type: "error", text: "لا توجد عيادة نشطة." });
      return;
    }
    setLoading(true);
    setMessage(null);

    const res = await fetch("/api/expenses", {
      method: "POST",
      credentials: "include",
      headers: {
        "Content-Type": "application/json",
        ...authPortalHeaders("accountant"),
      },
      body: JSON.stringify({
        description_ar: description.trim(),
        amount: parseFloat(amount),
        expense_date: expenseDate,
        category_id: categoryId || null,
      }),
    });
    const json = await res.json().catch(() => ({}));

    setLoading(false);
    if (!res.ok) {
      setMessage({
        type: "error",
        text: `تعذر حفظ المصروف: ${(json as { error?: string }).error ?? res.statusText}`,
      });
      return;
    }
    notifyClinicProfitRefresh(clinicId);
    notifyFinancialMutation({ clinicId });
    setMessage({
      type: "success",
      text: "تم تسجيل المصروف — يُخصم من صافي ربح العيادة",
    });
    setDescription("");
    setAmount("");
    setCategoryId("");
    void loadExpenses();
    onRecorded?.();
  }

  const filtered =
    filterCat === "all"
      ? expenses
      : expenses.filter((e) => e.category_id === filterCat);

  const total = filtered.reduce((s, e) => s + e.amount, 0);

  const catTotals = categories
    .map((c) => ({
      ...c,
      total: expenses
        .filter((e) => e.category_id === c.id)
        .reduce((s, e) => s + e.amount, 0),
    }))
    .filter((c) => c.total > 0)
    .sort((a, b) => b.total - a.total);

  const columns: Column<ExpenseWithCategory>[] = [
    {
      key: "date",
      header: "التاريخ",
      render: (row) => formatDate(row.expense_date),
    },
    {
      key: "category",
      header: "التصنيف",
      render: (row) =>
        row.category ? (
          <span
            className="rounded-full px-2 py-0.5 text-xs font-medium text-white"
            style={{ backgroundColor: row.category.color }}
          >
            {row.category.name_ar}
          </span>
        ) : (
          <span className="text-xs text-slate-muted">غير مصنف</span>
        ),
    },
    {
      key: "desc",
      header: "الوصف",
      render: (row) => (
        <span className="text-slate-text">{row.description_ar}</span>
      ),
    },
    {
      key: "amount",
      header: "المبلغ",
      render: (row) => (
        <span className="font-bold text-debt-text tabular-nums">
          {formatCurrency(row.amount)}
        </span>
      ),
    },
  ];

  return (
    <div className="space-y-6">
      <div className="grid gap-6 lg:grid-cols-5">
      <div className="mc-panel lg:col-span-3">
        <div className="mc-panel-head">
          <h3 className="mc-panel-title">
            <PlusCircle />
            تسجيل صرفية عيادة
          </h3>
        </div>
        <form onSubmit={handleSubmit} className="mc-panel-body space-y-5">
          {message && (
            <Alert variant={message.type === "success" ? "success" : "error"}>
              {message.text}
            </Alert>
          )}

          <div>
            <label className="mc-label mb-2">
              التصنيف
            </label>
            <div className="flex flex-wrap gap-2">
              {categories.map((c) => (
                <button
                  key={c.id}
                  type="button"
                  onClick={() => setCategoryId(c.id)}
                  className={cn(
                    "mc-chip",
                    categoryId === c.id && "border-transparent text-white shadow-soft hover:text-white"
                  )}
                  style={
                    categoryId === c.id
                      ? {
                          backgroundColor: c.color,
                          boxShadow: `0 0 0 2px ${c.color}`,
                        }
                      : undefined
                  }
                >
                  {c.name_ar}
                </button>
              ))}
            </div>
          </div>

          <Input
            label="وصف المصروف"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            required
          />

          <div className="grid grid-cols-2 gap-4">
            <Input
              label="المبلغ (د.ع)"
              type="number"
              min="0"
              step="0.01"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              required
              dir="ltr"
              className="text-left"
            />
            <Input
              label="التاريخ"
              type="date"
              value={expenseDate}
              onChange={(e) => setExpenseDate(e.target.value)}
              required
              dir="ltr"
              className="text-left"
            />
          </div>

          <div className="flex justify-end border-t border-slate-border pt-4">
            <button
              type="submit"
              className="mc-btn-navy px-6 py-2.5"
              disabled={loading || !clinicId}
            >
              {loading ? "جارٍ الحفظ..." : "حفظ المصروف"}
            </button>
          </div>
        </form>
      </div>

      <div className="mc-panel lg:col-span-2">
        <div className="mc-panel-head">
          <h3 className="mc-panel-title">
            <PieChart />
            توزيع المصروفات
          </h3>
        </div>
        <div className="mc-panel-body">
          {catTotals.length > 0 ? (
            <div className="space-y-3.5">
              {catTotals.slice(0, 6).map((c) => (
                <div key={c.id} className="space-y-1.5">
                  <div className="flex items-center justify-between gap-3 text-xs">
                    <span className="flex min-w-0 items-center gap-2 font-medium text-slate-text">
                      <span
                        className="h-2.5 w-2.5 shrink-0 rounded-full"
                        style={{ backgroundColor: c.color }}
                        aria-hidden
                      />
                      <span className="truncate">{c.name_ar}</span>
                    </span>
                    <span className="font-bold tabular-nums text-slate-text">
                      {formatCurrency(c.total)}
                    </span>
                  </div>
                  <div className="h-2 overflow-hidden rounded-full bg-surface ring-1 ring-inset ring-slate-border">
                    <div
                      className="h-full rounded-full"
                      style={{
                        width: `${(c.total / catTotals[0].total) * 100}%`,
                        backgroundColor: c.color,
                      }}
                    />
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <p className="py-6 text-center text-sm text-slate-muted">—</p>
          )}
        </div>
      </div>
      </div>

      <div className="mc-panel">
        <div className="mc-panel-head">
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => setFilterCat("all")}
              className={cn(
                "mc-chip px-3 py-1 text-xs",
                filterCat === "all" && "mc-chip--active"
              )}
            >
              الكل
            </button>
            {categories.map((c) => (
              <button
                key={c.id}
                type="button"
                onClick={() => setFilterCat(c.id)}
                className={cn(
                  "mc-chip px-3 py-1 text-xs",
                  filterCat === c.id && "border-transparent text-white hover:text-white"
                )}
                style={filterCat === c.id ? { backgroundColor: c.color } : {}}
              >
                {c.name_ar}
              </button>
            ))}
          </div>
          <p className="rounded-full border border-debt-border bg-debt px-3 py-1 text-sm font-bold tabular-nums text-debt-text">
            الإجمالي: {formatCurrency(total)}
          </p>
        </div>
        <div className="p-2 sm:p-3">
          <DataTable
            columns={columns}
            data={filtered}
            emptyMessage="لا توجد مصروفات مسجّلة"
          />
        </div>
      </div>
    </div>
  );
}
