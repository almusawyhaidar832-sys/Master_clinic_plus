"use client";

import { Suspense, useState } from "react";
import { useSearchParams } from "next/navigation";
import { FaTooth } from "react-icons/fa";
import {
  isValidSanitizedUsername,
  sanitizeUsername,
} from "@/lib/auth/credentials";
import { syncPortalSessionClient } from "@/lib/auth/sync-portal-session-client";
import { Eye, EyeOff, KeyRound, Languages, User } from "lucide-react";
import { DeveloperCredit } from "@/components/layout/DeveloperCredit";
import { DeveloperFooterLink } from "@/components/layout/DeveloperFooterLink";
import { Alert } from "@/components/ui/Alert";
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
    <div className="mx-auto w-full max-w-md rounded-mc-2xl border border-slate-border/70 bg-surface-card p-6 shadow-premium sm:p-8">
      <p className="mb-6 text-center text-sm leading-relaxed text-slate-muted">
        {t("unifiedLoginHint")}
      </p>

      <form onSubmit={handleLogin} className="flex flex-col gap-4">
        {error && <Alert variant="error">{error}</Alert>}

        <div className="relative">
          <User className="pointer-events-none absolute start-4 top-1/2 h-4.5 w-4.5 -translate-y-1/2 text-slate-400" />
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
            className="touch-input w-full rounded-xl border border-slate-border bg-surface py-3 text-base text-left text-slate-text placeholder:text-slate-muted transition-colors ps-11 pe-4 focus:border-primary/50 focus:bg-surface-card focus:outline-none focus:ring-4 focus:ring-primary/10 disabled:opacity-60"
          />
        </div>

        <div className="relative">
          <KeyRound className="pointer-events-none absolute start-4 top-1/2 h-4.5 w-4.5 -translate-y-1/2 text-slate-400" />
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
            className="touch-input w-full rounded-xl border border-slate-border bg-surface py-3 text-base text-left text-slate-text placeholder:text-slate-muted transition-colors ps-11 pe-12 focus:border-primary/50 focus:bg-surface-card focus:outline-none focus:ring-4 focus:ring-primary/10 disabled:opacity-60"
          />
          <button
            type="button"
            onClick={() => setShowPass(!showPass)}
            className="touch-target absolute end-1 top-1/2 -translate-y-1/2 text-slate-400 transition-colors hover:text-primary"
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
          className="touch-target group relative mt-1 flex w-full items-center justify-center overflow-hidden rounded-xl bg-mc-navy py-3.5 text-base font-bold text-white shadow-elevated transition-all duration-200 ease-mc-out hover:shadow-glow mc-press disabled:opacity-60"
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
      className="safe-top safe-bottom relative flex min-h-screen flex-col items-center justify-center overflow-hidden bg-mc-navy p-4 sm:p-6"
      dir={isRTL ? "rtl" : "ltr"}
    >
      <div
        className="pointer-events-none absolute inset-0 opacity-[0.05]"
        style={{
          backgroundImage:
            "linear-gradient(rgba(255,255,255,0.8) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,0.8) 1px, transparent 1px)",
          backgroundSize: "44px 44px",
        }}
      />
      <div className="pointer-events-none absolute right-[-12%] top-[-15%] h-[560px] w-[560px] rounded-full bg-primary-300/20 blur-3xl" />
      <div className="pointer-events-none absolute bottom-[-15%] left-[-10%] h-[440px] w-[440px] rounded-full bg-premium-400/10 blur-3xl" />

      <button
        type="button"
        onClick={toggleLang}
        className="absolute end-4 top-4 z-20 inline-flex items-center gap-1.5 rounded-xl border border-white/15 bg-white/10 px-3 py-2 text-xs font-semibold text-white shadow-glass backdrop-blur-md transition-colors hover:bg-white/20"
      >
        <Languages className="h-4 w-4" />
        {lang === "ar" ? "EN" : "عر"}
      </button>

      <div className="z-10 w-full max-w-lg">
        <div className="mb-8 flex flex-col items-center gap-3">
          <div className="flex h-16 w-16 items-center justify-center rounded-2xl border border-white/15 bg-white/10 text-white shadow-glass backdrop-blur-md">
            <FaTooth size={30} />
          </div>
          <h1 className="font-mono text-3xl font-extrabold tracking-widest text-white">
            MASTER CLINIC PLUS
          </h1>
          <p className="text-xs font-bold uppercase tracking-widest text-premium-300">
            {t("appTagline")}
          </p>
        </div>

        {mismatch && (
          <Alert variant="warning" className="mb-4">
            {t("loginRoleMismatch")}
          </Alert>
        )}

        {portalHint === "assistant" && (
          <Alert variant="info" className="mb-4">
            {t("loginAssistantHint")}
          </Alert>
        )}

        {portalHint === "doctor" && (
          <Alert variant="info" className="mb-4">
            {t("loginDoctorHint")}
          </Alert>
        )}

        <UnifiedLoginForm />

        <div className="mt-8 flex flex-col items-center gap-3">
          <DeveloperCredit variant="login" />
        </div>

        <footer className="mt-6 flex min-h-[2rem] items-center justify-center pb-6">
          <DeveloperFooterLink variant="dark" />
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
