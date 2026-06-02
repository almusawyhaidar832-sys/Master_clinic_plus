"use client";

import { useCallback, useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { cn } from "@/lib/utils";
import {
  Building2, UserPlus, CheckCircle2, XCircle,
  Eye, EyeOff, RefreshCw, ChevronDown, ChevronUp,
} from "lucide-react";
import { SPECIALTY_LABELS } from "@/types/modules";
import type { ClinicSpecialty } from "@/types/modules";

interface Clinic {
  id: string;
  name: string;
  name_ar: string | null;
  phone: string | null;
  created_at: string;
}

const SPECIALTIES: { value: ClinicSpecialty; label: string }[] = [
  { value: "dental",           label: SPECIALTY_LABELS.dental           },
  { value: "general_medicine", label: SPECIALTY_LABELS.general_medicine },
  { value: "cosmetic",         label: SPECIALTY_LABELS.cosmetic         },
  { value: "pediatrics",       label: SPECIALTY_LABELS.pediatrics       },
  { value: "ophthalmology",    label: SPECIALTY_LABELS.ophthalmology    },
  { value: "physiotherapy",    label: SPECIALTY_LABELS.physiotherapy    },
  { value: "custom",           label: SPECIALTY_LABELS.custom           },
];

export default function ClinicsAdminPage() {
  const supabase = createClient();
  const [clinics, setClinics] = useState<Clinic[]>([]);
  const [loading, setLoading]   = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [saving, setSaving]     = useState(false);
  const [msg, setMsg]           = useState<{ ok: boolean; text: string } | null>(null);
  const [showPass, setShowPass] = useState(false);

  // form
  const [clinicName,    setClinicName]    = useState("");
  const [clinicNameAr,  setClinicNameAr]  = useState("");
  const [clinicPhone,   setClinicPhone]   = useState("");
  const [specialty,     setSpecialty]     = useState<ClinicSpecialty>("dental");
  const [adminName,     setAdminName]     = useState("");
  const [adminUsername, setAdminUsername] = useState("");
  const [adminPassword, setAdminPassword] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    const { data } = await supabase
      .from("clinics")
      .select("id, name, name_ar, phone, created_at")
      .order("created_at", { ascending: false });
    setClinics((data as Clinic[]) ?? []);
    setLoading(false);
  }, [supabase]);

  useEffect(() => { load(); }, [load]);

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    setMsg(null);
    setSaving(true);

    const res = await fetch("/api/admin/create-clinic", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        clinic_name:    clinicName,
        clinic_name_ar: clinicNameAr || clinicName,
        clinic_phone:   clinicPhone,
        specialty,
        admin_full_name: adminName,
        admin_username:  adminUsername,
        admin_password:  adminPassword,
      }),
    });

    const json = await res.json();
    setSaving(false);

    if (!res.ok) {
      setMsg({ ok: false, text: json.error });
      return;
    }

    setMsg({ ok: true, text: json.message });
    // reset form
    setClinicName(""); setClinicNameAr(""); setClinicPhone("");
    setAdminName(""); setAdminUsername(""); setAdminPassword("");
    setShowForm(false);
    load();
  }

  return (
    <div className="mx-auto max-w-3xl space-y-6 p-4">

      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-slate-text">إدارة العيادات</h1>
          <p className="text-sm text-slate-muted">أنشئ عيادة جديدة مع حساب المدير دفعة واحدة</p>
        </div>
        <button
          onClick={() => { setShowForm(!showForm); setMsg(null); }}
          className="flex items-center gap-2 rounded-xl bg-primary px-4 py-2.5 text-sm font-bold text-white hover:bg-primary/90"
        >
          <Building2 className="h-4 w-4" />
          عيادة جديدة
        </button>
      </div>

      {/* Global message */}
      {msg && (
        <div className={cn(
          "flex items-start gap-3 rounded-2xl border p-4 text-sm",
          msg.ok
            ? "border-emerald-200 bg-emerald-50 text-emerald-700"
            : "border-red-200 bg-red-50 text-red-700"
        )}>
          {msg.ok
            ? <CheckCircle2 className="h-5 w-5 flex-shrink-0 mt-0.5" />
            : <XCircle     className="h-5 w-5 flex-shrink-0 mt-0.5" />}
          <p>{msg.text}</p>
        </div>
      )}

      {/* Create form */}
      {showForm && (
        <div className="rounded-2xl border-2 border-primary/20 bg-white p-6 shadow-sm">
          <h2 className="mb-5 flex items-center gap-2 text-lg font-bold text-slate-700">
            <UserPlus className="h-5 w-5 text-primary" />
            إنشاء عيادة + حساب مدير
          </h2>

          <form onSubmit={handleCreate} className="space-y-5">

            {/* Clinic info */}
            <div>
              <p className="mb-3 text-xs font-bold uppercase tracking-wider text-slate-400">بيانات العيادة</p>
              <div className="grid gap-3 sm:grid-cols-2">
                <div>
                  <label className="mb-1 block text-sm font-medium text-slate-600">اسم العيادة (عربي)</label>
                  <input
                    value={clinicNameAr}
                    onChange={(e) => setClinicNameAr(e.target.value)}
                    placeholder="عيادة الابتسامة"
                    className="w-full rounded-xl border border-slate-200 bg-slate-50 px-4 py-2.5 text-sm focus:border-primary focus:outline-none"
                  />
                </div>
                <div>
                  <label className="mb-1 block text-sm font-medium text-slate-600">اسم العيادة (إنجليزي) *</label>
                  <input
                    value={clinicName}
                    onChange={(e) => setClinicName(e.target.value)}
                    placeholder="Al-Ibtisama Clinic"
                    required
                    dir="ltr"
                    className="w-full rounded-xl border border-slate-200 bg-slate-50 px-4 py-2.5 text-sm text-left focus:border-primary focus:outline-none"
                  />
                </div>
                <div>
                  <label className="mb-1 block text-sm font-medium text-slate-600">هاتف العيادة</label>
                  <input
                    value={clinicPhone}
                    onChange={(e) => setClinicPhone(e.target.value)}
                    placeholder="07xxxxxxxx"
                    className="w-full rounded-xl border border-slate-200 bg-slate-50 px-4 py-2.5 text-sm focus:border-primary focus:outline-none"
                  />
                </div>
                <div>
                  <label className="mb-1 block text-sm font-medium text-slate-600">التخصص</label>
                  <select
                    value={specialty}
                    onChange={(e) => setSpecialty(e.target.value as ClinicSpecialty)}
                    className="w-full rounded-xl border border-slate-200 bg-slate-50 px-4 py-2.5 text-sm focus:border-primary focus:outline-none"
                  >
                    {SPECIALTIES.map((s) => (
                      <option key={s.value} value={s.value}>{s.label}</option>
                    ))}
                  </select>
                </div>
              </div>
            </div>

            <hr className="border-slate-100" />

            {/* Admin account */}
            <div>
              <p className="mb-3 text-xs font-bold uppercase tracking-wider text-slate-400">حساب مدير العيادة</p>
              <div className="grid gap-3 sm:grid-cols-2">
                <div className="sm:col-span-2">
                  <label className="mb-1 block text-sm font-medium text-slate-600">الاسم الكامل</label>
                  <input
                    value={adminName}
                    onChange={(e) => setAdminName(e.target.value)}
                    placeholder="أحمد محمد الجبوري"
                    required
                    className="w-full rounded-xl border border-slate-200 bg-slate-50 px-4 py-2.5 text-sm focus:border-primary focus:outline-none"
                  />
                </div>
                <div>
                  <label className="mb-1 block text-sm font-medium text-slate-600">اسم المستخدم (للدخول)</label>
                  <input
                    value={adminUsername}
                    onChange={(e) => setAdminUsername(e.target.value.toLowerCase().replace(/\s/g, ""))}
                    placeholder="clinic_admin"
                    required
                    dir="ltr"
                    className="w-full rounded-xl border border-slate-200 bg-slate-50 px-4 py-2.5 text-sm text-left focus:border-primary focus:outline-none"
                  />
                  <p className="mt-0.5 text-xs text-slate-400">أحرف صغيرة وأرقام فقط</p>
                </div>
                <div>
                  <label className="mb-1 block text-sm font-medium text-slate-600">كلمة المرور</label>
                  <div className="relative">
                    <input
                      type={showPass ? "text" : "password"}
                      value={adminPassword}
                      onChange={(e) => setAdminPassword(e.target.value)}
                      placeholder="6 أحرف على الأقل"
                      required
                      minLength={6}
                      dir="ltr"
                      className="w-full rounded-xl border border-slate-200 bg-slate-50 px-4 py-2.5 text-sm text-left focus:border-primary focus:outline-none"
                    />
                    <button type="button" onClick={() => setShowPass(!showPass)}
                      className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400">
                      {showPass ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                    </button>
                  </div>
                </div>
              </div>
            </div>

            {/* Summary */}
            {clinicName && adminUsername && (
              <div className="rounded-xl bg-primary/5 border border-primary/20 p-4 text-sm space-y-1">
                <p className="font-bold text-primary">ملخص ما سيتم إنشاؤه:</p>
                <p className="text-slate-600">
                  🏥 عيادة: <strong>{clinicNameAr || clinicName}</strong>
                </p>
                <p className="text-slate-600">
                  👤 مدير: <strong>{adminName}</strong> — يدخل بـ <strong dir="ltr">{adminUsername}</strong>
                </p>
                <p className="text-slate-600">
                  🔧 التخصص: <strong>{SPECIALTIES.find(s => s.value === specialty)?.label}</strong>
                </p>
              </div>
            )}

            <div className="flex gap-3">
              <button
                type="submit"
                disabled={saving}
                className="flex items-center gap-2 rounded-xl bg-primary px-6 py-2.5 text-sm font-bold text-white hover:bg-primary/90 disabled:opacity-60"
              >
                {saving && <RefreshCw className="h-4 w-4 animate-spin" />}
                {saving ? "جارٍ الإنشاء..." : "إنشاء العيادة والحساب"}
              </button>
              <button type="button" onClick={() => setShowForm(false)}
                className="rounded-xl border border-slate-200 px-4 py-2.5 text-sm text-slate-600 hover:bg-slate-50">
                إلغاء
              </button>
            </div>
          </form>
        </div>
      )}

      {/* Clinics list */}
      <div className="space-y-2">
        <h2 className="text-sm font-bold text-slate-500">
          العيادات المسجّلة ({clinics.length})
        </h2>
        {loading ? (
          <div className="flex justify-center py-8">
            <RefreshCw className="h-5 w-5 animate-spin text-primary" />
          </div>
        ) : clinics.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-slate-200 bg-white py-12 text-center text-slate-400">
            <Building2 className="mx-auto mb-2 h-8 w-8 opacity-30" />
            <p className="text-sm">لا توجد عيادات بعد — أنشئ أولى عيادة</p>
          </div>
        ) : (
          clinics.map((c) => (
            <ClinicCard key={c.id} clinic={c} />
          ))
        )}
      </div>
    </div>
  );
}

