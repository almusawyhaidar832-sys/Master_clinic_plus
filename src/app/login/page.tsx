"use client";

import "./login.css";
import { Suspense, useCallback, useState } from "react";
import { useSearchParams } from "next/navigation";
import { Playfair_Display } from "next/font/google";
import {
  isValidSanitizedUsername,
  sanitizeUsername,
} from "@/lib/auth/credentials";
import { syncPortalSessionClient } from "@/lib/auth/sync-portal-session-client";
import {
  AlertCircle,
  ArrowLeft,
  ArrowRight,
  CalendarClock,
  Eye,
  EyeOff,
  FileHeart,
  Info,
  KeyRound,
  Languages,
  Lock,
  ShieldCheck,
  User,
  Wallet,
} from "lucide-react";
import { AboutDialog, NexuraSignature } from "@/components/layout/AboutDialog";
import { useLanguage } from "@/contexts/LanguageContext";
import { APP_NAME, APP_NAME_EN } from "@/lib/constants";
import { cn } from "@/lib/utils";

const display = Playfair_Display({
  subsets: ["latin"],
  weight: ["500", "600", "700"],
  display: "swap",
});

const LOGO_SRC = "/icons/pearl-512.png";

function Notice({
  tone,
  children,
}: {
  tone: "error" | "warning" | "info";
  children: React.ReactNode;
}) {
  const Icon = tone === "info" ? Info : AlertCircle;
  return (
    <div
      role={tone === "error" ? "alert" : "status"}
      className={cn(
        "flex items-start gap-2.5 rounded-2xl border px-4 py-3 text-[13px] leading-relaxed",
        tone === "error" && "border-rose-400/30 bg-rose-500/10 text-rose-100",
        tone === "warning" && "border-amber-300/30 bg-amber-400/10 text-amber-50",
        tone === "info" && "border-sky-300/25 bg-sky-400/10 text-sky-50"
      )}
    >
      <Icon className="mt-0.5 h-4 w-4 shrink-0 opacity-80" />
      <span>{children}</span>
    </div>
  );
}

