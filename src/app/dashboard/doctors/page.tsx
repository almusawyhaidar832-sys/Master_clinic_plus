"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { createClient } from "@/lib/supabase/client";
import { useActiveClinicId } from "@/hooks/useActiveClinicId";
import {
  formatPercentageLabel,
  normalizeDoctorPercentage,
  normalizeMaterialsShare,
} from "@/lib/constants";
import type { Doctor } from "@/types";
import { doctorPaymentLabel } from "@/lib/services/doctor-payment";
import {
  fetchDoctorAccountingBalances,
  type DoctorAccountingBalance,
} from "@/lib/services/doctor-accounting-balance";
import { formatCurrency } from "@/lib/utils";
import { authPortalHeaders } from "@/lib/auth/api-portal";
import { Plus, RefreshCw, PencilLine, Check, X, Settings2 } from "lucide-react";

interface EditState {
  id: string;
  percentage: string;
  materials_share: string;
}

export default function DoctorsPage() {
  const { clinicId, clinicName, loading: clinicLoading } = useActiveClinicId();
  const [doctors, setDoctors] = useState<Doctor[]>([]);
  const [balances, setBalances] = useState<Map<string, DoctorAccountingBalance>>(
    new Map()
  );
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState<EditState | null>(null);
  const [saving, setSaving] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    const supabase = createClient();
    let q = supabase.from("doctors").select("*").order("full_name_ar");
    if (clinicId) q = q.eq("clinic_id", clinicId);
    const { data, error } = await q;
    if (error) {
      setDoctors([]);
      setLoading(false);
      return;
    }
    const list = (data as Doctor[]) || [];
    setDoctors(list);
    if (list.length) {
      const balanceMap = await fetchDoctorAccountingBalances(
        supabase,
        list.map((d) => d.id)
      );
      setBalances(balanceMap);
    } else {
      setBalances(new Map());
    }
    setLoading(false);
  }, [clinicId]);

  useEffect(() => {
    if (clinicLoading) return;
    void load();
  }, [load, clinicLoading]);

  const isLoading = clinicLoading || loading;

  async function toggleActive(doctor: Doctor) {
    setSaving(doctor.id);
    const supabase = createClient();
    let q = supabase
      .from("doctors")
      .update({ is_active: !doctor.is_active })
      .eq("id", doctor.id);
    if (clinicId) q = q.eq("clinic_id", clinicId);
    await q;
    setSaving(null);
    load();
  }

  async function saveEdit() {
    if (!editing) return;
    setSaving(editing.id);
    try {
      const res = await fetch(`/api/admin/doctors/${editing.id}`, {
        method: "PATCH",
        credentials: "include",
        headers: {
          "Content-Type": "application/json",
          ...authPortalHeaders("accountant"),
        },
        body: JSON.stringify({
          percentage: editing.percentage,
          materials_share: editing.materials_share,
        }),
      });
      const json = (await res.json()) as { error?: string };
      if (!res.ok) {
        console.error("[doctors/saveEdit]", json.error ?? res.statusText);
      }
    } catch (err) {
      console.error("[doctors/saveEdit]", err);
    }
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
            {isLoading
              ? "جاري التحميل..."
              : `${doctors.length} طبيب${clinicName ? ` — ${clinicName}` : ""}`}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" size="sm" onClick={load} disabled={isLoading}>
            <RefreshCw className={`h-4 w-4 ${isLoading ? "animate-spin" : ""}`} />
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
      {isLoading ? (
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
                    <p className="text-[11px] font-medium text-primary">
                      {doctorPaymentLabel(doc)}
                    </p>
                    {(() => {
                      const bal = balances.get(doc.id);
                      if (!bal) return null;
                      return (
                        <p
                          className={`mt-1 text-sm font-semibold tabular-nums ${
                            bal.isDebtor ? "text-red-600" : "text-emerald-700"
                          }`}
                        >
                          الرصيد: {formatCurrency(Math.abs(bal.netBalance))}
                          {bal.isDebtor && (
                            <span className="mr-1 text-xs font-bold">(مدين)</span>
                          )}
                        </p>
                      );
                    })()}
                    <p className="text-xs text-slate-muted" dir="ltr">
                      {doc.phone ? (
                        <>📱 {doc.phone}</>
                      ) : (
                        <span className="text-amber-600">بدون رقم واتساب</span>
                      )}
                    </p>
                    {!doc.profile_id && (
                      <p className="text-xs text-amber-600">بدون حساب دخول</p>
                    )}
                  </div>

                  {/* Percentage — inline edit */}
                  <div className="flex items-center gap-2">
                    {isEditing ? (
                      <>
                        <div className="flex items-center gap-2">
                          <Input
                            aria-label="نسبة الطبيب"
                            type="number"
                            min={0}
                            max={100}
                            step={1}
                            className="w-20"
                            value={editing.percentage}
                            onChange={(e) =>
                              setEditing({ ...editing, percentage: e.target.value })
                            }
                          />
                          <Input
                            aria-label="نسبة المختبر"
                            type="number"
                            min={0}
                            max={100}
                            step={1}
                            className="w-20"
                            value={editing.materials_share}
                            onChange={(e) =>
                              setEditing({
                                ...editing,
                                materials_share: e.target.value,
                              })
                            }
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
                            {formatPercentageLabel(doc.percentage)}
                          </span>
                          <span className="mr-1 text-xs text-slate-muted">
                            مواد:{" "}
                            {formatPercentageLabel(doc.materials_share)}
                          </span>
                        </div>
                        <Link href={`/dashboard/doctors/${doc.id}`}>
                          <Button
                            size="sm"
                            variant="outline"
                            title="تعديل البيانات والهاتف وحساب الدخول"
                          >
                            <Settings2 className="h-3.5 w-3.5" />
                            تعديل
                          </Button>
                        </Link>
                        <Button
                          size="sm"
                          variant="ghost"
                          title="تعديل النسبة سريعاً"
                          onClick={() =>
                            setEditing({
                              id: doc.id,
                              percentage: normalizeDoctorPercentage(
                                doc.percentage
                              ),
                              materials_share: normalizeMaterialsShare(
                                doc.materials_share
                              ),
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
