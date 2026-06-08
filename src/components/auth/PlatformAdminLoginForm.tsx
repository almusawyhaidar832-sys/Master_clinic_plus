"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Shield } from "lucide-react";

/** تسجيل دخول المدير العام للمنصة — يُستخدم من /admin-login و /developer/login */
export function PlatformAdminLoginForm() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPass, setShowPass] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [emailHint, setEmailHint] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/developer/setup-hint")
      .then((r) => r.json())
      .then((data: { configured?: boolean; emailHint?: string; fullEmail?: string }) => {
        if (!data.configured) return;
        if (data.fullEmail) setEmail(data.fullEmail);
        else if (data.emailHint) setEmailHint(data.emailHint);
      })
      .catch(() => {});
  }, []);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      const res = await fetch("/api/developer/authenticate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: email.trim(), password }),
      });
      const data = await res.json();
      if (!res.ok) {
        const hint =
          typeof data.hint === "string" && data.hint ? `\n${data.hint}` : "";
        setError(`${data.error ?? "رفض الدخول"}${hint}`);
        setLoading(false);
        return;
      }
      router.replace(data.redirect ?? "/developer");
    } catch {
      setError("تعذر الاتصال بالخادم");
    }
    setLoading(false);
  }

  return (
    <div className="flex min-h-screen flex-col items-center justify-center p-6">
      <div className="w-full max-w-md rounded-2xl border border-slate-700 bg-slate-900/80 p-8 shadow-2xl">
        <div className="mb-6 flex flex-col items-center gap-2 text-center">
          <Shield className="h-10 w-10 text-amber-400" />
          <h1 className="text-xl font-bold text-white">بوابة المدير العام</h1>
          <p className="text-sm text-slate-400">
            المدير العام للمنصة — البريد من ADMIN_EMAIL وكلمة المرور من
            .env.local (مو باسورد Gmail)
          </p>
          {(email || emailHint) && (
            <p className="text-xs text-amber-400/90" dir="ltr">
              البريد المسجّل: {email || emailHint}
            </p>
          )}
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="mb-1 block text-sm text-slate-300">
              البريد الإلكتروني
            </label>
            <input
              type="email"
              dir="ltr"
              autoComplete="email"
              className="w-full rounded-lg border border-slate-600 bg-slate-800 px-3 py-2.5 text-sm text-white outline-none focus:border-amber-500"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="you@example.com"
              required
            />
          </div>

          <div>
            <label className="mb-1 block text-sm text-slate-300">
              كلمة المرور
            </label>
            <div className="relative">
              <input
                type={showPass ? "text" : "password"}
                dir="ltr"
                autoComplete="current-password"
                className="w-full rounded-lg border border-slate-600 bg-slate-800 px-3 py-2.5 text-sm text-white outline-none focus:border-amber-500"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
              />
              <button
                type="button"
                onClick={() => setShowPass((v) => !v)}
                className="absolute left-2 top-1/2 -translate-y-1/2 text-xs text-slate-500"
              >
                {showPass ? "إخفاء" : "إظهار"}
              </button>
            </div>
          </div>

          {error && (
            <p className="rounded-lg bg-red-950/50 px-3 py-2 text-sm text-red-300">
              {error}
            </p>
          )}

          <button
            type="submit"
            disabled={loading}
            className="w-full rounded-lg bg-amber-600 py-2.5 text-sm font-bold text-white hover:bg-amber-500 disabled:opacity-60"
          >
            {loading ? "جاري التحقق..." : "دخول"}
          </button>
        </form>

        <button
          type="button"
          onClick={() => router.push("/login")}
          className="mt-6 w-full text-center text-xs text-slate-500 hover:text-slate-300"
        >
          العودة لتسجيل الدخول العادي
        </button>
      </div>
    </div>
  );
}
