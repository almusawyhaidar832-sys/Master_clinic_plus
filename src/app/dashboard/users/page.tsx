"use client";

/**
 * صفحة إدارة المستخدمين
 *
 * الصلاحيات:
 *   super_admin  → يرى جميع المستخدمين، يُنشئ محاسبين فقط
 *   accountant   → يرى الجميع، يُنشئ أطباء أو مساعدين
 */

import { useCallback, useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { getCurrentUser } from "@/lib/supabase/auth-helpers";
import { cn } from "@/lib/utils";
import { authPortalHeaders } from "@/lib/auth/api-portal";
import {
  UserPlus, Users, Stethoscope, UserCog,
  Eye, EyeOff, CheckCircle2, XCircle, RefreshCw, ShieldAlert,
  UserRound,
} from "lucide-react";
import { PageHeader } from "@/components/ui/PageHeader";
import { StatTile } from "@/components/ui/StatTile";
import { useLanguage } from "@/contexts/LanguageContext";

interface ClinicUser {
  id: string;
  full_name: string;
  username: string | null;
  role: "accountant" | "doctor" | "super_admin" | "assistant";
  phone: string | null;
  is_active: boolean;
  created_at: string;
}

interface ClinicDoctor {
  id: string;
  full_name_ar: string;
}

type CreateTargetRole = "accountant" | "doctor" | "assistant";

const ROLE_CONFIG = {
  doctor:      { label: "طبيب",        icon: Stethoscope, color: "bg-primary-50 text-primary-700 ring-1 ring-inset ring-primary-200"  },
  accountant:  { label: "محاسب",       icon: UserCog,     color: "bg-royal-50 text-royal-700 ring-1 ring-inset ring-royal-200"        },
  super_admin: { label: "مالك",        icon: Users,       color: "bg-premium-50 text-premium-700 ring-1 ring-inset ring-premium-200"  },
  assistant:   { label: "مساعد طبيب",  icon: UserRound,   color: "bg-surface text-slate-text ring-1 ring-inset ring-slate-border"     },
};

const ALLOWED_TARGETS: Record<string, CreateTargetRole[]> = {
  super_admin: ["accountant"],
  accountant:  ["doctor", "assistant"],
};

export default function UsersPage() {
  const supabase = createClient();
  const { bi } = useLanguage();

  const [callerRole, setCallerRole] = useState<string | null>(null);
  const [users,      setUsers]      = useState<ClinicUser[]>([]);
  const [doctors,    setDoctors]    = useState<ClinicDoctor[]>([]);
  const [loading,    setLoading]    = useState(true);
  const [showForm,   setShowForm]   = useState(false);

  const [targetRole, setTargetRole] = useState<CreateTargetRole | null>(null);
  const [fullName,   setFullName]   = useState("");
  const [username,   setUsername]   = useState("");
  const [password,   setPassword]   = useState("");
  const [phone,      setPhone]      = useState("");
  const [doctorId,   setDoctorId]   = useState("");
  const [baseSalary, setBaseSalary] = useState("");
  const [jobTitle,   setJobTitle]   = useState("محاسب");
  const [showPass,   setShowPass]   = useState(false);
  const [saving,     setSaving]     = useState(false);
  const [msg,        setMsg]        = useState<{ ok: boolean; text: string } | null>(null);

  const allowedTargets = callerRole ? ALLOWED_TARGETS[callerRole] ?? [] : [];

  const loadUsers = useCallback(async () => {
    setLoading(true);

    const user = await getCurrentUser(supabase);
    if (!user) {
      setLoading(false);
      return;
    }

    const { data: profile } = await supabase
      .from("profiles")
      .select("role, clinic_id")
      .eq("id", user.id)
      .maybeSingle();

    if (profile) setCallerRole(profile.role);

    if (!profile?.clinic_id) {
      setUsers([]);
      setDoctors([]);
      setLoading(false);
      return;
    }

    const [usersRes, doctorsRes] = await Promise.all([
      supabase
        .from("profiles")
        .select("id, full_name, username, role, phone, is_active, created_at")
        .eq("clinic_id", profile.clinic_id)
        .order("created_at", { ascending: false }),
      supabase
        .from("doctors")
        .select("id, full_name_ar")
        .eq("clinic_id", profile.clinic_id)
        .eq("is_active", true)
        .order("full_name_ar"),
    ]);

    setUsers((usersRes.data as ClinicUser[]) ?? []);
    setDoctors((doctorsRes.data as ClinicDoctor[]) ?? []);
    setLoading(false);
  }, [supabase]);

  useEffect(() => { loadUsers(); }, [loadUsers]);

  function openForm(role: CreateTargetRole) {
    setTargetRole(role);
    setShowForm(true);
    setMsg(null);
    setDoctorId("");
    setBaseSalary("");
    setJobTitle("محاسب");
  }

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    if (!targetRole) return;
    if (targetRole === "assistant" && !doctorId) {
      setMsg({ ok: false, text: "اختر الطبيب المرتبط بالمساعد" });
      return;
    }
    if (targetRole === "accountant") {
      const salary = Number(baseSalary);
      if (!Number.isFinite(salary) || salary <= 0) {
        setMsg({ ok: false, text: "أدخل الراتب الشهري للمحاسب" });
        return;
      }
    }

    setMsg(null);
    setSaving(true);

    const res = await fetch("/api/admin/create-user", {
      method: "POST",
      credentials: "include",
      headers: {
        "Content-Type": "application/json",
        ...authPortalHeaders("accountant"),
      },
      body: JSON.stringify({
        username,
        password,
        full_name: fullName,
        role: targetRole,
        phone,
        doctor_id: targetRole === "assistant" ? doctorId : undefined,
        base_salary: targetRole === "accountant" ? Number(baseSalary) : undefined,
        job_title: targetRole === "accountant" ? jobTitle.trim() || "محاسب" : undefined,
      }),
    });

    const json = await res.json();
    setSaving(false);

    if (!res.ok) {
      setMsg({ ok: false, text: json.error ?? "تعذر إنشاء الحساب" });
      return;
    }

    setMsg({ ok: true, text: json.message });
    setFullName(""); setUsername(""); setPassword(""); setPhone(""); setDoctorId("");
    setBaseSalary(""); setJobTitle("محاسب");
    setShowForm(false);
    setTargetRole(null);
    loadUsers();
  }

  async function toggleActive(user: ClinicUser) {
    await supabase
      .from("profiles")
      .update({ is_active: !user.is_active })
      .eq("id", user.id);
    loadUsers();
  }

  const activeCount    = users.filter((u) => u.is_active).length;
  const doctorCount    = users.filter((u) => u.role === "doctor").length;
  const assistantCount = users.filter((u) => u.role === "assistant").length;
  const accountCount   = users.filter((u) => u.role === "accountant").length;

  const targetCfg = targetRole ? ROLE_CONFIG[targetRole] : null;
  const TargetIcon = targetCfg?.icon ?? UserPlus;

  const destinationForRole = (role: CreateTargetRole) => {
    if (role === "doctor") return "/doctor";
    if (role === "assistant") return "/assistant/dashboard";
    return "/dashboard";
  };

  return (
    <div className="mx-auto max-w-5xl space-y-6">

      <PageHeader
        eyebrow={bi("إدارة العيادة", "Clinic management")}
        title="إدارة المستخدمين"
        subtitle={
          callerRole === "super_admin"
            ? "أضف محاسبين للعيادة"
            : "أضف أطباء أو مساعدين — المساعد يُربط تلقائياً بالطبيب والعيادة"
        }
        icon={Users}
        className="mb-0"
        actions={
          allowedTargets.length > 0 ? (
            <>
              {allowedTargets.map((role) => (
                <button
                  key={role}
                  type="button"
                  onClick={() => openForm(role)}
                  className="mc-btn-navy"
                >
                  <UserPlus className="h-4 w-4" />
                  {role === "assistant" ? "مساعد جديد" : role === "doctor" ? "طبيب جديد" : "محاسب جديد"}
                </button>
              ))}
            </>
          ) : undefined
        }
      />

      {callerRole && (
        <div className="flex items-start gap-3 rounded-2xl border border-primary-200 bg-primary-50 p-4 text-sm text-primary-800">
          <span className="mc-icon-tile h-9 w-9 rounded-xl">
            <ShieldAlert className="h-4 w-4" />
          </span>
          <div>
            <p className="font-semibold">
              {callerRole === "super_admin"
                ? "أنت مسجل كـ مالك — يمكنك إنشاء حسابات المحاسبين فقط"
                : "أنت مسجل كـ محاسب — يمكنك إنشاء أطباء ومساعدين"}
            </p>
            <p className="mt-0.5 text-xs text-primary-700">
              عند تسجيل مساعد، اختر الطبيب من القائمة لربطه بـ doctor_id و clinic_id تلقائياً.
            </p>
          </div>
        </div>
      )}

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatTile label="النشطون" value={activeCount} icon={CheckCircle2} tone="success" />
        <StatTile label="الأطباء" value={doctorCount} icon={Stethoscope} tone="navy" />
        <StatTile label="المساعدون" value={assistantCount} icon={UserRound} tone="muted" />
        <StatTile label="المحاسبون" value={accountCount} icon={UserCog} tone="royal" />
      </div>

      {showForm && targetRole && targetCfg && (
        <section className="mc-panel animate-fade-in">
          <div className="mc-panel-head">
            <h2 className="mc-panel-title">
              <TargetIcon />
              {targetRole === "assistant" ? "تسجيل مساعد" : `إنشاء حساب ${targetCfg.label} جديد`}
            </h2>
            <span className="flex items-center gap-2 text-xs text-slate-muted">
              <span className={cn("rounded-full px-2.5 py-1 text-xs font-bold", targetCfg.color)}>
                {targetCfg.label}
              </span>
              الدور المحدد بناءً على صلاحيتك
            </span>
          </div>
          <div className="mc-panel-body">

          {msg && (
            <div className={cn(
              "mb-4 flex items-center gap-2 rounded-xl border p-3 text-sm",
              msg.ok
                ? "border-success-border bg-success text-success-text"
                : "border-debt-border bg-debt text-debt-text"
            )}>
              {msg.ok
                ? <CheckCircle2 className="h-4 w-4 flex-shrink-0" />
                : <XCircle     className="h-4 w-4 flex-shrink-0" />}
              {msg.text}
            </div>
          )}

          <form onSubmit={handleCreate} className="space-y-4">
            <div className="grid gap-4 sm:grid-cols-2">
              <div>
                <label className="mb-1.5 block text-xs font-semibold text-slate-muted">الاسم الكامل</label>
                <input
                  value={fullName}
                  onChange={(e) => setFullName(e.target.value)}
                  required
                  placeholder={targetRole === "doctor" ? "د. محمد أحمد" : targetRole === "assistant" ? "سارة علي" : "أحمد محمد"}
                  className="mc-field"
                />
              </div>
              <div>
                <label className="mb-1.5 block text-xs font-semibold text-slate-muted">رقم الهاتف (اختياري)</label>
                <input
                  value={phone}
                  onChange={(e) => setPhone(e.target.value)}
                  placeholder="07xxxxxxxx"
                  className="mc-field"
                />
              </div>

              {targetRole === "accountant" && (
                <>
                  <div>
                    <label className="mb-1.5 block text-xs font-semibold text-slate-muted">
                      الراتب الشهري <span className="text-debt-text">*</span>
                    </label>
                    <input
                      type="number"
                      min={1}
                      step="1000"
                      value={baseSalary}
                      onChange={(e) => setBaseSalary(e.target.value)}
                      required
                      placeholder="800000"
                      dir="ltr"
                      className="mc-field text-left"
                    />
                    <p className="mt-1 text-xs text-royal-600">
                      يظهر في قائمة الرواتب ويُصرف كمصاريف عيادة
                    </p>
                  </div>
                  <div>
                    <label className="mb-1.5 block text-xs font-semibold text-slate-muted">الوظيفة</label>
                    <input
                      value={jobTitle}
                      onChange={(e) => setJobTitle(e.target.value)}
                      placeholder="محاسب"
                      className="mc-field"
                    />
                  </div>
                </>
              )}

              {targetRole === "assistant" && (
                <div className="sm:col-span-2">
                  <label className="mb-1.5 block text-xs font-semibold text-slate-muted">
                    الطبيب المرتبط <span className="text-debt-text">*</span>
                  </label>
                  <select
                    value={doctorId}
                    onChange={(e) => setDoctorId(e.target.value)}
                    required
                    className="mc-field"
                  >
                    <option value="">— اختر الطبيب —</option>
                    {doctors.map((d) => (
                      <option key={d.id} value={d.id}>
                        {d.full_name_ar}
                      </option>
                    ))}
                  </select>
                  {doctors.length === 0 && (
                    <p className="mt-1 text-xs text-warning-text">لا يوجد أطباء نشطون — أضف طبيباً أولاً</p>
                  )}
                </div>
              )}

              <div>
                <label className="mb-1.5 block text-xs font-semibold text-slate-muted">اسم المستخدم (للدخول)</label>
                <input
                  value={username}
                  onChange={(e) => setUsername(e.target.value.toLowerCase().replace(/\s/g, ""))}
                  required
                  placeholder={targetRole === "doctor" ? "dr_ahmed" : targetRole === "assistant" ? "asst_sara" : "acc_sara"}
                  dir="ltr"
                  className="mc-field text-left"
                />
              </div>
              <div>
                <label className="mb-1.5 block text-xs font-semibold text-slate-muted">كلمة المرور</label>
                <div className="relative">
                  <input
                    type={showPass ? "text" : "password"}
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    required
                    minLength={6}
                    placeholder="6 أحرف على الأقل"
                    dir="ltr"
                    className="mc-field text-left"
                  />
                  <button
                    type="button"
                    onClick={() => setShowPass(!showPass)}
                    className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-muted hover:text-slate-text"
                  >
                    {showPass ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                  </button>
                </div>
              </div>
            </div>

            {fullName && username && (
              <div className="rounded-2xl border border-premium-200 bg-premium-50/60 p-3.5 text-sm">
                <p className="font-bold text-slate-text">ملخص الحساب الجديد:</p>
                <p className="mt-1 leading-relaxed text-slate-muted">
                  الاسم: <strong>{fullName}</strong> ·
                  الدخول بـ: <strong dir="ltr">{username}</strong> ·
                  الدور: <strong>{targetCfg.label}</strong> ·
                  يُوجَّه إلى: <strong>{destinationForRole(targetRole)}</strong>
                  {targetRole === "assistant" && doctorId && (
                    <> · الطبيب: <strong>{doctors.find((d) => d.id === doctorId)?.full_name_ar}</strong></>
                  )}
                </p>
              </div>
            )}

            <div className="flex gap-3 border-t border-slate-border pt-4">
              <button
                type="submit"
                disabled={saving || (targetRole === "assistant" && doctors.length === 0)}
                className="mc-btn-navy px-6 py-2.5"
              >
                {saving && <RefreshCw className="h-4 w-4 animate-spin" />}
                {saving ? "جارٍ الإنشاء..." : targetRole === "assistant" ? "تسجيل المساعد" : `إنشاء حساب ${targetCfg.label}`}
              </button>
              <button
                type="button"
                onClick={() => { setShowForm(false); setTargetRole(null); }}
                className="mc-btn-soft px-4 py-2.5"
              >
                إلغاء
              </button>
            </div>
          </form>
          </div>
        </section>
      )}

      {msg?.ok && !showForm && (
        <div className="flex items-center gap-2 rounded-2xl border border-success-border bg-success px-4 py-3 text-sm font-medium text-success-text">
          <CheckCircle2 className="h-4 w-4 flex-shrink-0" />
          {msg.text}
        </div>
      )}

      {loading ? (
        <div className="grid gap-3 md:grid-cols-2">
          {[0, 1, 2, 3].map((i) => (
            <div key={i} className="mc-skeleton h-20 rounded-2xl" />
          ))}
        </div>
      ) : (
        <div className="grid gap-3 md:grid-cols-2">
          {users.length === 0 && (
            <div className="mc-panel flex flex-col items-center px-6 py-12 text-center md:col-span-2">
              <span className="mc-icon-tile mb-3 h-12 w-12">
                <Users className="h-6 w-6" />
              </span>
              <p className="text-sm font-medium text-slate-muted">لا يوجد مستخدمون بعد</p>
            </div>
          )}
          {users.map((u) => {
            const cfg  = ROLE_CONFIG[u.role] ?? ROLE_CONFIG.accountant;
            const Icon = cfg.icon;
            const canToggle =
              u.role !== "super_admin" &&
              (callerRole === "super_admin" || u.role === "doctor" || u.role === "assistant");

            return (
              <div
                key={u.id}
                className={cn(
                  "mc-list-row",
                  !u.is_active && "opacity-60"
                )}
              >
                <div className="relative shrink-0">
                  <span className="flex h-12 w-12 items-center justify-center rounded-2xl bg-mc-pearl text-lg font-extrabold text-[#0b1f3a] ring-1 ring-inset ring-premium-300/60">
                    {(u.full_name || "?").trim().charAt(0)}
                  </span>
                  <span className={cn("absolute -bottom-1 -end-1 flex h-6 w-6 items-center justify-center rounded-lg bg-surface-card shadow-card", cfg.color)}>
                    <Icon className="h-3.5 w-3.5" />
                  </span>
                </div>

                <div className="min-w-0 flex-1">
                  <p className="truncate font-bold text-slate-text">{u.full_name}</p>
                  <div className="mt-1 flex flex-wrap items-center gap-1.5 text-xs text-slate-muted">
                    <span className={cn("rounded-full px-2 py-0.5 text-[11px] font-semibold", cfg.color)}>
                      {cfg.label}
                    </span>
                    {u.username && (
                      <span dir="ltr" className="rounded-md bg-surface px-1.5 py-0.5 font-mono text-[11px] ring-1 ring-inset ring-slate-border">
                        @{u.username}
                      </span>
                    )}
                    {u.phone && <span className="tabular-nums" dir="ltr">{u.phone}</span>}
                  </div>
                </div>

                <div className="flex shrink-0 flex-col items-end gap-2">
                  {u.is_active
                    ? <span className="flex items-center gap-1 rounded-full bg-success px-2 py-0.5 text-[11px] font-semibold text-success-text ring-1 ring-inset ring-success-border"><CheckCircle2 className="h-3 w-3"/>نشط</span>
                    : <span className="rounded-full bg-surface px-2 py-0.5 text-[11px] font-semibold text-slate-muted ring-1 ring-inset ring-slate-border">موقوف</span>
                  }
                  {canToggle && (
                    <button
                      onClick={() => toggleActive(u)}
                      className={cn(
                        "mc-btn-soft px-3 py-1 text-xs",
                        u.is_active
                          ? "text-slate-muted hover:border-debt-border hover:bg-debt hover:text-debt-text"
                          : "text-success-text hover:border-success-border hover:bg-success"
                      )}
                    >
                      {u.is_active ? "إيقاف" : "تفعيل"}
                    </button>
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
