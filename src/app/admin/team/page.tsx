"use client";

/**
 * /admin/team
 * لوحة إدارة فريق العمل — يستخدمها المالك (super_admin)
 * يمكنه إنشاء حسابات المحاسبين فقط
 */

import { useCallback, useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { getCurrentUser } from "@/lib/supabase/auth-helpers";
import { cn } from "@/lib/utils";
import { authPortalHeaders } from "@/lib/auth/api-portal";
import {
  UserPlus, UserCog, Users, CheckCircle2,
  XCircle, RefreshCw, Eye, EyeOff, ShieldCheck,
} from "lucide-react";

interface TeamMember {
  id: string;
  full_name: string;
  username: string | null;
  role: "accountant" | "doctor" | "super_admin";
  phone: string | null;
  is_active: boolean;
  created_at: string;
}

const ROLE_LABELS: Record<string, { label: string; color: string }> = {
  accountant:  { label: "محاسب", color: "bg-violet-100 text-violet-700" },
  doctor:      { label: "طبيب",  color: "bg-blue-100 text-blue-700"    },
  super_admin: { label: "مالك",  color: "bg-primary/10 text-primary"   },
};

export default function AdminTeamPage() {
  const supabase = createClient();

  const [team,        setTeam]        = useState<TeamMember[]>([]);
  const [loading,     setLoading]     = useState(true);
  const [showForm,    setShowForm]    = useState(false);
  const [profileMissing, setProfileMissing] = useState(false);
  const [currentUserId,  setCurrentUserId]  = useState<string | null>(null);

  const [fullName,  setFullName]  = useState("");
  const [username,  setUsername]  = useState("");
  const [password,  setPassword]  = useState("");
  const [phone,     setPhone]     = useState("");
  const [showPass,  setShowPass]  = useState(false);
  const [saving,    setSaving]    = useState(false);
  const [msg,       setMsg]       = useState<{ ok: boolean; text: string } | null>(null);
  const [createdCreds, setCreatedCreds] = useState<{ name: string; username: string } | null>(null);

  const loadTeam = useCallback(async () => {
    setLoading(true);

    const user = await getCurrentUser(supabase);
    if (!user) {
      setLoading(false);
      return;
    }

    setCurrentUserId(user.id);

    const { data: myProfile } = await supabase
      .from("profiles")
      .select("id, role, clinic_id")
      .eq("id", user.id)
      .maybeSingle();

    if (!myProfile) {
      setProfileMissing(true);
      setLoading(false);
      return;
    }
    setProfileMissing(false);

    if (!myProfile.clinic_id) {
      setLoading(false);
      return;
    }

    // Only users belonging to THIS clinic — never show other clinics' accounts
    const { data } = await supabase
      .from("profiles")
      .select("id, full_name, role, phone, is_active, created_at")
      .eq("clinic_id", myProfile.clinic_id)
      .order("role")
      .order("created_at", { ascending: false });

    setTeam((data as TeamMember[]) ?? []);
    setLoading(false);
  }, [supabase]);

  useEffect(() => { loadTeam(); }, [loadTeam]);

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    setMsg(null);
    setCreatedCreds(null);

    const cleanUsername = username.trim().toLowerCase().replace(/\s/g, "").replace(/[^a-z0-9._-]/g, "");
    if (cleanUsername.length < 3) {
      setMsg({ ok: false, text: "اسم المستخدم: 3 أحرف إنجليزية على الأقل (مثل mohamed123)" });
      return;
    }
    if (password.length < 6) {
      setMsg({ ok: false, text: "كلمة المرور: 6 أحرف على الأقل" });
      return;
    }

    setSaving(true);

    const res = await fetch("/api/admin/create-user", {
      method: "POST",
      credentials: "include",
      headers: {
        "Content-Type": "application/json",
        ...authPortalHeaders("admin"),
      },
      body: JSON.stringify({
        full_name: fullName.trim(),
        password,
        role: "accountant",
        phone: phone || null,
        username: cleanUsername,
      }),
    });

    const json = await res.json();
    setSaving(false);

    if (!res.ok) {
      setMsg({ ok: false, text: json.error ?? "تعذر إنشاء الحساب" });
      return;
    }

    setCreatedCreds({ name: fullName.trim(), username: json.username ?? cleanUsername });
    setMsg({ ok: true, text: json.message });
    setFullName("");
    setUsername("");
    setPassword("");
    setPhone("");
    setShowForm(false);
    loadTeam();
  }

  async function toggleActive(member: TeamMember) {
    if (member.role === "super_admin") return;
    await supabase
      .from("profiles")
      .update({ is_active: !member.is_active })
      .eq("id", member.id);
    loadTeam();
  }

  const accountants = team.filter(m => m.role === "accountant");
  const doctors     = team.filter(m => m.role === "doctor");

  // ── Profile missing screen ────────────────────────────────────────────────
  if (profileMissing) {
    return (
      <div className="space-y-4">
        <h1 className="text-xl font-bold text-slate-text">فريق العمل</h1>
        <div className="rounded-2xl border-2 border-red-200 bg-red-50 p-5 space-y-3">
          <p className="font-bold text-red-700 text-base">⚠️ لا يوجد ملف شخصي لحسابك</p>
          <p className="text-sm text-red-600">
            حسابك مسجّل في نظام الدخول لكن غير مرتبط بجدول <code className="bg-red-100 px-1 rounded">profiles</code>.
          </p>
          <p className="text-sm text-slate-700 font-medium">الحل: شغّل هذا SQL في Supabase Dashboard ← SQL Editor:</p>
          <pre className="rounded-xl bg-slate-900 text-green-300 text-xs p-4 overflow-auto leading-relaxed" dir="ltr">{`INSERT INTO public.profiles (id, clinic_id, role, full_name, is_active)
SELECT 
  u.id,
  (SELECT id FROM public.clinics ORDER BY created_at LIMIT 1),
  'super_admin',
  COALESCE(
    u.raw_user_meta_data->>'full_name',
    split_part(u.email, '@', 1),
    'المدير'
  ),
  TRUE
FROM auth.users u
LEFT JOIN public.profiles p ON p.id = u.id
WHERE p.id IS NULL;`}
          </pre>
          <div className="flex items-center gap-2 text-xs text-slate-500 bg-white rounded-xl p-3 border">
            <span className="font-mono text-slate-400">user id:</span>
            <span className="font-mono text-primary">{currentUserId ?? "..."}</span>
          </div>
          <button
            onClick={() => loadTeam()}
            className="flex items-center gap-2 rounded-xl bg-primary px-4 py-2 text-sm font-bold text-white"
          >
            <RefreshCw className="h-4 w-4" />
            تحقق من جديد بعد تشغيل SQL
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-5">

      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold text-slate-text">فريق العمل</h1>
          <p className="text-xs text-slate-muted">أضف محاسبين — هم يضيفون الأطباء من لوحتهم</p>
        </div>
        <button
          onClick={() => { setShowForm(!showForm); setMsg(null); setCreatedCreds(null); }}
          className="flex items-center gap-2 rounded-xl bg-primary px-4 py-2.5 text-sm font-bold text-white shadow-sm hover:bg-primary/90"
        >
          <UserPlus className="h-4 w-4" />
          محاسب جديد
        </button>
      </div>

      {/* Role flow explainer */}
      <div className="flex flex-col gap-2 rounded-2xl border border-slate-100 bg-white p-4 text-xs text-slate-500 shadow-sm">
        <div className="flex items-center gap-2">
          <ShieldCheck className="h-4 w-4 text-primary" />
          <span className="font-semibold text-slate-700">تسلسل إنشاء الحسابات</span>
        </div>
        <div className="flex flex-wrap items-center gap-2 pt-1">
          {[
            { label: "أنت (المالك)", color: "bg-primary/10 text-primary" },
            { label: "→ ينشئ محاسب", color: "bg-violet-100 text-violet-700" },
            { label: "→ المحاسب ينشئ أطباء", color: "bg-blue-100 text-blue-700" },
            { label: "→ كل مستخدم يرى عيادته فقط ✓", color: "bg-emerald-100 text-emerald-700" },
          ].map((s) => (
            <span key={s.label} className={cn("rounded-full px-2.5 py-1 font-medium", s.color)}>
              {s.label}
            </span>
          ))}
        </div>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 gap-3">
        {[
          { label: "المحاسبون",  value: accountants.length, color: "bg-violet-50 text-violet-700" },
          { label: "الأطباء",    value: doctors.length,     color: "bg-blue-50 text-blue-700"     },
        ].map((s) => (
          <div key={s.label} className={cn("rounded-2xl p-4 text-center", s.color)}>
            <p className="text-2xl font-black">{s.value}</p>
            <p className="text-xs font-medium">{s.label}</p>
          </div>
        ))}
      </div>

      {/* Create accountant form */}
      {showForm && (
        <div className="rounded-2xl border border-primary/20 bg-white p-5 shadow-sm">
          <h2 className="mb-4 flex items-center gap-2 text-base font-bold text-slate-700">
            <UserCog className="h-5 w-5 text-primary" />
            إنشاء حساب محاسب جديد
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
                : <XCircle      className="h-4 w-4 flex-shrink-0" />}
              {msg.text}
            </div>
          )}

          <form onSubmit={handleCreate} className="space-y-3">
            <div className="grid gap-3 sm:grid-cols-2">
              <div>
                <label className="mb-1 block text-xs font-medium text-slate-600">الاسم الكامل</label>
                <input
                  value={fullName}
                  onChange={(e) => setFullName(e.target.value)}
                  required
                  placeholder="سارة علي"
                  className="w-full rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-sm focus:border-primary focus:outline-none"
                />
              </div>
              <div>
                <label className="mb-1 block text-xs font-medium text-slate-600">الهاتف (اختياري)</label>
                <input
                  value={phone}
                  onChange={(e) => setPhone(e.target.value)}
                  placeholder="07xxxxxxxx"
                  className="w-full rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-sm focus:border-primary focus:outline-none"
                />
              </div>
              <div>
                <label className="mb-1 block text-xs font-medium text-slate-600">
                  اسم المستخدم (للدخول) <span className="text-red-500">*</span>
                </label>
                <input
                  value={username}
                  onChange={(e) => setUsername(e.target.value.toLowerCase().replace(/\s/g, ""))}
                  required
                  minLength={3}
                  placeholder="mohamed123"
                  dir="ltr"
                  className="w-full rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-left focus:border-primary focus:outline-none"
                />
                <p className="mt-0.5 text-[10px] text-slate-400">المحاسب يدخل بهذا الاسم من بوابة «واجهة المحاسب»</p>
              </div>
              <div>
                <label className="mb-1 block text-xs font-medium text-slate-600">
                  كلمة المرور <span className="text-red-500">*</span>
                </label>
                <div className="relative">
                  <input
                    type={showPass ? "text" : "password"}
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    required
                    minLength={6}
                    placeholder="6 أحرف على الأقل"
                    dir="ltr"
                    className="w-full rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-left focus:border-primary focus:outline-none"
                  />
                  <button
                    type="button"
                    onClick={() => setShowPass(!showPass)}
                    className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400"
                  >
                    {showPass ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
                  </button>
                </div>
              </div>
            </div>

            {fullName && username && (
              <div className="rounded-xl bg-slate-50 p-3 text-xs text-slate-500">
                سيتم إنشاء حساب <strong className="text-slate-700">{fullName}</strong> بـ username{" "}
                <strong dir="ltr">{username}</strong>، سيُوجَّه إلى <strong>/dashboard</strong> عند الدخول.
              </div>
            )}

            <div className="flex gap-3 pt-1">
              <button
                type="submit"
                disabled={saving}
                className="flex items-center gap-2 rounded-xl bg-primary px-5 py-2 text-sm font-bold text-white hover:bg-primary/90 disabled:opacity-60"
              >
                {saving && <RefreshCw className="h-3.5 w-3.5 animate-spin" />}
                {saving ? "جارٍ الإنشاء..." : "إنشاء المحاسب"}
              </button>
              <button
                type="button"
                onClick={() => setShowForm(false)}
                className="rounded-xl border border-slate-200 px-4 py-2 text-sm text-slate-600 hover:bg-slate-50"
              >
                إلغاء
              </button>
            </div>
          </form>
        </div>
      )}

      {/* Success — show login credentials for the new accountant */}
      {createdCreds && !showForm && (
        <div className="rounded-2xl border-2 border-emerald-200 bg-emerald-50 p-4 space-y-2">
          <div className="flex items-center gap-2 text-emerald-800 font-bold">
            <CheckCircle2 className="h-5 w-5" />
            تم إنشاء الحساب بنجاح
          </div>
          <p className="text-sm text-emerald-700">
            أعطِ المحاسب <strong>{createdCreds.name}</strong> بيانات الدخول التالية:
          </p>
          <div className="rounded-xl bg-white border border-emerald-100 p-3 text-sm space-y-1">
            <p>البوابة: <strong>واجهة المحاسب</strong> في صفحة الدخول</p>
            <p>اسم المستخدم: <strong dir="ltr" className="font-mono text-primary">{createdCreds.username}</strong></p>
            <p>كلمة المرور: <strong>نفس التي أدخلتها للتو</strong></p>
          </div>
          <p className="text-xs text-emerald-600">يمكن للمحاسب الدخول فوراً — بدون أي إعداد إضافي</p>
        </div>
      )}

      {msg && !msg.ok && (
        <div className="flex items-center gap-2 rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-700">
          <XCircle className="h-4 w-4 flex-shrink-0" />
          {msg.text}
        </div>
      )}

      {/* Team list */}
      {loading ? (
        <div className="flex justify-center py-10">
          <RefreshCw className="h-5 w-5 animate-spin text-primary" />
        </div>
      ) : (
        <div className="space-y-2">
          {team.length === 0 && (
            <div className="rounded-2xl border border-dashed border-slate-200 p-8 text-center text-sm text-slate-400">
              لا يوجد فريق بعد — ابدأ بإضافة محاسب
            </div>
          )}
          {team.map((member) => {
            const cfg  = ROLE_LABELS[member.role] ?? ROLE_LABELS.accountant;
            const Icon = member.role === "doctor" ? Users : UserCog;
            return (
              <div
                key={member.id}
                className={cn(
                  "flex items-center gap-3 rounded-2xl border bg-white p-3.5 transition-opacity",
                  !member.is_active && "opacity-50"
                )}
              >
                <div className={cn("flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-xl text-sm", cfg.color)}>
                  <Icon className="h-4 w-4" />
                </div>

                <div className="flex-1 min-w-0">
                  <p className="text-sm font-semibold text-slate-800">{member.full_name}</p>
                  <div className="flex flex-wrap items-center gap-1.5 text-xs text-slate-500">
                    <span className={cn("rounded-full px-2 py-0.5 font-medium", cfg.color)}>
                      {cfg.label}
                    </span>
                    {member.username && (
                      <span dir="ltr" className="rounded bg-slate-100 px-1.5 py-0.5 font-mono">
                        @{member.username}
                      </span>
                    )}
                  </div>
                </div>

                <div className="flex items-center gap-2">
                  {member.is_active
                    ? <span className="flex items-center gap-1 text-xs text-emerald-600"><CheckCircle2 className="h-3 w-3"/>نشط</span>
                    : <span className="text-xs text-slate-400">موقوف</span>
                  }
                  {member.role !== "super_admin" && (
                    <button
                      onClick={() => toggleActive(member)}
                      className={cn(
                        "rounded-xl border px-2.5 py-1 text-xs font-medium transition-colors",
                        member.is_active
                          ? "border-slate-200 text-slate-500 hover:border-red-200 hover:text-red-600"
                          : "border-emerald-200 text-emerald-600 hover:bg-emerald-50"
                      )}
                    >
                      {member.is_active ? "إيقاف" : "تفعيل"}
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
