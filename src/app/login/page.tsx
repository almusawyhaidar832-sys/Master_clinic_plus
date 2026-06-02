"use client";

import { useState } from "react";
import { FaTooth } from "react-icons/fa";
import { createClient } from "@/lib/supabase/client";
import { signInWithUsername } from "@/lib/auth/credentials";
import { Eye, EyeOff } from "lucide-react";
import { DEVELOPER } from "@/lib/constants";

// كل بوابة لها دور محدد
type Portal = {
  id: string;
  title: string;
  subtitle: string;
  emoji: string;
  targetRole: string;   // الدور المتوقع بعد الدخول
  color: string;
  btnColor: string;
};

const PORTALS: Portal[] = [
  {
    id:         "admin",
    title:      "لوحة الإدارة",
    subtitle:   "مدير العيادة / المالك",
    emoji:      "🏥",
    targetRole: "accountant",   // super_admin أو accountant
    color:      "border-primary/30 bg-primary/5",
    btnColor:   "bg-primary hover:bg-primary/90",
  },
  {
    id:         "accountant",
    title:      "واجهة المحاسب",
    subtitle:   "الاستقبال والحسابات",
    emoji:      "💼",
    targetRole: "accountant",
    color:      "border-violet-200 bg-violet-50/50",
    btnColor:   "bg-violet-600 hover:bg-violet-700",
  },
  {
    id:         "doctor",
    title:      "تطبيق الطبيب",
    subtitle:   "الكشفيات والمحفظة",
    emoji:      "👨‍⚕️",
    targetRole: "doctor",
    color:      "border-blue-200 bg-blue-50/50",
    btnColor:   "bg-blue-600 hover:bg-blue-700",
  },
  {
    id:         "booking",
    title:      "بوابة الحجوزات",
    subtitle:   "حجز المرضى أونلاين",
    emoji:      "📅",
    targetRole: "booking",
    color:      "border-teal-200 bg-teal-50/50",
    btnColor:   "bg-teal-600 hover:bg-teal-700",
  },
];

function redirectByRole(role: string, portalId: string): string {
  if (portalId === "booking") return "/booking";
  if (role === "super_admin")  return "/admin";
  if (role === "doctor")       return "/doctor";
  return "/dashboard";
}

// ── بطاقة بوابة واحدة ─────────────────────────────────────────────────────
function PortalCard({ portal }: { portal: Portal }) {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [showPass, setShowPass] = useState(false);
  const [error,    setError]    = useState("");
  const [loading,  setLoading]  = useState(false);

  async function handleLogin(e: React.FormEvent) {
    e.preventDefault();
    if (!username.trim() || !password) {
      setError("أدخل اسم المستخدم وكلمة المرور");
      return;
    }

    // Booking portal: just redirect with the credentials
    if (portal.id === "booking") {
      window.location.href = "/booking";
      return;
    }

    setLoading(true);
    setError("");

    try {
      const supabase = createClient();
      const result = await signInWithUsername(supabase, username.trim(), password);

      if (!result.ok) {
        setError("اسم المستخدم أو كلمة المرور غير صحيحة");
        setLoading(false);
        return;
      }

      window.location.href = redirectByRole(result.role, portal.id);
    } catch {
      setError("خطأ في الاتصال");
      setLoading(false);
    }
  }

  return (
    <div className={`flex flex-col rounded-2xl border-2 p-5 transition-shadow hover:shadow-md ${portal.color}`}>

      {/* Header */}
      <div className="mb-4 flex items-center gap-3">
        <span className="text-3xl">{portal.emoji}</span>
        <div>
          <h3 className="font-bold text-slate-800">{portal.title}</h3>
          <p className="text-xs text-slate-500">{portal.subtitle}</p>
        </div>
      </div>

      {/* Booking — no login needed */}
      {portal.id === "booking" ? (
        <a
          href="/booking"
          className={`mt-auto flex w-full items-center justify-center rounded-xl py-2.5 text-sm font-bold text-white transition-colors ${portal.btnColor}`}
        >
          فتح بوابة الحجز
        </a>
      ) : (
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
            className="w-full rounded-xl border border-white bg-white/80 px-3 py-2.5 text-sm text-left placeholder:text-slate-400 focus:border-slate-300 focus:outline-none disabled:opacity-60"
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
              className="w-full rounded-xl border border-white bg-white/80 px-3 py-2.5 text-sm text-left placeholder:text-slate-400 focus:border-slate-300 focus:outline-none disabled:opacity-60"
            />
            <button
              type="button"
              onClick={() => setShowPass(!showPass)}
              className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400"
            >
              {showPass ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
            </button>
          </div>

          <button
            type="submit"
            disabled={loading}
            className={`flex w-full items-center justify-center rounded-xl py-2.5 text-sm font-bold text-white transition-colors disabled:opacity-60 ${portal.btnColor}`}
          >
            {loading ? (
              <svg className="h-4 w-4 animate-spin" viewBox="0 0 24 24" fill="none">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/>
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8z"/>
              </svg>
            ) : "دخول"}
          </button>
        </form>
      )}
    </div>
  );
}

// ── الصفحة الرئيسية ─────────────────────────────────────────────────────────
export default function LoginPage() {
  return (
    <div className="min-h-screen bg-slate-50 flex flex-col items-center justify-center p-6 relative overflow-hidden">
      {/* Background blobs */}
      <div className="pointer-events-none absolute right-[-10%] top-[-10%] h-[500px] w-[500px] rounded-full bg-teal-500/5 blur-3xl" />
      <div className="pointer-events-none absolute bottom-[-10%] left-[-10%] h-[400px] w-[400px] rounded-full bg-cyan-500/5 blur-3xl" />

      <div className="z-10 w-full max-w-4xl">

        {/* Logo */}
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

        {/* Portal cards grid */}
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4" dir="rtl">
          {PORTALS.map((p) => (
            <PortalCard key={p.id} portal={p} />
          ))}
        </div>

        {/* Developer signature */}
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

      </div>
    </div>
  );
}
