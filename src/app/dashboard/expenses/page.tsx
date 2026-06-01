"use client";

import { useCallback, useEffect, useState } from "react";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { Card, CardHeader, CardTitle } from "@/components/ui/Card";
import { Alert } from "@/components/ui/Alert";
import { DataTable, type Column } from "@/components/ui/DataTable";
import { createClient } from "@/lib/supabase/client";
import { useActiveClinicId } from "@/hooks/useActiveClinicId";
import { formatCurrency, formatDate, todayISO } from "@/lib/utils";
import type { Expense } from "@/types";

export default function ExpensesPage() {
  const { clinicId, missingClinic } = useActiveClinicId();

  const [description, setDescription] = useState("");
  const [amount, setAmount] = useState("");
  const [expenseDate, setExpenseDate] = useState(todayISO());
  const [message, setMessage] = useState<{ type: "success" | "error"; text: string } | null>(null);
  const [loading, setLoading] = useState(false);
  const [expenses, setExpenses] = useState<Expense[]>([]);

  const loadExpenses = useCallback(async () => {
    const supabase = createClient();
    const { data } = await supabase
      .from("expenses")
      .select("*")
      .order("expense_date", { ascending: false })
      .limit(50);
    setExpenses((data as Expense[]) || []);
  }, []);

  useEffect(() => {
    loadExpenses();
  }, [loadExpenses]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!clinicId) {
      setMessage({ type: "error", text: "لا توجد عيادة نشطة. تحقق من قاعدة البيانات." });
      return;
    }

    setLoading(true);
    setMessage(null);

    const supabase = createClient();
    const { error } = await supabase.from("expenses").insert({
      clinic_id: clinicId,
      description_ar: description.trim(),
      amount: parseFloat(amount),
      expense_date: expenseDate,
    });

    setLoading(false);
    if (error) {
      setMessage({ type: "error", text: `تعذر حفظ المصروف: ${error.message}` });
      return;
    }
    setMessage({ type: "success", text: "تم تسجيل المصروف بنجاح" });
    setDescription("");
    setAmount("");
    loadExpenses();
  }

  const columns: Column<Expense>[] = [
    {
      key: "date",
      header: "التاريخ",
      render: (row) => formatDate(row.expense_date),
    },
    {
      key: "desc",
      header: "الوصف",
      render: (row) => row.description_ar,
    },
    {
      key: "amount",
      header: "المبلغ",
      render: (row) => (
        <span className="font-medium text-debt-text">{formatCurrency(row.amount)}</span>
      ),
    },
  ];

  const total = expenses.reduce((s, e) => s + e.amount, 0);

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <div>
        <h2 className="text-2xl font-bold text-slate-text">المصروفات العامة</h2>
        <p className="text-slate-muted">
          إدخال حر — إيجار، مولد، أمبير، صيانة، وأي بند آخر
        </p>
      </div>

      {missingClinic && (
        <Alert variant="error">لا توجد عيادة في قاعدة البيانات.</Alert>
      )}

      <Card>
        <CardHeader>
          <CardTitle>تسجيل مصروف جديد</CardTitle>
        </CardHeader>
        <form onSubmit={handleSubmit} className="space-y-4">
          {message && (
            <Alert variant={message.type === "success" ? "success" : "error"}>
              {message.text}
            </Alert>
          )}

          <Input
            label="وصف المصروف"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            required
          />

          <Input
            label="المبلغ"
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

          <Button type="submit" disabled={loading || !clinicId}>
            {loading ? "جاري الحفظ..." : "حفظ المصروف"}
          </Button>
        </form>
      </Card>

      <div>
        <div className="mb-3 flex items-center justify-between">
          <h3 className="text-lg font-semibold text-slate-text">سجل المصروفات</h3>
          <p className="text-sm font-medium text-debt-text">
            الإجمالي: {formatCurrency(total)}
          </p>
        </div>
        <DataTable
          columns={columns}
          data={expenses}
          emptyMessage="لا توجد مصروفات مسجّلة"
        />
      </div>
    </div>
  );
}
