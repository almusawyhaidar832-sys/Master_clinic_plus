"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Card } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { Alert } from "@/components/ui/Alert";
import { createClient } from "@/lib/supabase/client";
import { getActiveClinicId } from "@/lib/clinic-context";
import {
  patientPhoneColumns,
  validatePatientPhone,
} from "@/lib/phone";
import { UserPlus } from "lucide-react";

export function AddPatientForm() {
  const router = useRouter();
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [notes, setNotes] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);

    const trimmedName = name.trim();
    if (!trimmedName) {
      setError("أدخل اسم المراجع");
      return;
    }

    const phoneCheck = validatePatientPhone(phone);
    if (!phoneCheck.ok) {
      setError(phoneCheck.message);
      return;
    }

    setLoading(true);
    const supabase = createClient();
    const activeClinic = await getActiveClinicId(supabase);
    if (!activeClinic) {
      setError("لا توجد عيادة نشطة");
      setLoading(false);
      return;
    }

    const { data, error: insertErr } = await supabase
      .from("patients")
      .insert({
        full_name_ar: trimmedName,
        clinic_id: activeClinic.clinicId,
        notes: notes.trim() || null,
        ...patientPhoneColumns(phoneCheck.normalized),
      })
      .select("id")
      .single();

    setLoading(false);

    if (insertErr || !data) {
      const msg = insertErr?.message ?? "";
      if (msg.includes("phone_number")) {
        setError(
          "عمود phone_number غير موجود — شغّل supabase/scripts/fix-patient-phone-number.sql في Supabase"
        );
      } else {
        setError(insertErr?.message ?? "تعذر حفظ المراجع");
      }
      return;
    }

    router.push(`/dashboard/patients/${data.id}`);
  }

  return (
    <Card className="p-4">
      <h3 className="mb-3 flex items-center gap-2 font-bold text-slate-text">
        <UserPlus className="h-5 w-5 text-primary" />
        إضافة مراجع جديد
      </h3>
      <form onSubmit={handleSubmit} className="grid gap-3 sm:grid-cols-2">
        {error && (
          <div className="sm:col-span-2">
            <Alert variant="error">{error}</Alert>
          </div>
        )}
        <div className="sm:col-span-2">
          <label className="mb-1 block text-sm font-medium text-slate-text">
            اسم المراجع
          </label>
          <input
            type="text"
            className="w-full rounded-lg border border-slate-border bg-surface px-3 py-2 text-sm outline-none focus:border-primary focus:ring-1 focus:ring-primary"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="الاسم الكامل"
            required
          />
        </div>
        <div className="sm:col-span-2">
          <label className="mb-1 block text-sm font-medium text-slate-text">
            رقم هاتف المراجع
          </label>
          <input
            type="tel"
            dir="ltr"
            className="w-full rounded-lg border border-slate-border bg-surface px-3 py-2 text-sm outline-none focus:border-primary focus:ring-1 focus:ring-primary"
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
            placeholder="07XX XXX XXXX أو +964..."
            required
          />
          <p className="mt-1 text-xs text-slate-muted">
            يُحفظ تلقائياً بصيغة +964 — يُستخدم لإشعارات الواتساب
          </p>
        </div>
        <div className="sm:col-span-2">
          <label className="mb-1 block text-sm font-medium text-slate-text">
            ملاحظات (اختياري)
          </label>
          <input
            type="text"
            className="w-full rounded-lg border border-slate-border bg-surface px-3 py-2 text-sm outline-none focus:border-primary focus:ring-1 focus:ring-primary"
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
          />
        </div>
        <div className="sm:col-span-2">
          <Button type="submit" disabled={loading}>
            {loading ? "جاري الحفظ..." : "حفظ المراجع"}
          </Button>
        </div>
      </form>
    </Card>
  );
}
