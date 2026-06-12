"use client";

/**
 * LanguageContext — Arabic / English
 * Persists preference in localStorage.
 * Applies lang + dir attributes to <html>.
 */

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import {
  translations,
  type Language,
  type TranslationKey,
  LANG_LABELS,
} from "@/i18n/translations";

interface LanguageContextValue {
  lang: Language;
  isRTL: boolean;
  setLang: (l: Language) => void;
  toggleLang: () => void;
  t: (key: TranslationKey) => string;
  /** Pick Arabic or English string based on current language */
  bi: (ar: string, en: string) => string;
  formatMoney: (amount: number) => string;
  dateLocale: string;
  langLabel: string;
}

const LanguageContext = createContext<LanguageContextValue | null>(null);

const STORAGE_KEY = "mcp-lang";

function applyLang(l: Language) {
  const html = document.documentElement;
  html.setAttribute("lang", l);
  html.setAttribute("dir", l === "ar" ? "rtl" : "ltr");
}

export function LanguageProvider({ children }: { children: ReactNode }) {
  const [lang, setLangState] = useState<Language>("ar");

  useEffect(() => {
    const stored = localStorage.getItem(STORAGE_KEY) as Language | null;
    const initial: Language = stored === "en" ? "en" : "ar";
    setLangState(initial);
    applyLang(initial);
  }, []);

  const setLang = useCallback((l: Language) => {
    setLangState(l);
    localStorage.setItem(STORAGE_KEY, l);
    applyLang(l);
  }, []);

  const toggleLang = useCallback(() => {
    setLangState((prev) => {
      const next: Language = prev === "ar" ? "en" : "ar";
      localStorage.setItem(STORAGE_KEY, next);
      applyLang(next);
      return next;
    });
  }, []);

  const t = useCallback(
    (key: TranslationKey): string => {
      return (translations[lang] as Record<string, string>)[key] ?? key;
    },
    [lang]
  );

  const bi = useCallback(
    (ar: string, en: string): string => (lang === "en" ? en : ar),
    [lang]
  );

  const formatMoney = useCallback(
    (amount: number): string => {
      const n = new Intl.NumberFormat("en-US", {
        numberingSystem: "latn",
        minimumFractionDigits: 0,
        maximumFractionDigits: 0,
      }).format(amount);
      return `${n} ${t("currency")}`;
    },
    [t]
  );

  const dateLocale = lang === "en" ? "en-US" : "ar-EG";

  const value = useMemo<LanguageContextValue>(
    () => ({
      lang,
      isRTL: lang === "ar",
      setLang,
      toggleLang,
      t,
      bi,
      formatMoney,
      dateLocale,
      langLabel: LANG_LABELS[lang],
    }),
    [lang, setLang, toggleLang, t, bi, formatMoney, dateLocale]
  );

  return (
    <LanguageContext.Provider value={value}>{children}</LanguageContext.Provider>
  );
}

export function useLanguage(): LanguageContextValue {
  const ctx = useContext(LanguageContext);
  if (!ctx) {
    const t = (key: TranslationKey): string =>
      (translations.ar as Record<string, string>)[key] ?? key;
    const bi = (ar: string, en: string) => ar;
    const formatMoney = (amount: number) =>
      `${new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 }).format(amount)} ${t("currency")}`;
    return {
      lang: "ar",
      isRTL: true,
      setLang: () => {},
      toggleLang: () => {},
      t,
      bi,
      formatMoney,
      dateLocale: "ar-EG",
      langLabel: LANG_LABELS.ar,
    };
  }
  return ctx;
}
