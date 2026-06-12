"use client";

import { Suspense, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { FaTooth } from "react-icons/fa";
import { createClientForPortal } from "@/lib/supabase/client";
import { signOutUser } from "@/lib/supabase/auth-helpers";
import {
  isValidSanitizedUsername,
  sanitizeUsername,
  signInWithUsername,
} from "@/lib/auth/credentials";
import {
  isRoleAllowedForPath,
  loginPortalToAuthPortalId,
  normalizeRole,
} from "@/lib/auth/portal-access";
import { Eye, EyeOff, Languages } from "lucide-react";
import { DeveloperCredit } from "@/components/layout/DeveloperCredit";
import { DeveloperFooterLink } from "@/components/layout/DeveloperFooterLink";
import { useLanguage } from "@/contexts/LanguageContext";
import type { TranslationKey } from "@/i18n/translations";

type Portal = {
  id: string;
  titleKey: TranslationKey;
  subtitleKey: TranslationKey;
  emoji: string;
  color: string;
  btnColor: string;
  destination: string;
};

const PORTALS: Portal[] = [
  {
    id: "admin",
    titleKey: "portalAdminTitle",
    subtitleKey: "portalAdminSubtitle",
    emoji: "🏥",
    color: "border-primary/30 bg-primary/5",
    btnColor: "bg-primary hover:bg-primary/90",
    destination: "/admin",
  },
  {
    id: "accountant",
    titleKey: "portalAccountantTitle",
    subtitleKey: "portalAccountantSubtitle",
    emoji: "💼",
    color: "border-violet-200 bg-violet-50/50",
    btnColor: "bg-violet-600 hover:bg-violet-700",
    destination: "/dashboard",
  },
  {
    id: "doctor",
    titleKey: "portalDoctorTitle",
    subtitleKey: "portalDoctorSubtitle",
    emoji: "👨‍⚕️",
    color: "border-blue-200 bg-blue-50/50",
    btnColor: "bg-blue-600 hover:bg-blue-700",
    destination: "/doctor",
  },
  {
    id: "assistant",
    titleKey: "portalAssistantTitle",
    subtitleKey: "portalAssistantSubtitle",
    emoji: "🧑‍💼",
    color: "border-teal-200 bg-teal-50/50",
    btnColor: "bg-teal-600 hover:bg-teal-700",
    destination: "/assistant/dashboard",
  },
  {
    id: "booking",
    titleKey: "portalBookingTitle",
    subtitleKey: "portalBookingSubtitle",
    emoji: "📅",
    color: "border-teal-200 bg-teal-50/50",
    btnColor: "bg-teal-600 hover:bg-teal-700",
    destination: "/booking",
  },
];

function PortalCard({
  portal,
  highlighted,
}: {
  portal: Portal;
  highlighted?: boolean;
}) {
  const router = useRouter();
  const { t } = useLanguage();
  const title = t(portal.titleKey);

  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [showPass, setShowPass] = useState(false);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  if (portal.id === "booking") {
    return (
      <div
        className={`flex flex-col rounded-2xl border-2 p-5 transition-shadow hover:shadow-md ${portal.color}`}
      >
        <div className="mb-4 flex items-center gap-3">
          <span className="text-3xl">{portal.emoji}</span>
          <div>
            <h3 className="font-bold text-slate-800">{title}</h3>
            <p className="text-xs text-slate-500">{t(portal.subtitleKey)}</p>
          </div>
        </div>
        <a
          href="/booking"
          className={`touch-target mt-auto flex w-full items-center justify-center rounded-xl py-3 text-base font-bold text-white transition-colors ${portal.btnColor}`}
        >
          {t("openBookingPortal")}
        </a>
      </div>
    );
  }

  async function handleLogin(e: React.FormEvent) {
    e.preventDefault();
    if (!username.trim() || !password) {
      setError(t("loginCredentialsRequired"));
      return;
    }

    setLoading(true);
    setError("");

    try {
      const authPortal = loginPortalToAuthPortalId(portal.id);
      if (!authPortal) {
        setError(t("loginUnknownPortal"));
        setLoading(false);
        return;
      }

      const trimmedUser = username.trim();
      if (
        !trimmedUser.includes("@") &&
        !isValidSanitizedUsername(sanitizeUsername(trimmedUser))
      ) {
        setError(t("loginInvalidUsername"));
        setLoading(false);
        return;
      }

      const supabase = createClientForPortal(authPortal);
      const result = await signInWithUsername(supabase, trimmedUser, password);

      if (!result.ok) {
        setError(result.error);
        setLoading(false);
        return;
      }

      const role = normalizeRole(result.role);
      if (!role || !isRoleAllowedForPath(role, portal.destination)) {
        await signOutUser(supabase);
        setError(
          role ? t("loginWrongPortal") : t("loginNoRole")
        );
        setLoading(false);
        return;
      }

      router.refresh();
      window.location.assign(portal.destination);
    } catch {
      setError(t("loginConnectionError"));
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
          <h3 className="font-bold text-slate-800">{title}</h3>
          <p className="text-xs text-slate-500">{t(portal.subtitleKey)}</p>
        </div>
      </div>

      <form onSubmit={handleLogin} className="flex flex-col gap-3">
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
          className="touch-input w-full rounded-xl border border-white bg-white/80 px-4 py-3 text-base text-left placeholder:text-slate-400 focus:border-slate-300 focus:outline-none disabled:opacity-60"
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
            className="touch-input w-full rounded-xl border border-white bg-white/80 px-4 py-3 pr-12 text-base text-left placeholder:text-slate-400 focus:border-slate-300 focus:outline-none disabled:opacity-60"
          />
          <button
            type="button"
            onClick={() => setShowPass(!showPass)}
            className="touch-target absolute left-1 top-1/2 -translate-y-1/2 text-slate-400"
          >
            {showPass ? (
              <EyeOff className="h-3.5 w-3.5" />
            ) : (
              <Eye className="h-3.5 w-3.5" />
            )}
          </button>
        </div>

        <button
          type="submit"
          disabled={loading}
          className={`touch-target flex w-full items-center justify-center rounded-xl py-3 text-base font-bold text-white transition-colors disabled:opacity-60 ${portal.btnColor}`}
        >
          {loading ? (
            <svg className="h-4 w-4 animate-spin" viewBox="0 0 24 24" fill="none">
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

      <div className="z-10 w-full max-w-4xl">
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

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5">
          {PORTALS.map((p) => (
            <PortalCard key={p.id} portal={p} highlighted={portalHint === p.id} />
          ))}
        </div>

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
