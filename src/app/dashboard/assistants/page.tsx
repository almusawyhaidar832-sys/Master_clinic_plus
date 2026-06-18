"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { getActiveClinicId } from "@/lib/clinic-context";
import { authPortalHeaders } from "@/lib/auth/api-portal";
import { breakdownAssistantSalary } from "@/lib/services/assistant-payroll";
import {
  ASSISTANT_COMPENSATION_LABELS,
  isDailyWageAssistant,
  normalizeAssistantCompensationMode,
  type AssistantCompensationMode,
} from "@/lib/services/assistant-compensation";
import { formatCurrency } from "@/lib/utils";
import { cn } from "@/lib/utils";
import { EditEmployeeSalaryModal } from "@/components/payroll/EditEmployeeSalaryModal";
import type { PayrollPerson } from "@/lib/services/payroll-persons";
import { ArchiveAssistantDialog } from "@/components/assistants/ArchiveAssistantDialog";
import {
  UserPlus, UserRound, Stethoscope, Eye, EyeOff,
  RefreshCw, CheckCircle2, XCircle, X, Pencil, Archive,
} from "lucide-react";

interface DoctorOption {
  id: string;
  full_name_ar: string;
}

interface AssistantRow {
  id: string;
  clinic_id: string;
  doctor_id: string;
  profile_id: string | null;
  full_name_ar: string;
  phone: string | null;
  is_active: boolean;
  total_salary?: number | null;
  doctor_share_percentage?: number | null;
  compensation_mode?: string | null;
  doctor?: { full_name_ar: string } | null;
  profile?: { username: string | null; is_active: boolean } | null;
}

function assistantRowToPayrollPerson(a: AssistantRow): PayrollPerson {
  const doctorName = a.doctor?.full_name_ar;
  const compensationMode = normalizeAssistantCompensationMode(
    a.compensation_mode ?? undefined
  );
  const role = isDailyWageAssistant(compensationMode)
    ? doctorName
      ? `مساعد يومي — ${doctorName}`
      : "مساعد يومي"
    : doctorName
      ? `مساعد — ${doctorName}`
      : "مساعد طبيب";
  return {
    id: a.id,
    name: a.full_name_ar,
    role,
    category: "assistant",
    full_name_ar: a.full_name_ar,
    job_title_ar: role,
    base_salary: isDailyWageAssistant(compensationMode)
      ? 0
      : Number(a.total_salary ?? 0),
    doctor_id: a.doctor_id,
    doctor_name_ar: doctorName ?? null,
    doctor_share_percentage: Number(a.doctor_share_percentage ?? 0),
    compensation_mode: compensationMode,
    is_active: true,
  };
}

