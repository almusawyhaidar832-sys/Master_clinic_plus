"use client";

import { useCallback, useEffect, useState, type ComponentType } from "react";
import { useRouter } from "next/navigation";
import {
  Building2,
  LogOut,
  Plus,
  RefreshCw,
  Users,
  MessageCircle,
  Activity,
} from "lucide-react";
import { SPECIALTY_LABELS } from "@/types/modules";
import type { ClinicSpecialty } from "@/types/modules";
import {
  DeveloperClinicsTable,
  type DeveloperClinicRow,
} from "@/components/developer/DeveloperClinicsTable";
import { Button } from "@/components/ui/Button";
import { DeveloperToolsPanel } from "@/components/developer/DeveloperToolsPanel";

type PlatformStats = {
  totalClinics: number;
  activeClinics: number;
  totalPatients: number;
  whatsappConnected: number;
};

const SPECIALTIES = Object.entries(SPECIALTY_LABELS) as [
  ClinicSpecialty,
  string,
][];

function StatCard({
  label,
  value,
  icon: Icon,
  accent,
}: {
  label: string;
  value: number;
  icon: ComponentType<{ className?: string }>;
  accent: string;
}) {
  return (
    <div className="rounded-xl border border-slate-700 bg-slate-900/70 p-4">
      <div className="flex items-center justify-between gap-2">
        <div>
          <p className="text-xs text-slate-500">{label}</p>
          <p className="mt-1 text-2xl font-bold text-slate-100">{value}</p>
        </div>
        <div
          className={`flex h-10 w-10 items-center justify-center rounded-lg ${accent}`}
        >
          <Icon className="h-5 w-5" />
        </div>
      </div>
    </div>
  );
}

