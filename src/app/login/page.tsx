"use client";

import { Suspense, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { FaTooth } from "react-icons/fa";
import { createClientForPortal } from "@/lib/supabase/client";
import { signInWithPassword, signOutUser } from "@/lib/supabase/auth-helpers";
import { resolveAuthEmail } from "@/lib/auth/credentials";
import { isRoleAllowedForPath, loginPortalToAuthPortalId } from "@/lib/auth/portal-access";
import { getAuthProfile } from "@/lib/clinic-context";
import { Eye, EyeOff } from "lucide-react";
import { DEVELOPER } from "@/lib/constants";
import { DeveloperFooterLink } from "@/components/layout/DeveloperFooterLink";

/**
 * Each portal has a fixed destination path.
 * After successful signIn the user is pushed directly to that path —
 * no role reading, no middleware redirect, no guessing.
 */
type Portal = {
  id: string;
  title: string;
  subtitle: string;
  emoji: string;
  color: string;
  btnColor: string;
  destination: string; // where to go after successful login
};

const PORTALS: Portal[] = [
  {
    id:          "admin",
    title:       "لوحة الإدارة",
    subtitle:    "مدير العيادة / المالك",
    emoji:       "🏥",
    color:       "border-primary/30 bg-primary/5",
    btnColor:    "bg-primary hover:bg-primary/90",
    destination: "/admin",
  },
  {
    id:          "accountant",
    title:       "واجهة المحاسب",
    subtitle:    "الاستقبال والحسابات",
    emoji:       "💼",
    color:       "border-violet-200 bg-violet-50/50",
    btnColor:    "bg-violet-600 hover:bg-violet-700",
    destination: "/dashboard",
  },
  {
    id:          "doctor",
    title:       "تطبيق الطبيب",
    subtitle:    "الكشفيات والمحفظة",
    emoji:       "👨‍⚕️",
    color:       "border-blue-200 bg-blue-50/50",
    btnColor:    "bg-blue-600 hover:bg-blue-700",
    destination: "/doctor",
  },
  {
    id:          "assistant",
    title:       "بوابة المساعد",
    subtitle:    "حجوزات الطبيب",
    emoji:       "🧑‍💼",
    color:       "border-teal-200 bg-teal-50/50",
    btnColor:    "bg-teal-600 hover:bg-teal-700",
    destination: "/assistant/dashboard",
  },
  {
    id:          "booking",
    title:       "بوابة الحجوزات",
    subtitle:    "حجز المرضى أونلاين",
    emoji:       "📅",
    color:       "border-teal-200 bg-teal-50/50",
    btnColor:    "bg-teal-600 hover:bg-teal-700",
    destination: "/booking",
  },
];

// ── Portal card ────────────────────────────────────────────────────────────
function PortalCard({ portal, highlighted }: { portal: Portal; highlighted?: boolean }) {
  const router = useRouter();

  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [showPass, setShowPass] = useState(false);
  const [error,    setError]    = useState("");
  const [loading,  setLoading]  = useState(false);

  // Booking has no login form — direct link
  if (portal.id === "booking") {
    return (
      <div className={`flex flex-col rounded-2xl border-2 p-5 transition-shadow hover:shadow-md ${portal.color}`}>
        <div className="mb-4 flex items-center gap-3">
          <span className="text-3xl">{portal.emoji}</span>
          <div>
            <h3 className="font-bold text-slate-800">{portal.title}</h3>
            <p className="text-xs text-slate-500">{portal.subtitle}</p>
          </div>
        </div>
        <a
          href="/booking"
          className={`touch-target mt-auto flex w-full items-center justify-center rounded-xl py-3 text-base font-bold text-white transition-colors ${portal.btnColor}`}
        >
          فتح بوابة الحجز
        </a>
      </div>
    );
  }

  async function handleLogin(e: React.FormEvent) {
    e.preventDefault();
    if (!username.trim() || !password) {
      setError("أدخل اسم المستخدم وكلمة المرور");
      return;
    }

    setLoading(true);
    setError("");

    try {
      const authPortal = loginPortalToAuthPortalId(portal.id);
      if (!authPortal) {
        setError("بوابة غير معروفة");
        setLoading(false);
        return;
      }

      const supabase = createClientForPortal(authPortal);
      const email = resolveAuthEmail(username.trim());

      const { data, error: signInError } = await signInWithPassword(
        supabase,
        email,
        password
      );

      if (signInError || !data.user) {
        setError("اسم المستخدم أو كلمة المرور غير صحيحة");
        setLoading(false);
        return;
      }

      const profile = await getAuthProfile(supabase);
      if (!profile || !isRoleAllowedForPath(profile.role, portal.destination)) {
        await signOutUser(supabase);
        setError("هذا الحساب لا يناسب هذه البوابة — استخدم بوابة الدخول الصحيحة لدورك");
        setLoading(false);
        return;
      }

      router.push(portal.destination);
    } catch {
      setError("خطأ في الاتصال — تحقق من اتصالك بالإنترنت");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div
      className={`flex flex-col rounded-2xl border-2 p-5 transition-shadow hover:shadow-md ${portal.color} ${highlighted ? "ring-2 ring-teal-500 ring-offset-2" : ""}`}
    >

      <div className="mb-4 flex items-center gap-3">
        <span className="text-3xl">{portal.emoji}</span>
        <div>
          <h3 className="font-bold text-slate-800">{portal.title}</h3>
          <p className="text-xs text-slate-500">{portal.subtitle}</p>
        </div>
      </div>

      <form onSubmit={handleLogin} className="flex flex-col gap-3">
        {error && (
          <p className="rounded-lg bg-red-50 border border-red-100 px-3 py-2 text-xs text-red-600 text-center">
            {error}
          </p>
        )}

        <input
          type="text"
          value={username}
          onChange={(e) => setUsername(e.target.value)}
          placeholder="اسم المستخدم"
          disabled={loading}
          required
          dir="ltr"
          className="touch-input w-full rounded-xl border border-white bg-white/80 px-4 py-3 text-base text-left placeholder:text-slate-400 focus:border-slate-300 focus:outline-none disabled:opacity-60"
        />

        <div className="relative">
          <input
            type={showPass ? "text" : "password"}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="كلمة المرور"
            disabled={loading}
            required
            dir="ltr"
            className="touch-input w-full rounded-xl border border-white bg-white/80 px-4 py-3 pr-12 text-base text-left placeholder:text-slate-400 focus:border-slate-300 focus:outline-none disabled:opacity-60"
          />
          <button
            type="button"
            onClick={() => setShowPass(!showPass)}
            className="touch-target absolute left-1 top-1/2 -translate-y-1/2 text-slate-400"
          >
            {showPass ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
          </button>
        </div>

        <button
          type="submit"
          disabled={loading}
          className={`touch-target flex w-full items-center justify-center rounded-xl py-3 text-base font-bold text-white transition-colors disabled:opacity-60 ${portal.btnColor}`}
        >
          {loading ? (
            <svg className="h-4 w-4 animate-spin" viewBox="0 0 24 24" fill="none">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/>
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8z"/>
            </svg>
          ) : "دخول"}
        </button>
      </form>
    </div>
  );
}

// ── Main page ──────────────────────────────────────────────────────────────
function LoginPageContent() {
  const searchParams = useSearchParams();
  const mismatch = searchParams.get("reason") === "role_mismatch";
  const portalHint = searchParams.get("portal");

  return (
    <div className="safe-top safe-bottom min-h-screen bg-slate-50 flex flex-col items-center justify-center p-4 sm:p-6 relative overflow-hidden">
      <div className="pointer-events-none absolute right-[-10%] top-[-10%] h-[500px] w-[500px] rounded-full bg-teal-500/5 blur-3xl" />
      <div className="pointer-events-none absolute bottom-[-10%] left-[-10%] h-[400px] w-[400px] rounded-full bg-cyan-500/5 blur-3xl" />

      <div className="z-10 w-full max-w-4xl">

        <div className="mb-8 flex flex-col items-center gap-2">
          <div className="text-primary drop-shadow-sm">
            <FaTooth size={60} className="animate-pulse" />
          </div>
          <h1 className="text-3xl font-extrabold tracking-widest text-slate-800 font-mono">
            MASTER CLINIC PLUS
          </h1>
          <p className="text-xs font-bold tracking-widest text-primary uppercase">
            نظام إدارة العيادات الذكي
          </p>
        </div>

        {mismatch && (
          <p className="mb-4 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-center text-sm text-amber-800">
            تم تسجيل الخروج — هذا الحساب لا يطابق بوابة الدخول. سجّل دخولك من البوابة الصحيحة لدورك.
          </p>
        )}

        {portalHint === "assistant" && (
          <p className="mb-4 rounded-xl border border-teal-200 bg-teal-50 px-4 py-3 text-center text-sm text-teal-800">
            مساعدو الأطباء: سجّل الدخول من بوابة «المساعد» — ستُوجَّه مباشرة لحجوزات طبيبك فقط.
          </p>
        )}

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5" dir="rtl">
          {PORTALS.map((p) => (
            <PortalCard key={p.id} portal={p} highlighted={portalHint === p.id} />
          ))}
        </div>

        <div className="mt-8 flex items-center justify-center gap-2 select-none">
          <div className="flex items-center gap-2 rounded-2xl border border-slate-200 bg-white/80 px-5 py-2.5 shadow-sm backdrop-blur">
            <div className="flex h-7 w-7 items-center justify-center rounded-full bg-primary text-[10px] font-black text-white">
              ح
            </div>
            <div className="text-right">
              <p className="text-xs font-bold text-slate-700">{DEVELOPER.nameAr}</p>
              <p className="text-[9px] text-slate-400">{DEVELOPER.roleAr} · {DEVELOPER.year}</p>
            </div>
          </div>
        </div>

        <footer className="mt-6 flex min-h-[2rem] items-center justify-center pb-6">
          <DeveloperFooterLink />
        </footer>

      </div>
    </div>
  );
}

export default function LoginPage() {
  return (
    <Suspense fallback={null}>
      <LoginPageContent />
    </Suspense>
  );
}
