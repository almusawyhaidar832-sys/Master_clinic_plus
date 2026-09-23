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
import { cn, formatCurrency } from "@/lib/utils";
import { authPortalHeaders } from "@/lib/auth/api-portal";
import { PageHeader } from "@/components/ui/PageHeader";
import { StatTile } from "@/components/ui/StatTile";
import { useLanguage } from "@/contexts/LanguageContext";
import {
  Plus,
  RefreshCw,
  PencilLine,
  Check,
  X,
  Settings2,
  Stethoscope,
  Users,
  UserCheck,
  KeyRound,
  Phone,
} from "lucide-react";

interface EditState {
  id: string;
  percentage: string;
  materials_share: string;
}

export default function DoctorsPage() {
  const { bi } = useLanguage();
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
      <PageHeader
        eyebrow={bi("إدارة العيادة", "Clinic management")}
        title="الأطباء"
        subtitle={
          isLoading
            ? "جاري التحميل..."
            : `${doctors.length} طبيب${clinicName ? ` — ${clinicName}` : ""}`
        }
        icon={Stethoscope}
        actions={
          <>
            <Button variant="outline" size="sm" onClick={load} disabled={isLoading} aria-label={bi("تحديث", "Refresh")}>
              <RefreshCw className={`h-4 w-4 ${isLoading ? "animate-spin" : ""}`} />
            </Button>
            <Link href="/dashboard/doctors/new">
              <Button>
                <Plus className="h-4 w-4" />
                إضافة طبيب
              </Button>
            </Link>
          </>
        }
      />

      {!isLoading && doctors.length > 0 && (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          <StatTile label={bi("إجمالي الأطباء", "Total doctors")} value={doctors.length} icon={Users} tone="navy" />
          <StatTile
            label={bi("نشط", "Active")}
            value={doctors.filter((d) => d.is_active).length}
            icon={UserCheck}
            tone="success"
          />
          <StatTile
            label={bi("بدون حساب دخول", "No login account")}
            value={doctors.filter((d) => !d.profile_id).length}
            icon={KeyRound}
            tone="gold"
          />
        </div>
      )}

      {isLoading ? (
        <div className="grid gap-4 lg:grid-cols-2">
          {[1, 2, 3, 4].map((i) => (
            <div key={i} className="mc-skeleton h-40 rounded-2xl" />
          ))}
        </div>
      ) : doctors.length === 0 ? (
        <div className="mc-panel flex flex-col items-center px-6 py-14 text-center">
          <span className="mc-icon-tile mb-4 h-14 w-14">
            <Stethoscope className="h-7 w-7" />
          </span>
          <p className="text-sm font-medium text-slate-muted">
            لا يوجد أطباء — اضغط «إضافة طبيب» للبدء
          </p>
        </div>
      ) : (
        <div className="grid gap-4 lg:grid-cols-2">
          {doctors.map((doc) => {
            const isEditing = editing?.id === doc.id;
            const isSaving = saving === doc.id;
            const bal = balances.get(doc.id);

            return (
              <div
                key={doc.id}
                className={cn(
                  "mc-panel mc-hover-lift flex flex-col",
                  !doc.is_active && "opacity-70"
                )}
              >
                <div className="flex items-start gap-4 p-5">
                  <span className="flex h-14 w-14 shrink-0 items-center justify-center rounded-2xl bg-mc-pearl text-xl font-extrabold text-[#0b1f3a] shadow-gold ring-1 ring-inset ring-premium-300/60">
                    {doc.full_name_ar.trim().charAt(0)}
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <p className="truncate text-base font-bold text-slate-text">
                        {doc.full_name_ar}
                      </p>
                      <span
                        className={cn(
                          "inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-semibold ring-1 ring-inset",
                          doc.is_active
                            ? "bg-success text-success-text ring-success-border"
                            : "bg-surface text-slate-muted ring-slate-border"
                        )}
                      >
                        <span className={cn("h-1.5 w-1.5 rounded-full", doc.is_active ? "bg-current" : "bg-slate-muted")} />
                        {doc.is_active ? "نشط" : "موقوف"}
                      </span>
                    </div>
                    {doc.specialty_ar && (
                      <p className="mt-0.5 text-sm text-slate-muted">{doc.specialty_ar}</p>
                    )}
                    <p className="mt-1.5 inline-flex rounded-lg bg-primary-50 px-2 py-0.5 text-[11px] font-semibold text-primary-700 ring-1 ring-inset ring-primary-200">
                      {doctorPaymentLabel(doc)}
                    </p>
                    <div className="mt-2.5 flex flex-wrap gap-x-4 gap-y-1 text-xs">
                      <span className="inline-flex items-center gap-1.5 text-slate-muted" dir="ltr">
                        <Phone className="h-3.5 w-3.5 text-premium-500" />
                        {doc.phone ? (
                          <span className="tabular-nums">{doc.phone}</span>
                        ) : (
                          <span className="text-warning-text">بدون رقم واتساب</span>
                        )}
                      </span>
                      {!doc.profile_id && (
                        <span className="inline-flex items-center gap-1.5 text-warning-text">
                          <KeyRound className="h-3.5 w-3.5" />
                          بدون حساب دخول
                        </span>
                      )}
                    </div>
                  </div>
                  {bal && (
                    <div
                      className={cn(
                        "shrink-0 rounded-xl px-3 py-2 text-end ring-1 ring-inset",
                        bal.isDebtor
                          ? "bg-debt text-debt-text ring-debt-border"
                          : "bg-success text-success-text ring-success-border"
                      )}
                    >
                      <p className="text-[10px] font-semibold opacity-80">الرصيد</p>
                      <p className="text-sm font-black tabular-nums">
                        {formatCurrency(Math.abs(bal.netBalance))}
                      </p>
                      {bal.isDebtor && (
                        <p className="text-[10px] font-bold">(مدين)</p>
                      )}
                    </div>
                  )}
                </div>

                <div className="mt-auto flex flex-wrap items-center justify-between gap-2 border-t border-slate-border bg-surface px-5 py-3">
                    {isEditing ? (
                      <>
                        <div className="me-auto flex items-center gap-2">
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
                        <div className="me-auto flex items-center gap-2 text-sm">
                          <span className="rounded-full bg-mc-navy px-2.5 py-1 text-xs font-bold text-white">
                            {formatPercentageLabel(doc.percentage)}
                          </span>
                          <span className="rounded-full bg-premium-50 px-2.5 py-1 text-xs font-semibold text-premium-700 ring-1 ring-inset ring-premium-200">
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
                              ? "text-slate-muted hover:border-debt-border hover:bg-debt hover:text-debt-text"
                              : "border-success-border text-success-text hover:bg-success"
                          }
                        >
                          {doc.is_active ? "إيقاف" : "تفعيل"}
                        </Button>
                      </>
                    )}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