export default function AssistantsPage() {
  const supabase = createClient();

  const [clinicId, setClinicId] = useState<string | null>(null);
  const [doctors, setDoctors] = useState<DoctorOption[]>([]);
  const [assistants, setAssistants] = useState<AssistantRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  const [fullName, setFullName] = useState("");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [phone, setPhone] = useState("");
  const [doctorId, setDoctorId] = useState("");
  const [totalSalary, setTotalSalary] = useState("");
  const [doctorSharePct, setDoctorSharePct] = useState("50");
  const [compensationMode, setCompensationMode] =
    useState<AssistantCompensationMode>("monthly_fixed");
  const [showPass, setShowPass] = useState(false);
  const [listFilter, setListFilter] = useState<"all" | "active" | "archived">("all");
  const [editingPerson, setEditingPerson] = useState<PayrollPerson | null>(null);
  const [archivingAssistant, setArchivingAssistant] = useState<AssistantRow | null>(null);

  const isDailyMode = isDailyWageAssistant(compensationMode);

  const previewBreakdown = useMemo(() => {
    if (isDailyMode) return null;
    const salary = Number(totalSalary) || 0;
    const pct = Number(doctorSharePct) || 0;
    return breakdownAssistantSalary({
      total_salary: salary,
      doctor_share_percentage: pct,
    });
  }, [totalSalary, doctorSharePct, isDailyMode]);

  const load = useCallback(async () => {
    setLoading(true);
    const active = await getActiveClinicId(supabase);
    if (!active?.clinicId) {
      setClinicId(null);
      setAssistants([]);
      setDoctors([]);
      setLoading(false);
      return;
    }

    setClinicId(active.clinicId);

    const [docsRes, asstRes] = await Promise.all([
      supabase
        .from("doctors")
        .select("id, full_name_ar")
        .eq("clinic_id", active.clinicId)
        .eq("is_active", true)
        .order("full_name_ar"),
      supabase
        .from("assistants")
        .select(
          `*,
          doctor:doctors ( full_name_ar ),
          profile:profiles ( username, is_active )`
        )
        .eq("clinic_id", active.clinicId)
        .order("created_at", { ascending: false }),
    ]);

    setDoctors((docsRes.data as DoctorOption[]) ?? []);
    setAssistants((asstRes.data as AssistantRow[]) ?? []);
    setLoading(false);
  }, [supabase]);

  useEffect(() => {
    if (doctors[0] && !doctorId) setDoctorId(doctors[0].id);
  }, [doctors, doctorId]);

  useEffect(() => {
    load();
  }, [load]);

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    if (!doctorId) {
      setMsg({ ok: false, text: "اختر الطبيب المسؤول" });
      return;
    }

    const salary = isDailyMode ? 0 : Number(totalSalary);
    const sharePct = Number(doctorSharePct);
    if (!isDailyMode && (!Number.isFinite(salary) || salary < 0)) {
      setMsg({ ok: false, text: "أدخل الراتب الكلي للمساعد" });
      return;
    }
    if (!Number.isFinite(sharePct) || sharePct < 0 || sharePct > 100) {
      setMsg({ ok: false, text: "نسبة تحمّل الطبيب يجب أن تكون بين 0 و 100" });
      return;
    }

    setSaving(true);
    setMsg(null);

    const res = await fetch("/api/admin/create-user", {
      method: "POST",
      credentials: "include",
      headers: {
        "Content-Type": "application/json",
        ...authPortalHeaders("accountant"),
      },
      body: JSON.stringify({
        full_name: fullName,
        username,
        password,
        phone: phone || null,
        role: "assistant",
        doctor_id: doctorId,
        total_salary: salary,
        doctor_share_percentage: sharePct,
        compensation_mode: compensationMode,
      }),
    });

    const json = await res.json();
    setSaving(false);

    if (!res.ok) {
      setMsg({ ok: false, text: json.error ?? "تعذر إنشاء الحساب" });
      return;
    }

    if (isDailyMode) {
      setMsg({
        ok: true,
        text: `${json.message} — مساعد بأجر يومي (نسبة الطبيب ${sharePct}%)`,
      });
    } else {
      const b = breakdownAssistantSalary({
        total_salary: salary,
        doctor_share_percentage: sharePct,
      });
      setMsg({
        ok: true,
        text: `${json.message} — راتب ${formatCurrency(b.totalSalary)} (طبيب ${b.doctorSharePercentage}% · عيادة ${formatCurrency(b.clinicShare)})`,
      });
    }

    setFullName("");
    setUsername("");
    setPassword("");
    setPhone("");
    setTotalSalary("");
    setDoctorSharePct("50");
    setCompensationMode("monthly_fixed");
    setShowForm(false);
    load();
  }

  async function restoreAssistant(row: AssistantRow) {
    if (row.profile_id) {
      await supabase
        .from("profiles")
        .update({ is_active: true })
        .eq("id", row.profile_id);
    }
    await supabase
      .from("assistants")
      .update({ is_active: true })
      .eq("id", row.id);
    load();
  }

  const filteredAssistants = useMemo(() => {
    return assistants.filter((a) => {
      const active = a.is_active && a.profile?.is_active !== false;
      if (listFilter === "active") return active;
      if (listFilter === "archived") return !active;
      return true;
    });
  }, [assistants, listFilter]);

  const activeCount = assistants.filter(
    (a) => a.is_active && a.profile?.is_active !== false
  ).length;

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="flex items-center gap-2 text-2xl font-bold text-slate-800">
            <UserRound className="h-7 w-7 text-teal-600" />
            Manage Assistants — إدارة المساعدين
          </h1>
          <p className="text-sm text-slate-500">
            إدارة المساعدين، تعديل الرواتب، وأرشفة من توليد الرواتب المستقبلية
          </p>
        </div>
        <button
          type="button"
          onClick={() => { setShowForm(true); setMsg(null); }}
          className="flex items-center gap-2 rounded-xl bg-teal-600 px-4 py-2.5 text-sm font-bold text-white hover:bg-teal-700"
        >
          <UserPlus className="h-4 w-4" />
          مساعد جديد
        </button>
      </div>

      {msg && (
        <div
          className={cn(
            "flex items-center gap-2 rounded-xl border p-3 text-sm",
            msg.ok
              ? "border-emerald-200 bg-emerald-50 text-emerald-700"
              : "border-red-200 bg-red-50 text-red-700"
          )}
        >
          {msg.ok ? <CheckCircle2 className="h-4 w-4" /> : <XCircle className="h-4 w-4" />}
          {msg.text}
        </div>
      )}

      {showForm && (
        <div className="rounded-2xl border border-teal-100 bg-white p-6 shadow-sm">
          <div className="mb-4 flex items-center justify-between">
            <h2 className="text-lg font-bold text-slate-700">تسجيل مساعد جديد</h2>
            <button type="button" onClick={() => setShowForm(false)} className="p-1 hover:bg-slate-100 rounded-lg">
              <X className="h-5 w-5 text-slate-400" />
            </button>
          </div>

          <form onSubmit={handleCreate} className="space-y-4">
            <div className="grid gap-4 sm:grid-cols-2">
              <div>
                <label className="mb-1 block text-sm font-medium text-slate-600">الاسم الكامل</label>
                <input
                  value={fullName}
                  onChange={(e) => setFullName(e.target.value)}
                  required
                  className="w-full rounded-xl border border-slate-200 bg-slate-50 px-4 py-2.5 text-sm"
                />
              </div>
              <div>
                <label className="mb-1 block text-sm font-medium text-slate-600">الهاتف</label>
                <input
                  value={phone}
                  onChange={(e) => setPhone(e.target.value)}
                  className="w-full rounded-xl border border-slate-200 bg-slate-50 px-4 py-2.5 text-sm"
                />
              </div>
              <div>
                <label className="mb-1 block text-sm font-medium text-slate-600">
                  الطبيب المسؤول <span className="text-red-500">*</span>
                </label>
                <select
                  value={doctorId}
                  onChange={(e) => setDoctorId(e.target.value)}
                  required
                  className="w-full rounded-xl border border-slate-200 bg-slate-50 px-4 py-2.5 text-sm"
                >
                  <option value="">— اختر الطبيب —</option>
                  {doctors.map((d) => (
                    <option key={d.id} value={d.id}>{d.full_name_ar}</option>
                  ))}
                </select>
              </div>
              <div className="sm:col-span-2">
                <label className="mb-1 block text-sm font-medium text-slate-600">
                  نظام التعويض
                </label>
                <div className="flex flex-wrap gap-4">
                  <label className="flex cursor-pointer items-center gap-2 text-sm">
                    <input
                      type="radio"
                      name="compensationMode"
                      checked={compensationMode === "monthly_fixed"}
                      onChange={() => setCompensationMode("monthly_fixed")}
                    />
                    {ASSISTANT_COMPENSATION_LABELS.monthly_fixed}
                  </label>
                  <label className="flex cursor-pointer items-center gap-2 text-sm">
                    <input
                      type="radio"
                      name="compensationMode"
                      checked={compensationMode === "daily_wage"}
                      onChange={() => setCompensationMode("daily_wage")}
                    />
                    {ASSISTANT_COMPENSATION_LABELS.daily_wage}
                  </label>
                </div>
                {isDailyMode && (
                  <p className="mt-1 text-xs text-teal-700">
                    سجّل أجر كل يوم من صفحة الرواتب — يُجمع الشهر ثم يُخصم عند
                    التوليد والتأكيد.
                  </p>
                )}
              </div>
              {!isDailyMode && (
              <div>
                <label className="mb-1 block text-sm font-medium text-slate-600">
                  الراتب الكلي للمساعد
                </label>
                <input
                  type="number"
                  min={0}
                  step="1000"
                  value={totalSalary}
                  onChange={(e) => setTotalSalary(e.target.value)}
                  required
                  dir="ltr"
                  className="w-full rounded-xl border border-slate-200 bg-slate-50 px-4 py-2.5 text-sm"
                />
              </div>
              )}
              <div>
                <label className="mb-1 block text-sm font-medium text-slate-600">
                  نسبة تحمّل الطبيب (%)
                </label>
                <input
                  type="number"
                  min={0}
                  max={100}
                  step="1"
                  value={doctorSharePct}
                  onChange={(e) => setDoctorSharePct(e.target.value)}
                  dir="ltr"
                  className="w-full rounded-xl border border-slate-200 bg-slate-50 px-4 py-2.5 text-sm"
                />
                <p className="mt-1 text-xs text-slate-400">
                  {previewBreakdown ? (
                    <>
                      الطبيب {formatCurrency(previewBreakdown.doctorShare)} · العيادة{" "}
                      {formatCurrency(previewBreakdown.clinicShare)}
                    </>
                  ) : (
                    <>نسبة تحمّل الطبيب من الأجر اليومي المُجمع</>
                  )}
                </p>
              </div>
              <div>
                <label className="mb-1 block text-sm font-medium text-slate-600">اسم المستخدم</label>
                <input
                  value={username}
                  onChange={(e) => setUsername(e.target.value.toLowerCase().replace(/\s/g, ""))}
                  required
                  dir="ltr"
                  className="w-full rounded-xl border border-slate-200 bg-slate-50 px-4 py-2.5 text-sm text-left"
                />
              </div>
              <div>
                <label className="mb-1 block text-sm font-medium text-slate-600">كلمة المرور</label>
                <div className="relative">
                  <input
                    type={showPass ? "text" : "password"}
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    required
                    minLength={6}
                    dir="ltr"
                    className="w-full rounded-xl border border-slate-200 bg-slate-50 px-4 py-2.5 text-sm text-left"
                  />
                  <button
                    type="button"
                    onClick={() => setShowPass(!showPass)}
                    className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400"
                  >
                    {showPass ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                  </button>
                </div>
              </div>
            </div>

            <p className="rounded-xl bg-teal-50 px-3 py-2 text-xs text-teal-800">
              بعد الإنشاء يدخل المساعد من بوابة «المساعد» في صفحة الدخول → يُوجَّه لحجوزات طبيبه فقط.
              يُخصم من تصفية الطبيب الشهرية: الراتب الكلي × نسبة تحمّل الطبيب.
            </p>

            <button
              type="submit"
              disabled={saving || doctors.length === 0}
              className="flex items-center gap-2 rounded-xl bg-teal-600 px-6 py-2.5 text-sm font-bold text-white disabled:opacity-60"
            >
              {saving && <RefreshCw className="h-4 w-4 animate-spin" />}
              {saving ? "جارٍ الإنشاء..." : "إنشاء حساب المساعد"}
            </button>
          </form>
        </div>
      )}

      <div className="flex flex-wrap gap-2">
        {(
          [
            { key: "all", label: `الكل (${assistants.length})` },
            { key: "active", label: `نشط (${activeCount})` },
            { key: "archived", label: `مؤرشف (${assistants.length - activeCount})` },
          ] as const
        ).map((f) => (
          <button
            key={f.key}
            type="button"
            onClick={() => setListFilter(f.key)}
            className={cn(
              "rounded-full px-3 py-1 text-xs font-medium",
              listFilter === f.key
                ? "bg-teal-600 text-white"
                : "bg-slate-100 text-slate-600 hover:bg-slate-200"
            )}
          >
            {f.label}
          </button>
        ))}
      </div>

      {loading ? (
        <div className="flex justify-center py-12">
          <RefreshCw className="h-6 w-6 animate-spin text-teal-600" />
        </div>
      ) : filteredAssistants.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-slate-200 p-10 text-center text-sm text-slate-400">
          {assistants.length === 0
            ? "لا يوجد مساعدون — أضف أول مساعد"
            : "لا يوجد مساعدون في هذا التصفية"}
        </div>
      ) : (
        <div className="space-y-2">
          {filteredAssistants.map((a) => {
            const mode = normalizeAssistantCompensationMode(
              a.compensation_mode ?? undefined
            );
            const daily = isDailyWageAssistant(mode);
            const b = daily
              ? null
              : breakdownAssistantSalary({
                  total_salary: Number(a.total_salary ?? 0),
                  doctor_share_percentage: Number(a.doctor_share_percentage ?? 0),
                });
            const active = a.is_active && a.profile?.is_active !== false;
            return (
              <div
                key={a.id}
                className={cn(
                  "flex flex-wrap items-center gap-4 rounded-2xl border bg-white p-4",
                  !active && "border-dashed opacity-70"
                )}
              >
                <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-teal-100 text-teal-700">
                  <UserRound className="h-5 w-5" />
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <p className="font-semibold text-slate-800">{a.full_name_ar}</p>
                    {!active && (
                      <span className="rounded-full bg-slate-200 px-2 py-0.5 text-xs text-slate-600">
                        مؤرشف
                      </span>
                    )}
                    {daily && (
                      <span className="rounded-full bg-sky-100 px-2 py-0.5 text-xs text-sky-800">
                        أجر يومي
                      </span>
                    )}
                  </div>
                  <div className="flex flex-wrap gap-2 text-xs text-slate-500">
                    <span className="flex items-center gap-1">
                      <Stethoscope className="h-3 w-3" />
                      {a.doctor?.full_name_ar ?? "طبيب"}
                    </span>
                    {a.profile?.username && (
                      <span dir="ltr" className="rounded bg-slate-100 px-1.5 font-mono">
                        @{a.profile.username}
                      </span>
                    )}
                    {daily ? (
                      <span className="rounded-full bg-sky-50 px-2 py-0.5 text-sky-800">
                        أجر يومي متغير
                      </span>
                    ) : b ? (
                      <>
                        <span className="rounded-full bg-teal-50 px-2 py-0.5 text-teal-700">
                          كلي {formatCurrency(b.totalSalary)}
                        </span>
                        <span className="rounded-full bg-slate-100 px-2 py-0.5">
                          عيادة {formatCurrency(b.clinicShare)}
                        </span>
                        <span className="rounded-full bg-amber-50 px-2 py-0.5 text-amber-800">
                          طبيب {formatCurrency(b.doctorShare)} ({b.doctorSharePercentage}%)
                        </span>
                      </>
                    ) : null}
                  </div>
                </div>
                <div className="flex flex-wrap gap-2">
                  <button
                    type="button"
                    onClick={() => setEditingPerson(assistantRowToPayrollPerson(a))}
                    className="flex items-center gap-1 rounded-xl border border-teal-200 px-3 py-1.5 text-xs font-medium text-teal-700 hover:bg-teal-50"
                  >
                    <Pencil className="h-3.5 w-3.5" />
                    Edit
                  </button>
                  {active ? (
                    <button
                      type="button"
                      onClick={() => setArchivingAssistant(a)}
                      className="flex items-center gap-1 rounded-xl border border-amber-200 px-3 py-1.5 text-xs font-medium text-amber-800 hover:bg-amber-50"
                    >
                      <Archive className="h-3.5 w-3.5" />
                      أرشفة
                    </button>
                  ) : (
                    <button
                      type="button"
                      onClick={() => restoreAssistant(a)}
                      className="rounded-xl border border-emerald-200 px-3 py-1.5 text-xs font-medium text-emerald-700 hover:bg-emerald-50"
                    >
                      استعادة
                    </button>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {editingPerson && (
        <EditEmployeeSalaryModal
          person={editingPerson}
          onClose={() => setEditingPerson(null)}
          onSaved={() => {
            setMsg({
              ok: true,
              text: "تم تحديث راتب المساعد — سجلات الرواتب غير المُصرفة مُحدَّثة",
            });
            load();
          }}
        />
      )}

      {archivingAssistant && (
        <ArchiveAssistantDialog
          assistant={archivingAssistant}
          onClose={() => setArchivingAssistant(null)}
          onArchived={() => {
            setMsg({ ok: true, text: `تم أرشفة ${archivingAssistant.full_name_ar}` });
            load();
          }}
        />
      )}
    </div>
  );
}
