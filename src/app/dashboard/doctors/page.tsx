"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { Button } from "@/components/ui/Button";
import { Select } from "@/components/ui/Select";
import { createClient } from "@/lib/supabase/client";
import {
  DOCTOR_PERCENTAGE_OPTIONS,
  MATERIALS_SHARE_OPTIONS,
} from "@/lib/constants";
import type { Doctor } from "@/types";
import { Plus, RefreshCw, PencilLine, Check, X } from "lucide-react";

function labelFor(
  options: readonly { value: string; label: string }[],
  value: string
) {
  return options.find((o) => o.value === value)?.label ?? value;
}

interface EditState {
  id: string;
  percentage: string;
  materials_share: string;
}

export default function DoctorsPage() {
  const [doctors, setDoctors] = useState<Doctor[]>([]);
  const [loading, setLoading] = useState(true);
  const [showAll, setShowAll] = useState(false);
  const [editing, setEditing] = useState<EditState | null>(null);
  const [saving, setSaving] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    const supabase = createClient();
    let q = supabase.from("doctors").select("*").order("full_name_ar");
    if (!showAll) q = q.eq("is_active", true);
    const { data } = await q;
    setDoctors((data as Doctor[]) || []);
    setLoading(false);
  }, [showAll]);

  useEffect(() => {
    load();
  }, [load]);

  async function toggleActive(doctor: Doctor) {
    setSaving(doctor.id);
    const supabase = createClient();
    await supabase
      .from("doctors")
      .update({ is_active: !doctor.is_active })
      .eq("id", doctor.id);
    setSaving(null);
    load();
  }

  async function saveEdit() {
    if (!editing) return;
    setSaving(editing.id);
    const supabase = createClient();
    await supabase
      .from("doctors")
      .update({
        percentage: editing.percentage as Doctor["percentage"],
        materials_share: editing.materials_share as Doctor["materials_share"],
      })
      .eq("id", editing.id);
    setSaving(null);
    setEditing(null);
    load();
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h2 className="text-2xl font-bold text-slate-text">الأطباء</h2>
          <p className="text-slate-muted">
            {loading
              ? "جاري التحميل..."
              : `${doctors.length} طبيب ${showAll ? "(الكل)" : "نشط"}`}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() => setShowAll((v) => !v)}
          >
            {showAll ? "عرض النشطين فقط" : "عرض الكل (شاملاً الموقوفين)"}
          </Button>
          <Button variant="outline" size="sm" onClick={load} disabled={loading}>
            <RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} />
          </Button>
          <Link href="/dashboard/doctors/new">
            <Button>
              <Plus className="h-4 w-4" />
              إضافة طبيب
            </Button>
          </Link>
        </div>
      </div>

      {/* Doctors list */}
      {loading ? (
        <div className="space-y-2">
          {[1, 2, 3].map((i) => (
            <div key={i} className="h-20 animate-pulse rounded-xl bg-slate-100" />
          ))}
        </div>
      ) : doctors.length === 0 ? (
        <p className="rounded-xl border border-dashed border-slate-border py-10 text-center text-sm text-slate-muted">
          لا يوجد أطباء — اضغط «إضافة طبيب» للبدء
        </p>
      ) : (
        <div className="space-y-3">
          {doctors.map((doc) => {
            const isEditing = editing?.id === doc.id;
            const isSaving = saving === doc.id;

            return (
              <div
                key={doc.id}
                className={`rounded-xl border p-4 transition-all ${
                  doc.is_active
                    ? "border-slate-border bg-surface-card"
                    : "border-slate-border/40 bg-slate-50 opacity-70"
                }`}
              >
                <div className="flex flex-wrap items-start justify-between gap-3">
                  {/* Doctor info */}
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <p className="font-semibold text-slate-text">
                        {doc.full_name_ar}
                      </p>
                      <span
                        className={`rounded-full px-2 py-0.5 text-[10px] font-medium ${
                          doc.is_active
                            ? "bg-emerald-50 text-emerald-700"
                            : "bg-slate-200 text-slate-500"
                        }`}
                      >
                        {doc.is_active ? "نشط" : "موقوف"}
                      </span>
                    </div>
                    {doc.specialty_ar && (
                      <p className="text-xs text-slate-muted">{doc.specialty_ar}</p>
                    )}
                    {doc.phone && (
                      <p className="text-xs text-slate-muted" dir="ltr">
                        {doc.phone}
                      </p>
                    )}
                  </div>

                  {/* Percentage — inline edit */}
                  <div className="flex items-center gap-2">
                    {isEditing ? (
                      <>
                        <div className="flex items-center gap-2">
                          <Select
                            label=""
                            value={editing.percentage}
                            onChange={(e) =>
                              setEditing({ ...editing, percentage: e.target.value })
                            }
                            options={[...DOCTOR_PERCENTAGE_OPTIONS]}
                          />
                          <Select
                            label=""
                            value={editing.materials_share}
                            onChange={(e) =>
                              setEditing({
                                ...editing,
                                materials_share: e.target.value,
                              })
                            }
                            options={[...MATERIALS_SHARE_OPTIONS]}
                          />
                        </div>
                        <Button
                          size="sm"
                          onClick={saveEdit}
                          disabled={isSaving}
                        >
                          <Check className="h-4 w-4" />
                        </Button>
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() => setEditing(null)}
                        >
                          <X className="h-4 w-4" />
                        </Button>
                      </>
                    ) : (
                      <>
                        <div className="text-right text-sm">
                          <span className="rounded-full bg-primary/10 px-2 py-0.5 text-xs font-semibold text-primary">
                            {labelFor(DOCTOR_PERCENTAGE_OPTIONS, doc.percentage)}
                          </span>
                          <span className="mr-1 text-xs text-slate-muted">
                            مواد:{" "}
                            {labelFor(MATERIALS_SHARE_OPTIONS, doc.materials_share)}
                          </span>
                        </div>
                        <Button
                          size="sm"
                          variant="ghost"
                          title="تعديل النسبة"
                          onClick={() =>
                            setEditing({
                              id: doc.id,
                              percentage: doc.percentage,
                              materials_share: doc.materials_share,
                            })
                          }
                        >
                          <PencilLine className="h-3.5 w-3.5" />
                        </Button>
                        <Button
                          size="sm"
                          variant="outline"
                          disabled={isSaving}
                          onClick={() => toggleActive(doc)}
                          className={
                            doc.is_active
                              ? "text-slate-muted hover:border-debt-text hover:text-debt-text"
                              : "border-emerald-300 text-emerald-700 hover:bg-emerald-50"
                          }
                        >
                          {doc.is_active ? "إيقاف" : "تفعيل"}
                        </Button>
                      </>
                    )}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
