"use client";

import { Suspense, useState } from "react";
import { useSearchParams } from "next/navigation";
import { FaTooth } from "react-icons/fa";
import {
  isValidSanitizedUsername,
  sanitizeUsername,
} from "@/lib/auth/credentials";
import { syncPortalSessionClient } from "@/lib/auth/sync-portal-session-client";
import { Eye, EyeOff, Languages } from "lucide-react";
import { DeveloperCredit } from "@/components/layout/DeveloperCredit";
import { DeveloperFooterLink } from "@/components/layout/DeveloperFooterLink";
import { useLanguage } from "@/contexts/LanguageContext";

function UnifiedLoginForm() {
  const { t } = useLanguage();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [showPass, setShowPass] = useState(false);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  async function handleLogin(e: React.FormEvent) {
    e.preventDefault();
    if (!username.trim() || !password) {
      setError(t("loginCredentialsRequired"));
      return;
    }

    setLoading(true);
    setError("");

    try {
      const trimmedUser = username.trim();
      if (
        !trimmedUser.includes("@") &&
        !isValidSanitizedUsername(sanitizeUsername(trimmedUser))
      ) {
        setError(t("loginInvalidUsername"));
        setLoading(false);
        return;
      }

      const res = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({
          username: trimmedUser,
          password,
          portal: "auto",
        }),
      });

      const payload = (await res.json().catch(() => null)) as
        | { ok?: boolean; redirect?: string; portal?: string; error?: string }
        | null;

      if (!res.ok || !payload?.ok) {
        setError(payload?.error ?? t("loginConnectionError"));
        setLoading(false);
        return;
      }

      const portalId = payload.portal;
      if (!portalId) {
        setError(t("loginConnectionError"));
        setLoading(false);
        return;
      }

      const synced = await syncPortalSessionClient(
        portalId,
        trimmedUser,
        password
      );
      if (!synced.ok) {
        setError(synced.error);
        setLoading(false);
        return;
      }

      window.location.assign(payload.redirect ?? "/");
    } catch {
      setError(t("loginConnectionError"));
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="mx-auto w-full max-w-md rounded-2xl border-2 border-primary/30 bg-white/80 p-6 shadow-sm backdrop-blur sm:p-8">
      <p className="mb-6 text-center text-sm leading-relaxed text-slate-600">
        {t("unifiedLoginHint")}
      </p>

      <form onSubmit={handleLogin} className="flex flex-col gap-4">
        {error && (
          <p className="rounded-lg border border-red-100 bg-red-50 px-3 py-2 text-center text-xs text-red-600">
            {error}
          </p>
        )}

        <input
          type="text"
          value={username}
          onChange={(e) => setUsername(e.target.value)}
          placeholder={t("username")}
          disabled={loading}
          required
          dir="ltr"
          autoComplete="username"
          autoCapitalize="none"
          autoCorrect="off"
          spellCheck={false}
          inputMode="email"
          className="touch-input w-full rounded-xl border border-slate-200 bg-white px-4 py-3 text-base text-left placeholder:text-slate-400 focus:border-primary/40 focus:outline-none disabled:opacity-60"
        />

        <div className="relative">
          <input
            type={showPass ? "text" : "password"}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder={t("password")}
            disabled={loading}
            required
            dir="ltr"
            autoComplete="current-password"
            autoCapitalize="none"
            autoCorrect="off"
            spellCheck={false}
            className="touch-input w-full rounded-xl border border-slate-200 bg-white px-4 py-3 pr-12 text-base text-left placeholder:text-slate-400 focus:border-primary/40 focus:outline-none disabled:opacity-60"
          />
          <button
            type="button"
            onClick={() => setShowPass(!showPass)}
            className="touch-target absolute left-1 top-1/2 -translate-y-1/2 text-slate-400"
          >
            {showPass ? (
              <EyeOff className="h-4 w-4" />
            ) : (
              <Eye className="h-4 w-4" />
            )}
          </button>
        </div>

        <button
          type="submit"
          disabled={loading}
          className="touch-target flex w-full items-center justify-center rounded-xl bg-primary py-3.5 text-base font-bold text-white transition-colors hover:bg-primary/90 disabled:opacity-60"
        >
          {loading ? (
            <svg className="h-5 w-5 animate-spin" viewBox="0 0 24 24" fill="none">
              <circle
                className="opacity-25"
                cx="12"
                cy="12"
                r="10"
                stroke="currentColor"
                strokeWidth="4"
              />
              <path
                className="opacity-75"
                fill="currentColor"
                d="M4 12a8 8 0 018-8v8z"
              />
            </svg>
          ) : (
            t("loginButton")
          )}
        </button>
      </form>
    </div>
  );
}

function LoginPageContent() {
  const searchParams = useSearchParams();
  const { t, lang, toggleLang, isRTL } = useLanguage();
  const mismatch = searchParams.get("reason") === "role_mismatch";
  const portalHint = searchParams.get("portal");

  return (
    <div
      className="safe-top safe-bottom relative flex min-h-screen flex-col items-center justify-center overflow-hidden bg-slate-50 p-4 sm:p-6"
      dir={isRTL ? "rtl" : "ltr"}
    >
      <button
        type="button"
        onClick={toggleLang}
        className="absolute end-4 top-4 z-20 inline-flex items-center gap-1.5 rounded-xl border border-slate-200 bg-white/90 px-3 py-2 text-xs font-semibold text-slate-600 shadow-sm backdrop-blur hover:bg-white"
      >
        <Languages className="h-4 w-4" />
        {lang === "ar" ? "EN" : "عر"}
      </button>

      <div className="pointer-events-none absolute right-[-10%] top-[-10%] h-[500px] w-[500px] rounded-full bg-teal-500/5 blur-3xl" />
      <div className="pointer-events-none absolute bottom-[-10%] left-[-10%] h-[400px] w-[400px] rounded-full bg-cyan-500/5 blur-3xl" />

      <div className="z-10 w-full max-w-lg">
        <div className="mb-8 flex flex-col items-center gap-2">
          <div className="text-primary drop-shadow-sm">
            <FaTooth size={60} className="animate-pulse" />
          </div>
          <h1 className="font-mono text-3xl font-extrabold tracking-widest text-slate-800">
            MASTER CLINIC PLUS
          </h1>
          <p className="text-xs font-bold uppercase tracking-widest text-primary">
            {t("appTagline")}
          </p>
        </div>

        {mismatch && (
          <p className="mb-4 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-center text-sm text-amber-800">
            {t("loginRoleMismatch")}
          </p>
        )}

        {portalHint === "assistant" && (
          <p className="mb-4 rounded-xl border border-teal-200 bg-teal-50 px-4 py-3 text-center text-sm text-teal-800">
            {t("loginAssistantHint")}
          </p>
        )}

        {portalHint === "doctor" && (
          <p className="mb-4 rounded-xl border border-blue-200 bg-blue-50 px-4 py-3 text-center text-sm text-blue-800">
            {t("loginDoctorHint")}
          </p>
        )}

        <UnifiedLoginForm />

        <div className="mt-8 flex flex-col items-center gap-3">
          <DeveloperCredit variant="login" />
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