export default function DeveloperDashboardPage() {
  const router = useRouter();
  const [clinics, setClinics] = useState<DeveloperClinicRow[]>([]);
  const [stats, setStats] = useState<PlatformStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  const [clinicName, setClinicName] = useState("");
  const [clinicNameAr, setClinicNameAr] = useState("");
  const [clinicPhone, setClinicPhone] = useState("");
  const [specialty, setSpecialty] = useState<ClinicSpecialty>("dental");
  const [adminName, setAdminName] = useState("");
  const [adminUsername, setAdminUsername] = useState("");
  const [adminPassword, setAdminPassword] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    setMsg(null);
    try {
      const [clinicsRes, statsRes] = await Promise.all([
        fetch("/api/developer/clinics"),
        fetch("/api/developer/stats"),
      ]);

      if (clinicsRes.status === 401 || statsRes.status === 401) {
        router.replace("/admin-login");
        return;
      }

      const parseJson = async (res: Response) => {
        const text = await res.text();
        try {
          return JSON.parse(text) as Record<string, unknown>;
        } catch {
          return {
            error: text.startsWith("<!")
              ? `خطأ خادم (${res.status}) — أعد تشغيل npm run dev من مجلد Master_clinic_plus`
              : text.slice(0, 200),
          };
        }
      };

      const clinicsData = await parseJson(clinicsRes);
      const statsData = await parseJson(statsRes);

      if (!clinicsRes.ok) {
        setMsg({
          ok: false,
          text: String(clinicsData.error ?? "تعذر تحميل العيادات"),
        });
        setClinics([]);
      } else {
        setClinics(
          (clinicsData.clinics as DeveloperClinicRow[] | undefined) ?? []
        );
      }

      if (statsRes.ok && typeof statsData.totalClinics === "number") {
        setStats(statsData as unknown as PlatformStats);
      } else if (!statsRes.ok) {
        setMsg({
          ok: false,
          text: String(statsData.error ?? "تعذر تحميل الإحصائيات"),
        });
      }
    } catch {
      setMsg({ ok: false, text: "تعذر الاتصال بالخادم" });
    } finally {
      setLoading(false);
    }
  }, [router]);

  useEffect(() => {
    void load();
  }, [load]);

  async function handleLogout() {
    await fetch("/api/developer/logout", { method: "POST" });
    router.replace("/admin-login");
  }

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setMsg(null);
    const res = await fetch("/api/developer/clinics", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        clinic_name: clinicName,
        clinic_name_ar: clinicNameAr || clinicName,
        clinic_phone: clinicPhone,
        specialty,
        admin_full_name: adminName,
        admin_username: adminUsername,
        admin_password: adminPassword,
        provision_evolution: true,
      }),
    });
    const json = await res.json();
    setSaving(false);
    if (!res.ok) {
      setMsg({ ok: false, text: json.error ?? "فشل الإنشاء" });
      return;
    }
    setMsg({ ok: true, text: json.message ?? "تم إنشاء العيادة" });
    setShowForm(false);
    setClinicName("");
    setClinicNameAr("");
    setClinicPhone("");
    setAdminName("");
    setAdminUsername("");
    setAdminPassword("");
    void load();
  }

  return (
    <div className="safe-top safe-bottom mx-auto max-w-6xl p-4 pb-24 sm:p-6 sm:pb-16">
      <header className="mb-6 flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-amber-400">
            لوحة المدير العام
          </h1>
          <p className="text-sm text-slate-400">
            تحكم كامل بالعيادات — دخول نيابةً دون كلمة سر المالك
          </p>
          <p className="mt-1 max-w-xl text-xs text-slate-500">
            القائمة تعرض كل صفوف جدول{" "}
            <code className="text-amber-500/90">clinics</code> في Supabase (ليست
            وهمية). عيادات قديمة أو تجريبية تُحذف من أيقونة القائمة ⋮ → حذف
            العيادة.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => void load()}
            className="touch-target border-slate-600 text-slate-300"
            aria-label="تحديث القائمة"
          >
            <RefreshCw className="h-5 w-5" />
          </Button>
          <Button
            type="button"
            size="sm"
            onClick={() => setShowForm(!showForm)}
            className="touch-target bg-amber-600 hover:bg-amber-500"
          >
            <Plus className="h-5 w-5" />
            إضافة عيادة
          </Button>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={handleLogout}
            className="touch-target border-slate-600 text-slate-300"
          >
            <LogOut className="h-5 w-5" />
            خروج
          </Button>
        </div>
      </header>

      <DeveloperToolsPanel onMessage={setMsg} />

      {stats && (
        <div className="mb-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <StatCard
            label="إجمالي العيادات"
            value={stats.totalClinics}
            icon={Building2}
            accent="bg-amber-950/50 text-amber-400"
          />
          <StatCard
            label="عيادات نشطة"
            value={stats.activeClinics}
            icon={Activity}
            accent="bg-blue-950/50 text-blue-400"
          />
          <StatCard
            label="إجمالي المرضى"
            value={stats.totalPatients}
            icon={Users}
            accent="bg-violet-950/50 text-violet-400"
          />
          <StatCard
            label="واتساب متصل"
            value={stats.whatsappConnected}
            icon={MessageCircle}
            accent="bg-emerald-950/50 text-emerald-400"
          />
        </div>
      )}

      {msg && (
        <div
          className={`mb-6 rounded-xl border px-4 py-3 text-sm ${
            msg.ok
              ? "border-emerald-700 bg-emerald-950/40 text-emerald-300"
              : "border-red-800 bg-red-950/40 text-red-300"
          }`}
        >
          {msg.text}
        </div>
      )}

      {showForm && (
        <form
          onSubmit={handleCreate}
          className="mb-8 rounded-2xl border border-slate-700 bg-slate-900/60 p-6 space-y-4"
        >
          <h2 className="font-bold text-lg flex items-center gap-2 text-slate-100">
            <Building2 className="h-5 w-5 text-amber-400" />
            عيادة جديدة + Evolution instance
          </h2>
          <div className="grid gap-4 sm:grid-cols-2">
            <input
              className="rounded-lg border border-slate-600 bg-slate-800 px-3 py-2 text-sm text-white"
              placeholder="اسم العيادة (EN)"
              value={clinicName}
              onChange={(e) => setClinicName(e.target.value)}
              required
            />
            <input
              className="rounded-lg border border-slate-600 bg-slate-800 px-3 py-2 text-sm text-white"
              placeholder="اسم العيادة (عربي)"
              value={clinicNameAr}
              onChange={(e) => setClinicNameAr(e.target.value)}
            />
            <input
              className="rounded-lg border border-slate-600 bg-slate-800 px-3 py-2 text-sm text-white"
              placeholder="هاتف العيادة"
              value={clinicPhone}
              onChange={(e) => setClinicPhone(e.target.value)}
            />
            <select
              className="rounded-lg border border-slate-600 bg-slate-800 px-3 py-2 text-sm text-white"
              value={specialty}
              onChange={(e) =>
                setSpecialty(e.target.value as ClinicSpecialty)
              }
            >
              {SPECIALTIES.map(([v, label]) => (
                <option key={v} value={v}>
                  {label}
                </option>
              ))}
            </select>
            <input
              className="rounded-lg border border-slate-600 bg-slate-800 px-3 py-2 text-sm text-white"
              placeholder="اسم مالك العيادة (Owner)"
              value={adminName}
              onChange={(e) => setAdminName(e.target.value)}
              required
            />
            <div className="space-y-1">
              <input
                className="w-full rounded-lg border border-slate-600 bg-slate-800 px-3 py-2 text-sm text-white"
                placeholder="اسم مستخدم المدير (إنجليزي) — مثل owner1"
                dir="ltr"
                autoComplete="off"
                pattern="[a-zA-Z0-9._-]{3,32}"
                title="3–32 حرفاً: a-z وأرقام و . _ -"
                value={adminUsername}
                onChange={(e) => setAdminUsername(e.target.value)}
                required
              />
              <p className="text-xs text-slate-500">
                إنجليزي فقط (مو عربي) — يُستخدم لتسجيل دخول مالك العيادة
              </p>
            </div>
            <input
              type="password"
              className="rounded-lg border border-slate-600 bg-slate-800 px-3 py-2 text-sm text-white sm:col-span-2"
              placeholder="كلمة مرور المدير (6+)"
              value={adminPassword}
              onChange={(e) => setAdminPassword(e.target.value)}
              required
              minLength={6}
            />
          </div>
          <Button type="submit" disabled={saving} className="bg-emerald-600 hover:bg-emerald-500">
            {saving ? "جاري الإنشاء..." : "إنشاء العيادة + Instance"}
          </Button>
        </form>
      )}

      <section>
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-lg font-bold text-slate-200">قائمة العيادات</h2>
          {!loading && clinics.length > 0 && (
            <span className="rounded-full bg-slate-800 px-3 py-1 text-xs text-slate-400">
              {clinics.length} عيادة
              {stats && stats.totalClinics !== clinics.length
                ? ` · المسجّل في الإحصائيات: ${stats.totalClinics}`
                : ""}
            </span>
          )}
        </div>
        {loading ? (
          <p className="text-slate-400">جاري التحميل...</p>
        ) : clinics.length === 0 ? (
          <p className="text-slate-400">لا توجد عيادات مسجّلة.</p>
        ) : (
          <DeveloperClinicsTable
            clinics={clinics}
            onRefresh={() => void load()}
            onMessage={setMsg}
          />
        )}
      </section>
    </div>
  );
}
