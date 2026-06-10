"use client";

import { useCallback, useEffect, useState } from "react";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { Card, CardHeader, CardTitle } from "@/components/ui/Card";
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
    const { data } = await supabase
      .from("expense_categories")
      .select("id, name_ar, color, icon")
      .eq("is_active", true)
      .order("sort_order");
    setCategories((data as ExpenseCategory[]) ?? []);
  }, [supabase]);

  const loadExpenses = useCallback(async () => {
    const { data } = await supabase
      .from("expenses")
      .select("*, category:expense_categories(id, name_ar, color, icon)")
      .or("expense_kind.eq.general,expense_kind.is.null")
      .order("expense_date", { ascending: false })
      .limit(100);
    setExpenses((data as ExpenseWithCategory[]) ?? []);
  }, [supabase]);

  useEffect(() => {
    void loadCategories();
    void loadExpenses();
  }, [loadCategories, loadExpenses]);

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
      text: "تم تسجيل المصروف — يظهر في السجل التاريخي",
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
          <span className="text-xs text-slate-400">غير مصنف</span>
        ),
    },
    {
      key: "desc",
      header: "الوصف",
      render: (row) => (
        <span className="text-slate-700">{row.description_ar}</span>
      ),
    },
    {
      key: "amount",
      header: "المبلغ",
      render: (row) => (
        <span className="font-bold text-red-600 tabular-nums">
          {formatCurrency(row.amount)}
        </span>
      ),
    },
  ];

  return (
    <div className="space-y-6">
      {catTotals.length > 0 && (
        <div className="rounded-2xl border border-slate-100 bg-white p-5 shadow-sm">
          <h3 className="mb-3 text-sm font-bold text-slate-600">
            توزيع المصروفات
          </h3>
          <div className="space-y-2">
            {catTotals.slice(0, 6).map((c) => (
              <div key={c.id} className="flex items-center gap-3">
                <span className="w-24 truncate text-xs text-slate-600">
                  {c.name_ar}
                </span>
                <div className="h-2 flex-1 overflow-hidden rounded-full bg-slate-100">
                  <div
                    className="h-full rounded-full"
                    style={{
                      width: `${(c.total / catTotals[0].total) * 100}%`,
                      backgroundColor: c.color,
                    }}
                  />
                </div>
                <span className="w-24 text-left text-xs font-semibold text-slate-700 tabular-nums">
                  {formatCurrency(c.total)}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      <Card>
        <CardHeader>
          <CardTitle>تسجيل مصروف عام</CardTitle>
        </CardHeader>
        <form onSubmit={handleSubmit} className="space-y-4">
          {message && (
            <Alert variant={message.type === "success" ? "success" : "error"}>
              {message.text}
            </Alert>
          )}

          <div>
            <label className="mb-1 block text-sm font-medium text-slate-600">
              التصنيف
            </label>
            <div className="flex flex-wrap gap-2">
              {categories.map((c) => (
                <button
                  key={c.id}
                  type="button"
                  onClick={() => setCategoryId(c.id)}
                  className={cn(
                    "rounded-full px-3 py-1 text-sm font-medium transition-all",
                    categoryId === c.id
                      ? "text-white shadow-sm ring-2 ring-offset-1"
                      : "bg-slate-100 text-slate-600 hover:bg-slate-200"
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

          <Button type="submit" disabled={loading || !clinicId}>
            {loading ? "جارٍ الحفظ..." : "حفظ المصروف"}
          </Button>
        </form>
      </Card>

      <div>
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <div className="flex flex-wrap gap-1">
            <button
              type="button"
              onClick={() => setFilterCat("all")}
              className={cn(
                "rounded-full px-3 py-1 text-xs font-medium transition-colors",
                filterCat === "all"
                  ? "bg-primary text-white"
                  : "bg-slate-100 text-slate-600 hover:bg-slate-200"
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
                  "rounded-full px-3 py-1 text-xs font-medium transition-colors",
                  filterCat === c.id ? "text-white" : "bg-slate-100 text-slate-600 hover:bg-slate-200"
                )}
                style={filterCat === c.id ? { backgroundColor: c.color } : {}}
              >
                {c.name_ar}
              </button>
            ))}
          </div>
          <p className="text-sm font-bold text-red-600">
            الإجمالي: {formatCurrency(total)}
          </p>
        </div>
        <DataTable
          columns={columns}
          data={filtered}
          emptyMessage="لا توجد مصروفات مسجّلة"
        />
      </div>
    </div>
  );
}
