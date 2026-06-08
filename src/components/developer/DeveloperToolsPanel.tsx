"use client";

import { useState } from "react";
import { Database, Shield, Wrench } from "lucide-react";
import { Button } from "@/components/ui/Button";

type Props = {
  onMessage: (msg: { ok: boolean; text: string }) => void;
};

export function DeveloperToolsPanel({ onMessage }: Props) {
  const [repairing, setRepairing] = useState(false);

  async function runRepair() {
    if (
      !confirm(
        "إصلاح بيانات كل العيادات؟\n\nيوحّد clinic_id ويربط الأطباء بالحالات."
      )
    ) {
      return;
    }
    setRepairing(true);
    const res = await fetch("/api/developer/repair-data", { method: "POST" });
    const data = await res.json();
    setRepairing(false);
    if (!res.ok) {
      onMessage({ ok: false, text: data.error ?? "فشل الإصلاح" });
      return;
    }
    const r = data.result as Record<string, number> | undefined;
    const summary = r
      ? `عمليات: ${r.operations_clinic_fixed ?? 0} · حالات: ${r.treatment_cases_clinic_fixed ?? 0} · مرضى: ${r.patient_primary_doctor_fixed ?? 0}`
      : "تم الإصلاح";
    onMessage({ ok: true, text: `إصلاح البيانات — ${summary}` });
  }

  return (
    <section className="mb-8 rounded-2xl border border-slate-700 bg-slate-900/50 p-5">
      <h2 className="mb-3 flex items-center gap-2 text-lg font-bold text-slate-200">
        <Wrench className="h-5 w-5 text-amber-400" />
        أدوات المطور
      </h2>
      <div className="flex flex-wrap gap-3">
        <Button
          type="button"
          size="sm"
          variant="outline"
          disabled={repairing}
          onClick={() => void runRepair()}
          className="border-slate-600 text-slate-200"
        >
          <Database className="h-4 w-4" />
          {repairing ? "جاري الإصلاح..." : "إصلاح بيانات العيادات"}
        </Button>
        <a
          href="https://supabase.com/dashboard"
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-2 rounded-lg border border-slate-600 px-3 py-2 text-sm text-slate-300 hover:bg-slate-800"
        >
          <Shield className="h-4 w-4" />
          فتح Supabase SQL
        </a>
      </div>
      <p className="mt-3 text-xs text-slate-500 leading-relaxed">
        لكل عيادة: من القائمة ⋮ أو صفحة التفاصيل → إدارة المستخدمين، تغيير
        الصلاحيات، وتعيين رمز جديد. حذف العيادة يمسح كل بياناتها نهائياً.
      </p>
    </section>
  );
}
