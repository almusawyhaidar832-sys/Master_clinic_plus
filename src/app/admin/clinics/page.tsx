"use client";

import { useEffect, useState } from "react";
import { Card, CardHeader, CardTitle } from "@/components/ui/Card";
import { DataTable, type Column } from "@/components/ui/DataTable";
import { createClient } from "@/lib/supabase/client";
import type { Clinic } from "@/types";

export default function ClinicsAdminPage() {
  const [clinics, setClinics] = useState<Clinic[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function load() {
      const supabase = createClient();
      const { data } = await supabase
        .from("clinics")
        .select("*")
        .order("created_at", { ascending: false });
      setClinics((data as Clinic[]) || []);
      setLoading(false);
    }
    load();
  }, []);

  const columns: Column<Clinic & { id: string }>[] = [
    {
      key: "name",
      header: "العيادة",
      render: (row) => row.name_ar || row.name,
    },
    {
      key: "phone",
      header: "الهاتف",
      render: (row) => row.phone || "—",
    },
    {
      key: "whatsapp",
      header: "واتساب",
      render: (row) => (row.whatsapp_linked ? "مربوط" : "غير مربوط"),
    },
  ];

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-slate-text">إدارة العيادات</h1>
        <p className="text-slate-muted">منصة متعددة المستأجرين — كل عيادة معزولة</p>
      </div>

      {loading ? (
        <p className="text-slate-muted">جاري التحميل...</p>
      ) : (
        <DataTable
          columns={columns}
          data={clinics}
          emptyMessage="لا توجد عيادات مسجّلة بعد"
        />
      )}

      <Card>
        <CardHeader>
          <CardTitle>إضافة عيادة جديدة</CardTitle>
          <p className="text-sm text-slate-muted">
            أنشئ سجلاً في جدول clinics عبر Supabase ثم اربط مستخدمي المحاسبة
            والأطباء في profiles.
          </p>
        </CardHeader>
      </Card>
    </div>
  );
}
