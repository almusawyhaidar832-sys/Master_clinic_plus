"use client";

/**
 * صفحة إدارة المستخدمين
 *
 * الصلاحيات:
 *   super_admin  → يرى جميع المستخدمين، يُنشئ محاسبين فقط
 *   accountant   → يرى أطباء ومحاسبين، يُنشئ أطباء فقط
 */

import { useCallback, useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { cn } from "@/lib/utils";
import {
  UserPlus, Users, Stethoscope, UserCog,
  Eye, EyeOff, CheckCircle2, XCircle, RefreshCw, ShieldAlert,
} from "lucide-react";

interface ClinicUser {
  id: string;
  full_name: string;
  username: string | null;
  role: "accountant" | "doctor" | "super_admin";
  phone: string | null;
  is_active: boolean;
  created_at: string;
}

const ROLE_CONFIG = {
  doctor:      { label: "طبيب",   icon: Stethoscope, color: "bg-blue-100 text-blue-700"    },
  accountant:  { label: "محاسب",  icon: UserCog,     color: "bg-violet-100 text-violet-700" },
  super_admin: { label: "مالك",   icon: Users,       color: "bg-primary/10 text-primary"    },
};

/** What each caller role is allowed to create */
const ALLOWED_TARGET: Record<string, "accountant" | "doctor"> = {
  super_admin: "accountant",
  accountant:  "doctor",
};

export default function UsersPage() {
  const supabase = createClient();

  const [callerRole, setCallerRole] = useState<string | null>(null);
  const [users,      setUsers]      = useState<ClinicUser[]>([]);
  const [loading,    setLoading]    = useState(true);
  const [showForm,   setShowForm]   = useState(false);

  const [fullName,  setFullName]  = useState("");
  const [username,  setUsername]  = useState("");
  const [password,  setPassword]  = useState("");
  const [phone,     setPhone]     = useState("");
  const [showPass,  setShowPass]  = useState(false);
  const [saving,    setSaving]    = useState(false);
  const [msg,       setMsg]       = useState<{ ok: boolean; text: string } | null>(null);

  // The target role is fixed based on the caller — no choice in the form
  const targetRole = callerRole ? ALLOWED_TARGET[callerRole] : null;

  const loadUsers = useCallback(async () => {
    setLoading(true);

    const { data: { user } } = await supabase.auth.getUser();
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
      setLoading(false);
      return;
    }

    // Only users in the current clinic
    const { data } = await supabase
      .from("profiles")
      .select("id, full_name, username, role, phone, is_active, created_at")
      .eq("clinic_id", profile.clinic_id)
      .order("created_at", { ascending: false });

    setUsers((data as ClinicUser[]) ?? []);
    setLoading(false);
  }, [supabase]);

  useEffect(() => { loadUsers(); }, [loadUsers]);

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    if (!targetRole) return;
    setMsg(null);
    setSaving(true);

    const res = await fetch("/api/admin/create-user", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        username,
        password,
        full_name: fullName,
        role: targetRole,
        phone,
      }),
    });

    const json = await res.json();
    setSaving(false);

    if (!res.ok) {
      setMsg({ ok: false, text: json.error ?? "تعذر إنشاء الحساب" });
      return;
    }

    setMsg({ ok: true, text: json.message });
    setFullName(""); setUsername(""); setPassword(""); setPhone("");
    setShowForm(false);
    loadUsers();
  }

  async function toggleActive(user: ClinicUser) {
    await supabase
      .from("profiles")
      .update({ is_active: !user.is_active })
      .eq("id", user.id);
    loadUsers();
  }

  const activeCount  = users.filter(u => u.is_active).length;
  const doctorCount  = users.filter(u => u.role === "doctor").length;
  const accountCount = users.filter(u => u.role === "accountant").length;

  const targetCfg = targetRole ? ROLE_CONFIG[targetRole] : null;
  const TargetIcon = targetCfg?.icon ?? UserPlus;

  return (
    <div className="mx-auto max-w-4xl space-y-6">

      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-slate-text">إدارة المستخدمين</h1>
          <p className="text-sm text-slate-muted">
            {callerRole === "super_admin"
              ? "أضف محاسبين للعيادة — كل واحد يدخل بـ username وpassword"
              : "أضف أطباء للعيادة — كل طبيب يدخل بـ username وpassword"}
          </p>
        </div>

        {targetRole && (
          <button
            onClick={() => { setShowForm(!showForm); setMsg(null); }}
            className="flex items-center gap-2 rounded-xl bg-primary px-4 py-2.5 text-sm font-bold text-white shadow-sm hover:bg-primary/90"
          >
            <UserPlus className="h-4 w-4" />
            {callerRole === "super_admin" ? "محاسب جديد" : "طبيب جديد"}
          </button>
        )}
      </div>

      {/* Permission banner */}
      {callerRole && (
        <div className="flex items-start gap-3 rounded-2xl border border-blue-100 bg-blue-50 p-4 text-sm text-blue-800">
          <ShieldAlert className="mt-0.5 h-4 w-4 flex-shrink-0" />
          <div>
            <p className="font-semibold">
              {callerRole === "super_admin"
                ? "أنت مسجل كـ مالك — يمكنك إنشاء حسابات المحاسبين فقط"
                : "أنت مسجل كـ محاسب — يمكنك إنشاء حسابات الأطباء فقط"}
            </p>
            <p className="mt-0.5 text-blue-600">
              الحساب الجديد سيُربط تلقائياً بعيادتك ويُوجَّه للـ Dashboard الصحيح عند تسجيل الدخول.
            </p>
          </div>
        </div>
      )}

      {/* Stats */}
      <div className="grid grid-cols-3 gap-3">
        {[
          { label: "إجمالي النشطين", value: activeCount,  color: "bg-emerald-50 text-emerald-700" },
          { label: "الأطباء",        value: doctorCount,   color: "bg-blue-50 text-blue-700"       },
          { label: "المحاسبون",      value: accountCount,  color: "bg-violet-50 text-violet-700"   },
        ].map((s) => (
          <div key={s.label} className={cn("rounded-2xl p-4 text-center", s.color)}>
            <p className="text-2xl font-black">{s.value}</p>
            <p className="text-xs font-medium">{s.label}</p>
          </div>
        ))}
      </div>

      {/* Create form */}
      {showForm && targetRole && targetCfg && (
        <div className="rounded-2xl border border-primary/20 bg-white p-6 shadow-sm">
          <h2 className="mb-5 flex items-center gap-2 text-lg font-bold text-slate-700">
            <TargetIcon className="h-5 w-5 text-primary" />
            إنشاء حساب {targetCfg.label} جديد
          </h2>

          {msg && (
            <div className={cn(
              "mb-4 flex items-center gap-2 rounded-xl border p-3 text-sm",
              msg.ok
                ? "border-emerald-200 bg-emerald-50 text-emerald-700"
                : "border-red-200 bg-red-50 text-red-700"
            )}>
              {msg.ok
                ? <CheckCircle2 className="h-4 w-4 flex-shrink-0" />
                : <XCircle     className="h-4 w-4 flex-shrink-0" />}
              {msg.text}
            </div>
          )}

          {/* Fixed role badge */}
          <div className="mb-4 flex items-center gap-2 rounded-xl border border-slate-100 bg-slate-50 p-3 text-sm">
            <span className={cn("rounded-full px-2.5 py-1 text-xs font-bold", targetCfg.color)}>
              {targetCfg.label}
            </span>
            <span className="text-slate-500">الدور المحدد بناءً على صلاحيتك</span>
          </div>

          <form onSubmit={handleCreate} className="space-y-4">
            <div className="grid gap-4 sm:grid-cols-2">
              <div>
                <label className="mb-1 block text-sm font-medium text-slate-600">الاسم الكامل</label>
                <input
                  value={fullName}
                  onChange={(e) => setFullName(e.target.value)}
                  required
                  placeholder={targetRole === "doctor" ? "د. محمد أحمد" : "أحمد محمد"}
                  className="w-full rounded-xl border border-slate-200 bg-slate-50 px-4 py-2.5 text-sm focus:border-primary focus:outline-none"
                />
              </div>
              <div>
                <label className="mb-1 block text-sm font-medium text-slate-600">رقم الهاتف (اختياري)</label>
                <input
                  value={phone}
                  onChange={(e) => setPhone(e.target.value)}
                  placeholder="07xxxxxxxx"
                  className="w-full rounded-xl border border-slate-200 bg-slate-50 px-4 py-2.5 text-sm focus:border-primary focus:outline-none"
                />
              </div>
              <div>
                <label className="mb-1 block text-sm font-medium text-slate-600">
                  اسم المستخدم (للدخول)
                </label>
                <input
                  value={username}
                  onChange={(e) => setUsername(e.target.value.toLowerCase().replace(/\s/g, ""))}
                  required
                  placeholder={targetRole === "doctor" ? "dr_ahmed" : "acc_sara"}
                  dir="ltr"
                  className="w-full rounded-xl border border-slate-200 bg-slate-50 px-4 py-2.5 text-sm text-left focus:border-primary focus:outline-none"
                />
                <p className="mt-0.5 text-xs text-slate-400">أحرف صغيرة وأرقام فقط، بدون مسافات</p>
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
                    placeholder="6 أحرف على الأقل"
                    dir="ltr"
                    className="w-full rounded-xl border border-slate-200 bg-slate-50 px-4 py-2.5 text-sm text-left focus:border-primary focus:outline-none"
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

            {fullName && username && (
              <div className="rounded-xl bg-slate-50 p-3 text-sm">
                <p className="font-medium text-slate-700">ملخص الحساب الجديد:</p>
                <p className="mt-1 text-slate-500">
                  الاسم: <strong>{fullName}</strong> ·
                  الدخول بـ: <strong dir="ltr">{username}</strong> ·
                  الدور: <strong>{targetCfg.label}</strong> ·
                  يُوجَّه إلى: <strong>{targetRole === "doctor" ? "/doctor" : "/dashboard"}</strong>
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
                {saving ? "جارٍ الإنشاء..." : `إنشاء حساب ${targetCfg.label}`}
              </button>
              <button
                type="button"
                onClick={() => setShowForm(false)}
                className="rounded-xl border border-slate-200 px-4 py-2.5 text-sm text-slate-600 hover:bg-slate-50"
              >
                إلغاء
              </button>
            </div>
          </form>
        </div>
      )}

      {/* Success message outside form */}
      {msg?.ok && !showForm && (
        <div className="flex items-center gap-2 rounded-xl border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-700">
          <CheckCircle2 className="h-4 w-4 flex-shrink-0" />
          {msg.text}
        </div>
      )}

      {/* Users list */}
      {loading ? (
        <div className="flex justify-center py-12">
          <RefreshCw className="h-6 w-6 animate-spin text-primary" />
        </div>
      ) : (
        <div className="space-y-2">
          {users.length === 0 && (
            <div className="rounded-2xl border border-dashed border-slate-200 p-8 text-center text-sm text-slate-400">
              لا يوجد مستخدمون بعد — ابدأ بإضافة{" "}
              {callerRole === "super_admin" ? "محاسب" : "طبيب"}
            </div>
          )}
          {users.map((u) => {
            const cfg  = ROLE_CONFIG[u.role] ?? ROLE_CONFIG.accountant;
            const Icon = cfg.icon;
            // Accountant can only toggle doctors, super_admin can toggle non-super_admin
            const canToggle =
              u.role !== "super_admin" &&
              (callerRole === "super_admin" || u.role === "doctor");

            return (
              <div
                key={u.id}
                className={cn(
                  "flex items-center gap-4 rounded-2xl border bg-white p-4 transition-opacity",
                  !u.is_active && "opacity-50"
                )}
              >
                <div className={cn("flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-xl", cfg.color)}>
                  <Icon className="h-5 w-5" />
                </div>

                <div className="flex-1 min-w-0">
                  <p className="font-semibold text-slate-800">{u.full_name}</p>
                  <div className="flex flex-wrap items-center gap-2 text-xs text-slate-500">
                    <span className={cn("rounded-full px-2 py-0.5 font-medium", cfg.color)}>
                      {cfg.label}
                    </span>
                    {u.username && (
                      <span dir="ltr" className="rounded bg-slate-100 px-1.5 py-0.5 font-mono">
                        @{u.username}
                      </span>
                    )}
                    {u.phone && <span>{u.phone}</span>}
                  </div>
                </div>

                <div className="flex items-center gap-2">
                  {u.is_active
                    ? <span className="flex items-center gap-1 text-xs text-emerald-600"><CheckCircle2 className="h-3.5 w-3.5"/>نشط</span>
                    : <span className="text-xs text-slate-400">موقوف</span>
                  }
                  {canToggle && (
                    <button
                      onClick={() => toggleActive(u)}
                      className={cn(
                        "rounded-xl border px-3 py-1.5 text-xs font-medium transition-colors",
                        u.is_active
                          ? "border-slate-200 text-slate-500 hover:border-red-200 hover:text-red-600"
                          : "border-emerald-200 text-emerald-600 hover:bg-emerald-50"
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