function UnifiedLoginForm() {
  const { t, isRTL } = useLanguage();
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

  const Arrow = isRTL ? ArrowLeft : ArrowRight;

  return (
    <form onSubmit={handleLogin} className="flex flex-col gap-5" noValidate>
      {error && <Notice tone="error">{error}</Notice>}

      <label className="flex flex-col gap-2">
        <span className="text-[13px] font-medium text-white/70">{t("username")}</span>
        <div className="relative">
          <User className="pointer-events-none absolute start-4 top-1/2 h-[18px] w-[18px] -translate-y-1/2 text-white/40" />
          <input
            type="text"
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            placeholder="dr_ahmed"
            disabled={loading}
            required
            dir="ltr"
            autoComplete="username"
            autoCapitalize="none"
            autoCorrect="off"
            spellCheck={false}
            inputMode="email"
            className="pc-field touch-input h-[52px] w-full rounded-2xl ps-11 pe-4 text-base text-left disabled:opacity-60"
          />
        </div>
      </label>

      <label className="flex flex-col gap-2">
        <span className="text-[13px] font-medium text-white/70">{t("password")}</span>
        <div className="relative">
          <KeyRound className="pointer-events-none absolute start-4 top-1/2 h-[18px] w-[18px] -translate-y-1/2 text-white/40" />
          <input
            type={showPass ? "text" : "password"}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="••••••••"
            disabled={loading}
            required
            dir="ltr"
            autoComplete="current-password"
            autoCapitalize="none"
            autoCorrect="off"
            spellCheck={false}
            className="pc-field touch-input h-[52px] w-full rounded-2xl ps-11 pe-12 text-base text-left disabled:opacity-60"
          />
          <button
            type="button"
            onClick={() => setShowPass(!showPass)}
            aria-label={showPass ? "Hide password" : "Show password"}
            className="absolute end-2 top-1/2 flex h-9 w-9 -translate-y-1/2 items-center justify-center rounded-xl text-white/45 transition-colors hover:bg-white/10 hover:text-white"
          >
            {showPass ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
          </button>
        </div>
      </label>

      <button
        type="submit"
        disabled={loading}
        className="pc-btn mt-2 flex h-[54px] w-full items-center justify-center gap-2 rounded-2xl text-[15px] font-bold disabled:cursor-not-allowed disabled:opacity-70"
      >
        {loading ? (
          <>
            <svg className="h-5 w-5 animate-spin" viewBox="0 0 24 24" fill="none">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
              <path className="opacity-80" fill="currentColor" d="M4 12a8 8 0 018-8v8z" />
            </svg>
            <span>{t("loginLoading")}</span>
          </>
        ) : (
          <>
            <span>{t("loginButton")}</span>
            <Arrow className="h-4 w-4" />
          </>
        )}
      </button>
    </form>
  );
}

function PearlLogo({ className }: { className?: string }) {
  return (
    <div className={cn("pc-logo-wrap", className)}>
      <div className="pc-logo-halo" aria-hidden />
      <div className="pc-logo-ring" aria-hidden />
      <div className="pc-logo-tile h-full w-full">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={LOGO_SRC} alt={APP_NAME_EN} className="h-full w-full object-cover" draggable={false} />
      </div>
      <div className="pc-logo-reflection" aria-hidden />
    </div>
  );
}

function LoginPageContent() {
  const searchParams = useSearchParams();
  const { t, lang, toggleLang, isRTL } = useLanguage();
  const [aboutOpen, setAboutOpen] = useState(false);
  const closeAbout = useCallback(() => setAboutOpen(false), []);
  const mismatch = searchParams.get("reason") === "role_mismatch";
  const portalHint = searchParams.get("portal");

  const features = [
    { icon: CalendarClock, label: t("loginFeatureQueue") },
    { icon: FileHeart, label: t("loginFeatureRecords") },
    { icon: Wallet, label: t("loginFeatureFinance") },
  ];

  return (
    <div
      className="pc-login safe-top safe-bottom relative min-h-[100dvh] overflow-hidden"
      dir={isRTL ? "rtl" : "ltr"}
    >
      <div className="pointer-events-none absolute inset-0" aria-hidden>
        <div className="pc-orb pc-orb--teal right-[-10%] top-[-20%] h-[620px] w-[620px]" />
        <div className="pc-orb pc-orb--pearl left-[8%] top-[18%] h-[420px] w-[420px]" />
        <div className="pc-orb pc-orb--gold bottom-[-25%] left-[-10%] h-[560px] w-[560px]" />
        <div className="pc-arcs absolute left-1/2 top-1/2 h-[1400px] w-[1400px] -translate-x-1/2 -translate-y-1/2" />
        <div className="pc-grain absolute inset-0" />
      </div>

      <header className="relative z-20 mx-auto flex w-full max-w-7xl items-center justify-between px-5 pt-5 sm:px-8 sm:pt-7">
        <div className="hidden items-center gap-2 rounded-full border border-white/10 bg-white/5 px-3 py-1.5 text-[11px] font-medium text-white/60 backdrop-blur-md sm:flex">
          <ShieldCheck className="h-3.5 w-3.5 text-[#e6d3b3]" />
          {t("loginSecure")}
        </div>
        <div className="ms-auto flex items-center gap-2">
          <button
            type="button"
            onClick={() => setAboutOpen(true)}
            className="inline-flex items-center gap-1.5 rounded-full border border-white/10 bg-white/5 px-3.5 py-1.5 text-xs font-semibold text-white/80 backdrop-blur-md transition-colors hover:bg-white/10 hover:text-white"
          >
            <Info className="h-3.5 w-3.5" />
            {t("aboutSystem")}
          </button>
          <button
            type="button"
            onClick={toggleLang}
            className="inline-flex items-center gap-1.5 rounded-full border border-white/10 bg-white/5 px-3.5 py-1.5 text-xs font-semibold text-white/80 backdrop-blur-md transition-colors hover:bg-white/10 hover:text-white"
          >
            <Languages className="h-3.5 w-3.5" />
            {lang === "ar" ? "English" : "العربية"}
          </button>
        </div>
      </header>

      <main className="relative z-10 mx-auto grid w-full max-w-7xl items-center gap-10 px-5 pb-10 pt-6 sm:px-8 lg:min-h-[calc(100dvh-150px)] lg:grid-cols-[1.1fr_1fr] lg:gap-20 lg:pb-16 lg:pt-0">
        <section className="pc-rise flex flex-col items-center text-center lg:items-start lg:text-start">
          <PearlLogo className="h-28 w-28 sm:h-32 sm:w-32 lg:h-40 lg:w-40" />

          <h1
            dir="ltr"
            className={cn(
              display.className,
              "pc-wordmark mt-9 text-[44px] font-semibold leading-none sm:text-6xl lg:text-7xl"
            )}
          >
            Pearl Clinic
          </h1>
          <p
            className={cn(
              "mt-3 font-medium text-[#e6d3b3]/80",
              lang === "ar" ? "text-base" : "text-xs tracking-[0.35em]"
            )}
          >
            {lang === "ar" ? APP_NAME : "DENTAL CARE SUITE"}
          </p>

          <div className="pc-divider my-7 w-40 lg:w-56" />

          <h2 className="hidden max-w-lg text-2xl font-bold leading-snug text-white sm:block lg:text-[32px]">
            {t("loginHeroTitle")}
          </h2>
          <p className="mt-4 hidden max-w-md text-[15px] leading-8 text-white/55 sm:block">
            {t("loginHeroSub")}
          </p>

          <ul className="mt-8 hidden flex-wrap justify-center gap-2.5 sm:flex lg:justify-start">
            {features.map(({ icon: Icon, label }) => (
              <li
                key={label}
                className="pc-chip inline-flex items-center gap-2 rounded-full px-4 py-2 text-[13px] text-white/75"
              >
                <Icon className="h-4 w-4 text-[#e6d3b3]" />
                {label}
              </li>
            ))}
          </ul>
        </section>

        <section className="pc-rise w-full [animation-delay:150ms]">
          <div className="pc-card mx-auto w-full max-w-[440px] rounded-[28px] p-6 sm:p-9">
            <div className="mb-7">
              <div className="mb-4 inline-flex h-11 w-11 items-center justify-center rounded-2xl border border-white/10 bg-white/5">
                <Lock className="h-5 w-5 text-[#e6d3b3]" />
              </div>
              <h3 className="text-2xl font-bold text-white">{t("loginWelcome")}</h3>
              <p className="mt-1.5 text-sm text-white/55">{t("loginWelcomeSub")}</p>
            </div>

            <div className="mb-5 flex flex-col gap-3 empty:hidden">
              {mismatch && <Notice tone="warning">{t("loginRoleMismatch")}</Notice>}
              {portalHint === "assistant" && <Notice tone="info">{t("loginAssistantHint")}</Notice>}
              {portalHint === "doctor" && <Notice tone="info">{t("loginDoctorHint")}</Notice>}
            </div>

            <UnifiedLoginForm />

            <p className="mt-6 flex items-start gap-2 border-t border-white/10 pt-5 text-xs leading-relaxed text-white/45">
              <ShieldCheck className="mt-0.5 h-3.5 w-3.5 shrink-0 text-[#e6d3b3]/70" />
              {t("loginRoleAuto")}
            </p>
          </div>
        </section>
      </main>

      <footer className="relative z-10 mx-auto flex w-full max-w-7xl justify-center px-5 pb-6 sm:px-8">
        <button
          type="button"
          onClick={() => setAboutOpen(true)}
          className="rounded-2xl px-4 py-2 transition-colors hover:bg-white/5"
        >
          <NexuraSignature />
        </button>
      </footer>

      <AboutDialog open={aboutOpen} onClose={closeAbout} />
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