function ClinicCard({ clinic }: { clinic: Clinic }) {
  const supabase = createClient();
  const [users, setUsers] = useState<{ full_name: string; username: string | null; role: string }[]>([]);
  const [open, setOpen] = useState(false);

  async function loadUsers() {
    const { data } = await supabase
      .from("profiles")
      .select("full_name, username, role")
      .eq("clinic_id", clinic.id);
    setUsers(data ?? []);
  }

  return (
    <div className="rounded-2xl border border-slate-100 bg-white shadow-sm">
      <button
        className="flex w-full items-center gap-3 p-4 text-right"
        onClick={() => { setOpen(!open); if (!open) loadUsers(); }}
      >
        <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-primary/10 text-primary font-bold">
          {(clinic.name_ar || clinic.name).charAt(0)}
        </div>
        <div className="flex-1 text-right">
          <p className="font-semibold text-slate-800">{clinic.name_ar || clinic.name}</p>
          <p className="text-xs text-slate-400">
            {clinic.phone ?? "بدون هاتف"} · {new Date(clinic.created_at).toLocaleDateString("ar-IQ")}
          </p>
        </div>
        {open ? <ChevronUp className="h-4 w-4 text-slate-400" /> : <ChevronDown className="h-4 w-4 text-slate-400" />}
      </button>
      {open && (
        <div className="border-t border-slate-100 px-4 pb-4 pt-3">
          <p className="mb-2 text-xs font-bold text-slate-500">المستخدمون</p>
          {users.length === 0
            ? <p className="text-xs text-slate-400">لا يوجد مستخدمون</p>
            : <ul className="space-y-1">
                {users.map((u) => (
                  <li key={u.username} className="flex items-center gap-2 text-sm text-slate-600">
                    <span className={cn(
                      "rounded-full px-2 py-0.5 text-xs font-medium",
                      u.role === "doctor" ? "bg-blue-100 text-blue-700" : "bg-violet-100 text-violet-700"
                    )}>
                      {u.role === "doctor" ? "طبيب" : u.role === "accountant" ? "محاسب" : "مالك"}
                    </span>
                    <span>{u.full_name}</span>
                    {u.username && <span dir="ltr" className="text-xs text-slate-400">@{u.username}</span>}
                  </li>
                ))}
              </ul>
          }
        </div>
      )}
    </div>
  );
}
