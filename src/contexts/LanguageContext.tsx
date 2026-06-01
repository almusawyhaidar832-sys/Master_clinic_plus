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
    setLang(lang === "ar" ? "en" : "ar");
  }, [lang, setLang]);

  const t = useCallback(
    (key: TranslationKey): string => {
      return (translations[lang] as Record<string, string>)[key] ?? key;
    },
    [lang]
  );

  const value = useMemo<LanguageContextValue>(
    () => ({
      lang,
      isRTL: lang === "ar",
      setLang,
      toggleLang,
      t,
      langLabel: LANG_LABELS[lang],
    }),
    [lang, setLang, toggleLang, t]
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
    return {
      lang: "ar", isRTL: true, setLang: () => {}, toggleLang: () => {}, t,
      langLabel: LANG_LABELS.ar,
    };
  }
  return ctx;
}
