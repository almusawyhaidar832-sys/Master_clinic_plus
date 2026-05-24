"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Button } from "@/components/ui/Button";
import { DataTable, type Column } from "@/components/ui/DataTable";
import { createClient } from "@/lib/supabase/client";
import {
  DOCTOR_PERCENTAGE_OPTIONS,
  MATERIALS_SHARE_OPTIONS,
} from "@/lib/constants";
import type { Doctor } from "@/types";
import { Plus } from "lucide-react";

function labelFor(
  options: readonly { value: string; label: string }[],
  value: string
) {
  return options.find((o) => o.value === value)?.label ?? value;
}

export default function DoctorsPage() {
  const [doctors, setDoctors] = useState<Doctor[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function load() {
      const supabase = createClient();
      const { data } = await supabase
        .from("doctors")
        .select("*")
        .order("full_name_ar");
      setDoctors((data as Doctor[]) || []);
      setLoading(false);
    }
    load();
  }, []);

  const columns: Column<Doctor>[] = [
    {
      key: "name",
      header: "الاسم",
      render: (row) => row.full_name_ar,
    },
    {
      key: "specialty",
      header: "التخصص",
      render: (row) => row.specialty_ar || "—",
    },
    {
      key: "percentage",
      header: "نسبة الطبيب",
      render: (row) => labelFor(DOCTOR_PERCENTAGE_OPTIONS, row.percentage),
    },
    {
      key: "materials",
      header: "تكلفة المواد",
      render: (row) => labelFor(MATERIALS_SHARE_OPTIONS, row.materials_share),
    },
    {
      key: "status",
      header: "الحالة",
      render: (row) => (row.is_active ? "نشط" : "موقوف"),
    },
  ];

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h2 className="text-2xl font-bold text-slate-text">الأطباء</h2>
          <p className="text-slate-muted">اتفاقيات مالية ثابتة — بدون إدخال يدوي للنسب</p>
        </div>
        <Link href="/dashboard/doctors/new">
          <Button>
            <Plus className="h-4 w-4" />
            إضافة طبيب
          </Button>
        </Link>
      </div>

      {loading ? (
        <p className="text-slate-muted">جاري التحميل...</p>
      ) : (
        <DataTable
          columns={columns}
          data={doctors}
          emptyMessage="لا يوجد أطباء — أضف طبيباً جديداً"
        />
      )}
    </div>
  );
}
