"use client";

import { useCallback, useState } from "react";
import { Info } from "lucide-react";
import { DEVELOPER } from "@/lib/constants";
import { useLanguage } from "@/contexts/LanguageContext";
import { cn } from "@/lib/utils";
import { DeveloperLogoMark } from "@/components/layout/DeveloperLogoMark";
import { AboutDialog } from "@/components/layout/AboutDialog";

interface DeveloperCreditProps {
  className?: string;
}

/** Sidebar credit card for Nexura Technologies — opens the About dialog. */
export function DeveloperCredit({ className }: DeveloperCreditProps) {
  const { t } = useLanguage();
  const [open, setOpen] = useState(false);
  const close = useCallback(() => setOpen(false), []);

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className={cn(
          "group relative flex w-full items-center gap-3 overflow-hidden rounded-xl border border-slate-border/60 bg-gradient-to-br from-white to-indigo-50/50 px-3 py-2.5 text-start transition-all hover:border-indigo-200 hover:shadow-md dark:from-slate-900 dark:to-indigo-950/30",
          className
        )}
      >
        <DeveloperLogoMark size={34} animated={false} />
        <span className="min-w-0 flex-1">
          <span className="block text-[9px] font-medium text-slate-muted">
            {t("developedBy")}
          </span>
          <span
            dir="ltr"
            className="block truncate bg-gradient-to-r from-indigo-700 to-cyan-600 bg-clip-text text-xs font-bold text-transparent dark:from-indigo-300 dark:to-cyan-300"
          >
            {DEVELOPER.nameEn}
          </span>
          <span className="block text-[9px] text-slate-muted">
            <span dir="ltr">© {DEVELOPER.year}</span> · {t("allRightsReserved")}
          </span>
        </span>
        <span
          title={t("aboutSystem")}
          className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg text-slate-400 transition-colors group-hover:bg-indigo-50 group-hover:text-indigo-600 dark:group-hover:bg-indigo-950/50"
        >
          <Info className="h-4 w-4" />
        </span>
      </button>
      <AboutDialog open={open} onClose={close} />
    </>
  );
}
