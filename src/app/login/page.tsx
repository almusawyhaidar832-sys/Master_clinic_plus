"use client";

import { useState, type FormEvent, type ReactNode } from "react";
import {
  FaTooth,
  FaUserMd,
  FaClinicMedical,
  FaCalendarCheck,
  FaChalkboardTeacher,
} from "react-icons/fa";
import { createClient } from "@/lib/supabase/client";
import { getSession } from "@/lib/supabase/auth-helpers";
import {
  signInWithUsername,
  registerWithUsername,
} from "@/lib/auth/credentials";

type PortalTarget = "dashboard" | "doctor" | "admin" | "booking";

function redirectPath(portal: PortalTarget, role: string): string {
  if (portal === "doctor") return "/doctor";
  if (portal === "admin") return "/admin";
  if (portal === "booking") return "/booking";
  if (role === "doctor") return "/doctor";
  if (role === "super_admin") return "/admin";
  return "/dashboard";
}

export default function LoginPage() {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [isRegister, setIsRegister] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [loading, setLoading] = useState(false);

  async function runAuth(portal: PortalTarget = "dashboard") {
    if (!username.trim() || !password) {
      setError("أدخل اسم المستخدم وكلمة المرور");
      return;
    }

    setLoading(true);
    setError("");
    setSuccess("");

    const supabase = createClient();

    try {
      if (isRegister) {
        const result = await registerWithUsername(
          supabase,
          username,
          password,
          username.trim()
        );

        if (!result.ok) {
          setError(result.error);
          setLoading(false);
          return;
        }

        setSuccess(result.message);
        setIsRegister(false);

        const { data: sessionData } = await getSession(supabase);
        if (sessionData.session) {
          const { data: profile } = await supabase
            .from("profiles")
            .select("role")
            .eq("id", sessionData.session.user.id)
            .maybeSingle();

          window.location.href = redirectPath(
            portal,
            profile?.role ?? "accountant"
          );
          return;
        }

        setLoading(false);
        return;
      }

      const result = await signInWithUsername(supabase, username, password);

      if (!result.ok) {
        setError(result.error);
        setLoading(false);
        return;
      }

      window.location.href = redirectPath(portal, result.role);
    } catch (e) {
      console.error(e);
      setError("خطأ غير متوقع. تحقق من اتصال Supabase وملف .env.local");
      setLoading(false);
    }
  }

  function onFormSubmit(e: FormEvent) {
    e.preventDefault();
    void runAuth("dashboard");
  }

  return (
    <div className="min-h-screen bg-slate-50 flex flex-col items-center justify-center p-6 relative overflow-hidden font-sans">
      <div className="absolute top-[-10%] right-[-10%] w-[500px] h-[500px] bg-teal-500/5 rounded-full blur-3xl pointer-events-none" />
      <div className="absolute bottom-[-10%] left-[-10%] w-[400px] h-[400px] bg-cyan-500/5 rounded-full blur-3xl pointer-events-none" />

      <div className="w-full max-w-4xl bg-white/80 backdrop-blur-md rounded-3xl border border-slate-100 shadow-xl p-8 md:p-12 z-10 flex flex-col items-center">
        <div className="text-teal-600 mb-6 drop-shadow-sm">
          <FaTooth size={70} className="animate-pulse" />
        </div>

        <h1 className="text-4xl md:text-5xl font-extrabold text-slate-800 tracking-wide font-mono text-center mb-2">
          MASTER CLINIC PLUS
        </h1>

        <p className="text-xs md:text-sm font-bold text-teal-600 tracking-widest text-center uppercase mb-8">
          Modern Clinical Excellence in Dental Care
        </p>

        {(error || success) && (
          <div
            className={`mb-6 w-full rounded-xl px-4 py-3 text-sm text-center ${
              error
                ? "bg-red-50 text-red-700 border border-red-100"
                : "bg-green-50 text-green-700 border border-green-100"
            }`}
          >
            {error || success}
          </div>
        )}

        <div className="w-full grid grid-cols-1 md:grid-cols-2 gap-6" dir="rtl">
          <form
            onSubmit={onFormSubmit}
            className="bg-white border border-slate-100 p-6 rounded-2xl shadow-sm hover:shadow-md transition-all flex flex-col items-center justify-between text-center group"
          >
            <div className="flex flex-col items-center w-full">
              <div className="w-14 h-14 bg-teal-50 text-teal-600 rounded-xl flex items-center justify-center mb-4 group-hover:scale-110 transition-transform">
                <FaClinicMedical size={24} />
              </div>
              <h3 className="text-xl font-bold text-slate-800 mb-1">
                تسجيل الدخول / إنشاء حساب
              </h3>
              <p className="text-xs text-slate-400 mb-4 font-mono uppercase tracking-wider">
                Login / Register
              </p>

              <div className="w-full space-y-3 mb-4">
                <input
                  type="text"
                  placeholder="اسم المستخدم (Username)"
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                  autoComplete="username"
                  required
                  disabled={loading}
                  className="w-full px-4 py-2.5 text-sm bg-slate-50 border border-slate-200 rounded-xl focus:outline-none focus:border-teal-500 text-right disabled:opacity-60"
                />
                <input
                  type="password"
                  placeholder="كلمة المرور (Password)"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  autoComplete={
                    isRegister ? "new-password" : "current-password"
                  }
                  required
                  disabled={loading}
                  className="w-full px-4 py-2.5 text-sm bg-slate-50 border border-slate-200 rounded-xl focus:outline-none focus:border-teal-500 text-right disabled:opacity-60"
                />
              </div>

              <button
                type="button"
                disabled={loading}
                onClick={() => {
                  setIsRegister(!isRegister);
                  setError("");
                  setSuccess("");
                }}
                className="text-xs text-teal-600 hover:underline mb-3"
              >
                {isRegister
                  ? "لديك حساب؟ تسجيل الدخول"
                  : "مستخدم جديد؟ إنشاء حساب"}
              </button>
            </div>

            <button
              type="submit"
              disabled={loading}
              className="w-full py-3 bg-teal-700 hover:bg-teal-800 disabled:opacity-60 text-white font-bold rounded-xl transition-colors shadow-sm"
            >
              {loading
                ? "جاري المعالجة..."
                : isRegister
                  ? "CREATE ACCOUNT"
                  : "LOGIN"}
            </button>
          </form>

          <PortalCard
            icon={<FaUserMd size={24} />}
            iconClass="bg-cyan-50 text-cyan-600"
            title="بوابة الطبيب المختص"
            subtitle="Physician Portal"
            buttonLabel="PHYSICIAN PORTAL"
            buttonClass="bg-slate-600 hover:bg-slate-700"
            loading={loading}
            onAction={() => void runAuth("doctor")}
          />

          <PortalCard
            icon={<FaChalkboardTeacher size={24} />}
            iconClass="bg-slate-100 text-slate-600"
            title="لوحة تحكم الإدارة (الويب والجوال)"
            subtitle="Admin / Owner Dashboard"
            buttonLabel="ADMIN / OWNER"
            buttonClass="bg-slate-700 hover:bg-slate-800"
            loading={loading}
            onAction={() => void runAuth("admin")}
          />

          <PortalCard
            icon={<FaCalendarCheck size={24} />}
            iconClass="bg-teal-50 text-teal-600"
            title="بوابة المريض وحجز المواعيد"
            subtitle="Patient Portal & Booking"
            buttonLabel="BOOKING"
            buttonClass="bg-teal-600 hover:bg-teal-700"
            loading={loading}
            onAction={() => void runAuth("booking")}
          />
        </div>

        <p className="mt-8 text-xs text-slate-muted text-center max-w-lg">
          أدخل اسم المستخدم وكلمة المرور في البطاقة الأولى ثم اضغط LOGIN.
          الحسابات الجديدة تُنشأ باسم مستخدم فقط. الحسابات القديمة يمكنها
          استخدام البريد الإلكتروني في حقل اسم المستخدم.
        </p>

        {/* Developer signature */}
        <div className="mt-8 flex flex-col items-center gap-1 select-none">
          <div className="flex items-center gap-2 rounded-2xl border border-slate-200 bg-white/80 px-5 py-3 shadow-sm backdrop-blur">
            <div className="flex h-8 w-8 items-center justify-center rounded-full bg-primary text-white text-xs font-black">
              ح
            </div>
            <div className="text-right">
              <p className="text-sm font-bold text-slate-700">حيدر حازم الموسوي</p>
              <p className="text-[10px] text-slate-400">Full-Stack Developer · Master Clinic Plus © 2026</p>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function PortalCard({
  icon,
  iconClass,
  title,
  subtitle,
  buttonLabel,
  buttonClass,
  loading,
  onAction,
}: {
  icon: ReactNode;
  iconClass: string;
  title: string;
  subtitle: string;
  buttonLabel: string;
  buttonClass: string;
  loading: boolean;
  onAction: () => void;
}) {
  return (
    <div className="bg-white border border-slate-100 p-6 rounded-2xl shadow-sm hover:shadow-md transition-all flex flex-col items-center justify-between text-center group">
      <div className="flex flex-col items-center">
        <div
          className={`w-14 h-14 rounded-xl flex items-center justify-center mb-4 group-hover:scale-110 transition-transform ${iconClass}`}
        >
          {icon}
        </div>
        <h3 className="text-xl font-bold text-slate-800 mb-1">{title}</h3>
        <p className="text-xs text-slate-400 mb-6 font-mono uppercase tracking-wider">
          {subtitle}
        </p>
      </div>
      <button
        type="button"
        disabled={loading}
        onClick={onAction}
        className={`w-full py-3 disabled:opacity-60 text-white font-bold rounded-xl transition-colors shadow-sm mt-auto ${buttonClass}`}
      >
        {loading ? "..." : buttonLabel}
      </button>
    </div>
  );
}
